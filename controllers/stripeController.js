import Stripe from "stripe";
import dotenv from "dotenv";
import User from "../models/User.js";
import { ApiError, catchAsync } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const priceIdToPlan = {
  [process.env.STRIPE_PRICE_BASIC]: "basic",
  [process.env.STRIPE_PRICE_PREMIUM]: "premium",
  [process.env.STRIPE_PRICE_ENTERPRISE]: "enterprise",
};

export const createCheckoutSession = catchAsync(async (req, res, next) => {
  const { plan } = req.body;
  const user = await User.findById(req.user.id);

  if (!["basic", "premium", "enterprise"].includes(plan)) {
    return next(new AppError("Invalid plan", 400));
  }

  if (user.subscription.status === "active") {
    return next(new AppError("Subscription already active", 400));
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price: getStripePriceId(plan),
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    client_reference_id: user._id.toString(),
  });

  res.json({ sessionId: session.id });
});

const getStripePriceId = (plan) => {
  return {
    basic: process.env.STRIPE_PRICE_BASIC || 5,
    premium: process.env.STRIPE_PRICE_PREMIUM || 15,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 50,
  }[plan];
};

export const handleWebhook = catchAsync(async (req, res, next) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return next(new ApiError(`Webhook Error: ${err.message}`, 400));
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription
    );
    const priceId = subscription.items.data[0].price.id;
    const plan = getPlanFromPriceId(priceId);

    const user = await User.findById(userId);
    if (user) {
      user.subscription.plan = plan;
      user.subscription.status = "active";
      user.subscription.dailyQueries = getDailyQueries(plan);
      user.subscription.startDate = new Date();

      const maxInboxes = getMaxInboxes(plan);
      if (user.inboxList.length > maxInboxes) {
        user.inboxList = user.inboxList.slice(0, maxInboxes);
      }
      await user.save();
    }
  }

  res.json({ received: true });
});

const getPlanFromPriceId = (priceId) => {
  return priceIdToPlan[priceId] || "basic"; // Fallback to "basic" if price ID is unrecognized
};

const getDailyQueries = (plan) =>
  ({
    basic: 15,
    premium: 100,
    enterprise: Infinity,
  }[plan]);

const getMaxInboxes = (plan) =>
  ({
    basic: 1,
    premium: 3,
    enterprise: 10,
  }[plan]);
