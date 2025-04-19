// controllers/stripeController.js
import Stripe from "stripe";
import User from "../models/User.js";
import { ApiError, catchAsync } from "../utils/errorHandler.js";
import {
  sendSubscriptionCancelEmail,
  sendSubscriptionSuccessEmail,
} from "../helper/notifyByEmail.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const priceIdToPlan = {
  [process.env.STRIPE_PRICE_BASIC]: "basic",
  [process.env.STRIPE_PRICE_PREMIUM]: "premium",
  [process.env.STRIPE_PRICE_ENTERPRISE]: "enterprise",
};

const planLimits = {
  basic: { maxInboxes: 1, dailyQueries: 15 },
  premium: { maxInboxes: 3, dailyQueries: 100 },
  enterprise: { maxInboxes: 10, dailyQueries: Infinity },
};

export const createCheckoutSession = catchAsync(async (req, res, next) => {
  console.log("Request body:", req.body);

  // Check if request body exists
  if (!req.body || Object.keys(req.body).length === 0) {
    return next(new ApiError("Missing request body", 400));
  }

  const { plan } = req.body;

  // Validate that plan is provided
  if (!plan) {
    return next(new ApiError("Plan is required", 400));
  }

  const userId = req.user.id;
  const user = await User.findById(userId);

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  console.log("Creating checkout session for plan:", plan);

  if (!["basic", "premium", "enterprise"].includes(plan)) {
    return next(new ApiError("Invalid plan", 400));
  }

  // Check if the user already has an active subscription
  if (
    user.subscription.status === "active" &&
    user.subscription.endDate > new Date()
  ) {
    // Check if the new plan is the same as the current plan
    if (user.subscription.plan === plan) {
      return next(new ApiError("You are already subscribed to this plan", 400));
    }

    // Cancel the existing subscription immediately
    if (user.subscription.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(
          user.subscription.stripeSubscriptionId
        );
        user.subscription.status = "cancelled";
        user.subscription.endDate = new Date();
        user.subscription.autoRenew = false;
        user.subscription.remainingQueries = 0;
        await user.save();
        await sendSubscriptionCancelEmail(user);
      } catch (error) {
        console.error("Error cancelling existing subscription:", error);
        return next(
          new ApiError("Failed to cancel existing subscription", 500)
        );
      }
    }
  }

  // Create a new checkout session for the selected plan
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{ price: getStripePriceId(plan), quantity: 1 }],
    mode: "subscription",
    success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    client_reference_id: user._id.toString(),
    customer_email: user.email,
  });

  res.json({ sessionId: session.id });
});

export const handleWebhook = catchAsync(async (req, res, next) => {
  const sig = req.headers["stripe-signature"];
  let event;

  // Convert raw body Buffer to string
  const rawBody = req.body.toString("utf8");

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log("Webhook event received:", event.type);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return next(new ApiError(`Webhook Error: ${err.message}`, 400));
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id;

      // Retrieve the full subscription details from Stripe
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription,
        { expand: ["latest_invoice"] }
      );

      console.log("Stripe subscription details:", {
        id: subscription.id,
        status: subscription.status,
        start_date: subscription.start_date,
        current_period_end: subscription.current_period_end,
      });

      const priceId = subscription.items.data[0].price.id;
      const plan = getPlanFromPriceId(priceId);

      const user = await User.findById(userId);
      if (!user) {
        console.error(`User not found for ID: ${userId}`);
        return res.json({ received: true });
      }

      user.subscription.plan = plan;
      user.subscription.status = "active";
      user.subscription.dailyQueries = planLimits[plan].dailyQueries;
      user.subscription.remainingQueries = planLimits[plan].dailyQueries;

      // Add safety checks for timestamp values
      if (subscription.start_date) {
        user.subscription.startDate = new Date(subscription.start_date * 1000);
      }

      // Handle end date with fallback
      if (subscription.current_period_end) {
        user.subscription.endDate = new Date(
          subscription.current_period_end * 1000
        );
      } else if (subscription.start_date) {
        // Fallback: Add 30 days to the start date for monthly subscription
        const startDate = new Date(subscription.start_date * 1000);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 30);
        user.subscription.endDate = endDate;
        console.log("Using fallback to calculate end date:", endDate);
      }

      user.subscription.stripeSubscriptionId = subscription.id;
      user.subscription.autoRenew = true;

      if (user.inboxList.length > planLimits[plan].maxInboxes) {
        user.inboxList = user.inboxList.slice(0, planLimits[plan].maxInboxes);
      }

      await user.save();
      console.log("User subscription updated successfully:", {
        id: user._id,
        plan: user.subscription.plan,
        startDate: user.subscription.startDate,
        endDate: user.subscription.endDate,
      });

      await sendSubscriptionSuccessEmail(user);
    } else if (event.type === "customer.subscription.updated") {
      const subscriptionEventData = event.data.object;

      // Retrieve the full subscription details from Stripe
      const subscription = await stripe.subscriptions.retrieve(
        subscriptionEventData.id,
        { expand: ["latest_invoice"] }
      );

      console.log(
        "Full subscription data:",
        JSON.stringify({
          id: subscription.id,
          status: subscription.status,
          current_period_end: subscription.current_period_end,
          cancel_at_period_end: subscription.cancel_at_period_end,
        })
      );

      const user = await User.findOne({
        "subscription.stripeSubscriptionId": subscription.id,
      });

      if (!user) {
        console.error(`User not found for subscription ID: ${subscription.id}`);
        return res.json({ received: true });
      }

      // Update subscription status based on both active status and cancellation flag
      if (subscription.cancel_at_period_end) {
        user.subscription.status = "active";
        user.subscription.autoRenew = false;
      } else {
        user.subscription.status = subscription.status;
        user.subscription.autoRenew = true;
      }

      // Always use the value from the fully retrieved subscription
      if (subscription.current_period_end) {
        user.subscription.endDate = new Date(
          subscription.current_period_end * 1000
        );
      } else if (user.subscription.startDate) {
        // Fallback: Add 30 days to the start date for monthly subscription
        const startDate = new Date(user.subscription.startDate);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 30);
        user.subscription.endDate = endDate;
        console.log("Using fallback to calculate end date on update:", endDate);
      }

      await user.save();
      console.log("User subscription updated on update event:", {
        id: user._id,
        status: user.subscription.status,
        autoRenew: user.subscription.autoRenew,
        endDate: user.subscription.endDate,
      });
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const user = await User.findOne({
        "subscription.stripeSubscriptionId": subscription.id,
      });
      if (!user) {
        console.error(`User not found for subscription ID: ${subscription.id}`);
        return res.json({ received: true });
      }

      user.subscription.status = "cancelled";
      user.subscription.endDate = new Date();
      user.subscription.autoRenew = false;
      user.subscription.remainingQueries = 0;
      await user.save();
      console.log("User subscription cancelled:", {
        id: user._id,
        status: user.subscription.status,
        endDate: user.subscription.endDate,
      });

      await sendSubscriptionCancelEmail(user);
    }
  } catch (err) {
    console.error(`Error processing webhook event ${event.type}:`, err.message);
    console.error(err.stack);
    return next(new ApiError(`Webhook processing error: ${err.message}`, 500));
  }

  res.json({ received: true });
});

export const cancelSubscription = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.subscription.stripeSubscriptionId) {
    return next(new ApiError("No active subscription found", 400));
  }

  try {
    const subscription = await stripe.subscriptions.update(
      user.subscription.stripeSubscriptionId,
      { cancel_at_period_end: true }
    );

    // Keep status as active but mark as cancelled at period end
    user.subscription.autoRenew = false;
    user.subscription.endDate = new Date(
      subscription.current_period_end * 1000
    );
    await user.save();

    res.json({
      success: true,
      message:
        "Subscription will be cancelled at the end of the billing period",
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    return next(new ApiError("Failed to cancel subscription", 500));
  }
});

export const enableAutoRenew = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.subscription.stripeSubscriptionId) {
    return next(new ApiError("No active subscription found", 400));
  }

  try {
    // If subscription is not active, it can't be renewed
    if (user.subscription.status !== "active") {
      return next(new ApiError("Subscription is not active", 400));
    }

    // Update the subscription to remove cancel_at_period_end flag
    const subscription = await stripe.subscriptions.update(
      user.subscription.stripeSubscriptionId,
      { cancel_at_period_end: false }
    );

    // Update user data
    user.subscription.autoRenew = true;
    // Make sure to keep the end date accurate
    user.subscription.endDate = new Date(
      subscription.current_period_end * 1000
    );
    await user.save();

    res.json({
      success: true,
      message:
        "Auto-renew has been enabled. Your subscription will automatically renew at the end of the current billing period.",
      renewalDate: user.subscription.endDate,
    });
  } catch (error) {
    console.error("Error enabling auto-renew:", error);
    return next(new ApiError("Failed to enable auto-renew", 500));
  }
});

export const cancelAutoRenew = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.subscription.stripeSubscriptionId) {
    return next(new ApiError("No active subscription found", 400));
  }

  try {
    const subscription = await stripe.subscriptions.update(
      user.subscription.stripeSubscriptionId,
      { cancel_at_period_end: true }
    );

    // Keep the subscription active for the current period
    user.subscription.autoRenew = false;
    user.subscription.endDate = new Date(
      subscription.current_period_end * 1000
    );
    await user.save();

    res.json({
      success: true,
      message:
        "Auto-renew has been disabled. Your subscription will remain active until the end of the current billing period.",
      expiryDate: user.subscription.endDate,
    });
  } catch (error) {
    console.error("Error cancelling auto-renew:", error);
    return next(new ApiError("Failed to cancel auto-renew", 500));
  }
});

export const adminCancelUserSubscription = catchAsync(
  async (req, res, next) => {
    // Check if the requesting user is an admin
    if (req.user.role !== "admin" && req.user.role !== "super_admin") {
      return next(new ApiError("Unauthorized access", 403));
    }

    const { userId } = req.body;
    if (!userId) {
      return next(new ApiError("User ID is required", 400));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new ApiError("User not found", 404));
    }

    if (!user.subscription.stripeSubscriptionId) {
      return next(
        new ApiError("No active subscription found for this user", 400)
      );
    }

    try {
      // Immediately cancel the subscription
      await stripe.subscriptions.del(user.subscription.stripeSubscriptionId);

      // Update user subscription details
      user.subscription.status = "cancelled";
      user.subscription.endDate = new Date();
      user.subscription.autoRenew = false;
      user.subscription.remainingQueries = 0;
      await user.save();

      // Send cancellation email
      await sendSubscriptionCancelEmail(user);

      res.json({
        success: true,
        message: "User subscription cancelled successfully by admin",
        user: {
          id: user._id,
          email: user.email,
          subscriptionStatus: user.subscription.status,
          endDate: user.subscription.endDate,
        },
      });
    } catch (error) {
      console.error("Error cancelling subscription:", error);
      return next(
        new ApiError(`Failed to cancel subscription: ${error.message}`, 500)
      );
    }
  }
);

export const adminTotalEarningByUserSubscription = catchAsync(
  async (req, res, next) => {
    // auth middleware ensures req.user.role is admin/super_admin

    let totalIncome = 0;
    const paymentHistory = [];

    try {
      // Manual pagination params
      let params = { limit: 100 };
      let invoices;

      do {
        invoices = await stripe.invoices.list(params);

        // Process this page
        for (const inv of invoices.data) {
          if (inv.status === "paid") {
            const amount = inv.amount_paid / 100;
            totalIncome += amount;
            paymentHistory.push({
              id: inv.id,
              date: new Date(inv.created * 1000),
              amount,
              status: inv.status,
            });
          }
        }

        // Prepare next page
        if (invoices.has_more) {
          params.starting_after = invoices.data[invoices.data.length - 1].id;
        } else {
          break;
        }
      } while (true);

      return res.status(200).json({
        success: true,
        totalIncome,
        currency: "USD",
        paymentHistory,
      });
    } catch (err) {
      console.error("Error fetching total earnings:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve total earnings. Please try again later.",
      });
    }
  }
);

const getStripePriceId = (plan) => {
  return {
    basic: process.env.STRIPE_PRICE_BASIC,
    premium: process.env.STRIPE_PRICE_PREMIUM,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  }[plan];
};

const getPlanFromPriceId = (priceId) => priceIdToPlan[priceId] || "basic";
