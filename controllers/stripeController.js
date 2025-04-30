// controllers\stripeController.js this new updated
import Stripe from "stripe";
import User from "../models/User.js";
import { ApiError, catchAsync } from "../utils/errorHandler.js";
import {
  sendAdminSubscriptionCancelNotification,
  sendSubscriptionCancelConfirmation,
  sendSubscriptionCancelEmail,
  sendSubscriptionSuccessEmail,
} from "../helper/notifyByEmail.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const getFrontendUrl =
  process.env.NODE_ENV === "production"
    ? process.env.FRONTEND_LIVE_URL
    : process.env.FRONTEND_URL;

const priceIdToPlan = {
  [process.env.STRIPE_PRICE_FREE]: "free",
  [process.env.STRIPE_PRICE_BASIC]: "basic",
  [process.env.STRIPE_PRICE_PREMIUM]: "premium",
  [process.env.STRIPE_PRICE_ENTERPRISE]: "enterprise",
};

const planLimits = {
  free: { maxInboxes: 1, dailyQueries: 5 },
  basic: { maxInboxes: 1, dailyQueries: 15 },
  premium: { maxInboxes: 3, dailyQueries: Infinity || 10000000000000 },
  enterprise: { maxInboxes: 10, dailyQueries: Infinity || 10000000000000 },
};

// Helper function to get plan details
const getPlanDetails = (plan) => ({
  dailyQueries: planLimits[plan].dailyQueries,
  maxInboxes: planLimits[plan].maxInboxes,
});

export const createCheckoutSession = catchAsync(async (req, res, next) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return next(new ApiError(400, "Missing request body"));
  }

  const { plan } = req.body;
  if (!plan) {
    return next(new ApiError(400, "Plan is required"));
  }

  if (!["free", "basic", "premium", "enterprise"].includes(plan)) {
    return next(
      new ApiError(400, "Invalid plan. Choose basic, premium, or enterprise")
    );
  }

  const userId = req.user.id;
  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError(404, "User not found"));
  }

  // if (plan === "free") {
  //   // Update user to free plan directly without creating a checkout session
  //   user.subscription.plan = "free";
  //   user.subscription.status = "active";
  //   user.subscription.dailyQueries = planLimits.free.dailyQueries;
  //   user.subscription.remainingQueries = planLimits.free.dailyQueries;
  //   user.subscription.startDate = new Date();
  //   user.subscription.endDate = new Date().setFullYear(
  //     new Date().getFullYear() + 10
  //   );
  //   user.subscription.autoRenew = false;

  //   // If there's an active subscription, cancel it in Stripe
  //   if (user.subscription.stripeSubscriptionId) {
  //     try {
  //       const subscription = await stripe.subscriptions.retrieve(
  //         user.subscription.stripeSubscriptionId
  //       );

  //       if (
  //         subscription.status === "active" ||
  //         subscription.status === "trialing"
  //       ) {
  //         await stripe.subscriptions.cancel(
  //           user.subscription.stripeSubscriptionId
  //         );
  //       }
  //     } catch (error) {
  //       // If subscription doesn't exist in Stripe, just continue
  //       if (error.code !== "resource_missing") {
  //         console.error("Error cancelling subscription:", error);
  //       }
  //     }
  //     // Clear subscription ID
  //     user.subscription.stripeSubscriptionId = undefined;
  //   }

  //   await user.save();

  //   return res.json({
  //     success: true,
  //     message: "Switched to free plan successfully",
  //     subscription: {
  //       plan: "free",
  //       status: "active",
  //       dailyQueries: user.subscription.dailyQueries,
  //       remainingQueries: user.subscription.remainingQueries,
  //     },
  //   });
  // }

  // Check if the user has an active subscription
  const isActiveSubscription =
    user.subscription.status === "active" &&
    user.subscription.endDate &&
    new Date(user.subscription.endDate) > new Date();

  // Check if subscription ID exists and is valid
  const hasValidSubscriptionId =
    user.subscription.stripeSubscriptionId &&
    typeof user.subscription.stripeSubscriptionId === "string" &&
    user.subscription.stripeSubscriptionId.startsWith("sub_");

  if (isActiveSubscription) {
    // If current plan is the same as requested plan
    if (user.subscription.plan === plan) {
      return res.status(200).json({
        success: true,
        message: "You are already subscribed to this plan",
        subscription: {
          plan: user.subscription.plan,
          status: user.subscription.status,
          autoRenew: user.subscription.autoRenew,
          endDate: user.subscription.endDate,
          dailyQueries: user.subscription.dailyQueries,
          remainingQueries: user.subscription.remainingQueries,
        },
      });
    } else if (hasValidSubscriptionId) {
      // Handle plan switch for existing subscription
      try {
        // First verify the subscription exists in Stripe
        let subscription;
        try {
          subscription = await stripe.subscriptions.retrieve(
            user.subscription.stripeSubscriptionId
          );
        } catch (stripeError) {
          // Handle case where subscription ID exists in DB but not in Stripe
          if (stripeError.code === "resource_missing") {
            // Create a new subscription instead since the stored one doesn't exist
            const session = await createNewCheckoutSession(user, plan);
            return res.json({
              sessionId: session.id,
              message:
                "Creating new subscription (previous record not found in Stripe)",
              subscription: {
                plan: plan,
                status: "pending",
                ...getPlanDetails(plan),
              },
            });
          }
          throw stripeError;
        }

        // If subscription exists but is canceled or past due, create new one
        if (
          subscription.status === "canceled" ||
          subscription.status === "past_due"
        ) {
          const session = await createNewCheckoutSession(user, plan);
          return res.json({
            sessionId: session.id,
            message:
              "Creating new subscription (previous subscription is no longer active)",
            subscription: {
              plan: plan,
              status: "pending",
              ...getPlanDetails(plan),
            },
          });
        }

        // Update the existing active subscription
        await stripe.subscriptions.update(
          user.subscription.stripeSubscriptionId,
          {
            items: [
              {
                id: subscription.items.data[0].id,
                price: getStripePriceId(plan),
              },
            ],
            proration_behavior: "always_invoice",
          }
        );

        // Retrieve the updated subscription
        const updatedSubscription = await stripe.subscriptions.retrieve(
          user.subscription.stripeSubscriptionId
        );

        // Update user subscription details
        const priceId = updatedSubscription.items.data[0].price.id;
        const newPlan = getPlanFromPriceId(priceId);
        user.subscription.plan = newPlan;
        user.subscription.dailyQueries = planLimits[newPlan].dailyQueries;
        user.subscription.remainingQueries = planLimits[newPlan].dailyQueries;
        if (updatedSubscription.current_period_end) {
          user.subscription.endDate = new Date(
            updatedSubscription.current_period_end * 1000
          );
        }
        await user.save();

        return res.json({
          success: true,
          message: "Subscription updated successfully",
          subscription: {
            plan: user.subscription.plan,
            status: user.subscription.status,
            autoRenew: user.subscription.autoRenew,
            endDate: user.subscription.endDate,
            dailyQueries: user.subscription.dailyQueries,
            remainingQueries: user.subscription.remainingQueries,
          },
        });
      } catch (error) {
        console.error("Error updating subscription:", error);
        if (error.type === "StripeCardError") {
          return next(new ApiError(400, "Payment failed: " + error.message));
        }
        return next(
          new ApiError(500, "Failed to update subscription: " + error.message)
        );
      }
    }
  }

  // Default case: Create a new checkout session
  try {
    const session = await createNewCheckoutSession(user, plan);
    return res.json({
      sessionId: session.id,
      message: "Checkout session created successfully",
      subscription: {
        plan: plan,
        status: "pending",
        ...getPlanDetails(plan),
      },
    });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return next(
      new ApiError(500, "Failed to create checkout session: " + error.message)
    );
  }
});

// Helper function to create a new checkout session
async function createNewCheckoutSession(user, plan) {
  return await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{ price: getStripePriceId(plan), quantity: 1 }],
    mode: "subscription",
    success_url: `${getFrontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getFrontendUrl}/cancel`,
    client_reference_id: user._id.toString(),
    customer_email: user.email,
    metadata: {
      userId: user._id.toString(),
      userEmail: user.email,
      plan: plan,
    },
  });
}

export const handleWebhook = catchAsync(async (req, res, next) => {
  const sig = req.headers["stripe-signature"];
  const rawBody = req.body.toString("utf8");

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return next(new ApiError(400, `Webhook Error: ${err.message}`));
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id;
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription,
        { expand: ["latest_invoice"] }
      );

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
      if (subscription.start_date) {
        user.subscription.startDate = new Date(subscription.start_date * 1000);
      }
      if (subscription.current_period_end) {
        user.subscription.endDate = new Date(
          subscription.current_period_end * 1000
        );
      } else if (subscription.start_date) {
        const startDate = new Date(subscription.start_date * 1000);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 30);
        user.subscription.endDate = endDate;
      }
      user.subscription.stripeSubscriptionId = subscription.id;
      user.subscription.autoRenew = true;

      if (user.inboxList.length > planLimits[plan].maxInboxes) {
        user.inboxList = user.inboxList.slice(0, planLimits[plan].maxInboxes);
      }

      await user.save();
      await sendSubscriptionSuccessEmail(user);
    } else if (event.type === "customer.subscription.updated") {
      const subscription = await stripe.subscriptions.retrieve(
        event.data.object.id,
        { expand: ["latest_invoice"] }
      );

      const user = await User.findOne({
        "subscription.stripeSubscriptionId": subscription.id,
      });
      if (!user) {
        console.error(`User not found for subscription ID: ${subscription.id}`);
        return res.json({ received: true });
      }

      // Update plan if it has changed
      const priceId = subscription.items.data[0].price.id;
      const newPlan = getPlanFromPriceId(priceId);
      if (user.subscription.plan !== newPlan) {
        user.subscription.plan = newPlan;
        user.subscription.dailyQueries = planLimits[newPlan].dailyQueries;
        user.subscription.remainingQueries = planLimits[newPlan].dailyQueries;
      }

      if (subscription.cancel_at_period_end) {
        user.subscription.status = "active";
        user.subscription.autoRenew = false;
      } else {
        user.subscription.status = subscription.status;
        user.subscription.autoRenew = true;
      }

      if (subscription.current_period_end) {
        user.subscription.endDate = new Date(
          subscription.current_period_end * 1000
        );
      } else if (user.subscription.startDate) {
        const startDate = new Date(user.subscription.startDate);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 30);
        user.subscription.endDate = endDate;
      }

      await user.save();
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const user = await User.findOne({
        "subscription.stripeSubscriptionId": subscription.id,
      });
      if (!user) {
        console.error(`User not found for subscription ID: ${subscription.id}`);
        return res.json({ received: true });
      }

      user.subscription.plan = "free";
      user.subscription.dailyQueries = 5;
      user.subscription.remainingQueries = 5;
      user.subscription.status = "active";
      user.subscription.startDate = undefined;
      user.subscription.endDate = undefined;
      user.subscription.stripeSubscriptionId = undefined;
      user.subscription.autoRenew = false;
      await user.save();
      await sendSubscriptionCancelEmail(user);
      // Notify admins
      await sendAdminSubscriptionCancelNotification(
        user,
        "Subscription Cancelled",
        new Date()
      );
    }
  } catch (err) {
    console.error(`Error processing webhook event ${event.type}:`, err.message);
    return next(new ApiError(500, `Webhook processing error: ${err.message}`));
  }

  res.json({ received: true });
});

// Other functions remain unchanged
export const cancelSubscription = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.subscription.stripeSubscriptionId) {
    return next(new ApiError(400, "No active subscription found"));
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(
      user.subscription.stripeSubscriptionId
    );

    const updatedSubscription = await stripe.subscriptions.update(
      user.subscription.stripeSubscriptionId,
      { cancel_at_period_end: true }
    );

    let endDate =
      updatedSubscription.current_period_end &&
      !isNaN(updatedSubscription.current_period_end)
        ? new Date(updatedSubscription.current_period_end * 1000)
        : calculateFallbackEndDate(user.subscription.startDate);

    user.subscription.autoRenew = false;
    user.subscription.endDate = endDate;
    await user.save();

    // Send confirmation to user
    await sendSubscriptionCancelConfirmation(user, endDate);
    // Notify admins
    await sendAdminSubscriptionCancelNotification(
      user,
      "User-Initiated Cancellation at Period End",
      endDate
    );

    res.json({
      success: true,
      message: `Subscription will be cancelled at the end of the billing period ${endDate}`,
      endDate,
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    return next(new ApiError(500, "Failed to cancel subscription"));
  }
});

export const enableAutoRenew = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.subscription.stripeSubscriptionId) {
    return next(new ApiError(400, "No active subscription found"));
  }

  if (user.subscription.status !== "active") {
    return next(new ApiError(400, "Subscription is not active"));
  }

  try {
    const subscription = await stripe.subscriptions.update(
      user.subscription.stripeSubscriptionId,
      { cancel_at_period_end: false }
    );

    let endDate;
    if (subscription.current_period_end) {
      const timestamp = subscription.current_period_end * 1000;
      endDate = new Date(timestamp);
      if (isNaN(endDate.getTime())) {
        console.warn("Invalid date from Stripe, using fallback calculation");
        endDate = calculateFallbackEndDate(user.subscription.startDate);
      }
    } else {
      endDate = calculateFallbackEndDate(user.subscription.startDate);
    }

    user.subscription.autoRenew = true;
    user.subscription.endDate = endDate;
    await user.save();

    res.json({
      success: true,
      message: "Auto-renew has been enabled.",
      renewalDate: user.subscription.endDate,
    });
  } catch (error) {
    console.error("Error enabling auto-renew:", error);
    return next(new ApiError(500, "Failed to enable auto-renew"));
  }
});

export const cancelAutoRenew = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.subscription.stripeSubscriptionId) {
    return next(new ApiError(400, "No active subscription found"));
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(
      user.subscription.stripeSubscriptionId
    );

    const updatedSubscription = await stripe.subscriptions.update(
      user.subscription.stripeSubscriptionId,
      { cancel_at_period_end: true }
    );

    let endDate;
    if (updatedSubscription.current_period_end) {
      const timestamp = updatedSubscription.current_period_end * 1000;
      endDate = new Date(timestamp);
      if (isNaN(endDate.getTime())) {
        console.warn("Invalid date from Stripe, using fallback calculation");
        endDate = calculateFallbackEndDate(user.subscription.startDate);
      }
    } else {
      endDate = calculateFallbackEndDate(user.subscription.startDate);
    }

    user.subscription.autoRenew = false;
    user.subscription.endDate = endDate;
    await user.save();

    res.json({
      success: true,
      message:
        "Auto-renew has been disabled. Your subscription will remain active until the end of the current billing period.",
      expiryDate: user.subscription.endDate,
    });
  } catch (error) {
    console.error("Error cancelling auto-renew:", error);
    return next(new ApiError(500, "Failed to cancel auto-renew"));
  }
});

export const adminCancelUserSubscription = catchAsync(
  async (req, res, next) => {
    if (req.user.role !== "admin" && req.user.role !== "super_admin") {
      return next(new ApiError(403, "Unauthorized access"));
    }

    const { userId, immediate = true } = req.body;
    if (!userId) {
      return next(new ApiError(400, "User ID is required"));
    }

    const user = await User.findById(userId);
    if (!user || !user.subscription.stripeSubscriptionId) {
      return next(
        new ApiError(400, "No active subscription found for this user")
      );
    }

    try {
      const subscription = await stripe.subscriptions.retrieve(
        user.subscription.stripeSubscriptionId
      );

      if (subscription.status === "canceled") {
        user.subscription.plan = "free";
        user.subscription.status = "active";
        user.subscription.endDate = new Date();
        user.subscription.autoRenew = false;
        user.subscription.remainingQueries = 5;
        user.subscription.dailyQueries = 5;
        user.subscription.stripeSubscriptionId = undefined;

        await user.save();
        return res.status(200).json({
          success: true,
          message:
            "User has been moved to free plan (subscription was already canceled)",
          user: {
            id: user._id,
            email: user.email,
            subscriptionStatus: user.subscription.status,
            plan: user.subscription.plan,
          },
        });
      }

      if (
        subscription.status === "active" ||
        subscription.status === "trialing"
      ) {
        if (immediate) {
          const cancelResponse = await stripe.subscriptions.cancel(
            user.subscription.stripeSubscriptionId
          );

          if (cancelResponse.status !== "canceled") {
            return next(new ApiError(500, "Failed to cancel subscription"));
          }

          user.subscription.plan = "free";
          user.subscription.status = "active";
          user.subscription.endDate = new Date();
          user.subscription.autoRenew = false;
          user.subscription.remainingQueries = 5;
          user.subscription.dailyQueries = 5;
          user.subscription.stripeSubscriptionId = undefined;

          await user.save();
          await sendSubscriptionCancelEmail(user);
          // Notify admins
          await sendAdminSubscriptionCancelNotification(
            user,
            "Admin-Initiated Immediate Cancellation User Subscription.",
            new Date()
          );

          return res.status(200).json({
            success: true,
            message: "User has been moved to free plan immediately",
            user: {
              id: user._id,
              email: user.email,
              subscriptionStatus: user.subscription.status,
              plan: user.subscription.plan,
            },
          });
        } else {
          const updatedSubscription = await stripe.subscriptions.update(
            user.subscription.stripeSubscriptionId,
            { cancel_at_period_end: true }
          );

          let endDate =
            updatedSubscription.current_period_end &&
            !isNaN(updatedSubscription.current_period_end)
              ? new Date(updatedSubscription.current_period_end * 1000)
              : calculateFallbackEndDate(user.subscription.startDate);

          user.subscription.autoRenew = false;
          user.subscription.endDate = endDate;

          await user.save();

          await sendSubscriptionCancelConfirmation(user, endDate);
          // Notify admins
          await sendAdminSubscriptionCancelNotification(
            user,
            "Admin-Initiated Cancellation at Period End",
            endDate
          );

          return res.status(200).json({
            success: true,
            message:
              "User subscription will be cancelled at the end of the billing period",
            user: {
              id: user._id,
              email: user.email,
              subscriptionStatus: user.subscription.status,
              endDate: user.subscription.endDate,
            },
          });
        }
      }
    } catch (error) {
      console.error("Error cancelling subscription:", error);
      return next(
        new ApiError(500, `Failed to cancel subscription: ${error.message}`)
      );
    }
  }
);

export const adminTotalEarningByUserSubscription = catchAsync(
  async (req, res, next) => {
    let totalIncome = 0;
    const paymentHistory = [];

    try {
      let params = { limit: 100 };
      let invoices;

      do {
        invoices = await stripe.invoices.list(params);
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
        message: "Failed to retrieve total earnings.",
      });
    }
  }
);

const getStripePriceId = (plan) =>
  ({
    free: process.env.STRIPE_PRICE_FREE,
    basic: process.env.STRIPE_PRICE_BASIC,
    premium: process.env.STRIPE_PRICE_PREMIUM,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  }[plan]);

const getPlanFromPriceId = (priceId) => priceIdToPlan[priceId] || "free";

function calculateFallbackEndDate(startDate) {
  if (!startDate) {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);
    return endDate;
  }

  let parsedStartDate;
  if (typeof startDate === "string") {
    parsedStartDate = new Date(startDate);
  } else {
    parsedStartDate = new Date(startDate);
  }

  if (isNaN(parsedStartDate.getTime())) {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);
    return endDate;
  }

  const endDate = new Date(parsedStartDate);
  endDate.setDate(endDate.getDate() + 30);
  return endDate;
}
