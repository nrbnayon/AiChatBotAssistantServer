// routes\stripeRoutes.js
import express from "express";
import {
  createCheckoutSession,
  cancelSubscription,
} from "../controllers/stripeController.js";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";

const router = express.Router();

// Create checkout session
router.post(
  "/create-checkout-session",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  createCheckoutSession
);

// Cancel subscription
router.post(
  "/cancel-subscription",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  cancelSubscription
);

export default router;