import Stripe from "stripe";
import dotenv from "dotenv";
import User from "../models/User.js";
import userService from "../services/userService.js";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const createCheckoutSession = async (req, res) => {
  try {
    const { plan } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const subscriptionPlans = {
      basic: { price: 999, dailyTokens: 1000000, duration: 90 },
      premium: { price: 1999, dailyTokens: Infinity, duration: 30 },
      enterprise: { price: 9999, dailyTokens: Infinity, duration: 730 },
    };

    if (!subscriptionPlans[plan]) {
      return res.status(400).json({ success: false, message: "Invalid plan" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${
                plan.charAt(0).toUpperCase() + plan.slice(1)
              } Subscription`,
              description: `Access to ${plan} plan with ${subscriptionPlans[plan].dailyTokens} daily tokens`,
            },
            unit_amount: subscriptionPlans[plan].price,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`,
      metadata: {
        userId: user._id.toString(),
        plan,
      },
    });

    res.json({ success: true, sessionId: session.id });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log(
      "[DEBUG] Webhook received - Event:",
      event.type,
      event.data.object
    );
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).json({ success: false, message: "Webhook Error" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { userId, plan } = session.metadata;

    console.log(
      "[DEBUG] Webhook - Processing session:",
      session.id,
      "userId:",
      userId,
      "plan:",
      plan
    );

    try {
      await userService.updateSubscription(userId, { plan });
      console.log(`[DEBUG] Subscription updated for user ${userId} to ${plan}`);
    } catch (error) {
      console.error("[ERROR] Error updating subscription:", error.message);
      // Optionally log the full error stack for more details
      console.error(error);
    }
  }

  res.json({ received: true });
};

export { createCheckoutSession, handleWebhook };
