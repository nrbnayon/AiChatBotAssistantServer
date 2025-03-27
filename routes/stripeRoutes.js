import express from "express";
import {
  createCheckoutSession,
  handleWebhook,
} from "../controllers/stripeController.js";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";

const router = express.Router();

/**
 * ╔═══════════════════════════════════════╗
 * ║    Stripe Checkout Session Creation   ║
 * ╚═══════════════════════════════════════╝
 * @description Create a new Stripe checkout session
 * @route POST /create-checkout-session
 * @access Authenticated Users
 * @middleware Authentication, Token Refresh, Rate Limiting
 */
router.post(
  "/create-checkout-session",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  createCheckoutSession
);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Stripe Webhook Endpoint            ║
 * ╚═══════════════════════════════════════╝
 * @description Handles incoming Stripe webhook events
 * @route POST /webhook
 * @access Stripe Service
 * @middleware Raw body parsing for webhook verification
 */
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

export default router;
