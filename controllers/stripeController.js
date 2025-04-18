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

  if (
    user.subscription.status === "active" &&
    user.subscription.endDate > new Date()
  ) {
    return next(new ApiError("Subscription already active", 400));
  }

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
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription
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
      user.subscription.startDate = new Date(subscription.start_date * 1000);
      user.subscription.endDate = new Date(
        subscription.current_period_end * 1000
      );
      user.subscription.stripeSubscriptionId = subscription.id;
      if (user.inboxList.length > planLimits[plan].maxInboxes) {
        user.inboxList = user.inboxList.slice(0, planLimits[plan].maxInboxes);
      }
      await user.save();

      await sendSubscriptionSuccessEmail(user);
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const user = await User.findOne({
        "subscription.stripeSubscriptionId": subscription.id,
      });
      if (!user) {
        console.error(`User not found for subscription ID: ${subscription.id}`);
        return res.json({ received: true });
      }

      user.subscription.status =
        subscription.status === "active" ? "active" : "cancelled";
      user.subscription.endDate = new Date(
        subscription.current_period_end * 1000
      );
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

      user.subscription.status = "cancelled";
      user.subscription.endDate = new Date();
      await user.save();

      await sendSubscriptionCancelEmail(user);
    }
  } catch (err) {
    console.error(`Error processing webhook event ${event.type}:`, err.message);
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
    user.subscription.status =
      subscription.status === "active" ? "active" : "cancelled";
    user.subscription.endDate = new Date(
      subscription.current_period_end * 1000
    );
    user.subscription.autoRenew = false;
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

const getStripePriceId = (plan) => {
  return {
    basic: process.env.STRIPE_PRICE_BASIC,
    premium: process.env.STRIPE_PRICE_PREMIUM,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  }[plan];
};

const getPlanFromPriceId = (priceId) => priceIdToPlan[priceId] || "basic";