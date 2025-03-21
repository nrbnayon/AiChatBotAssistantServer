// routes\stripeRoutes.js
import express from "express";
import {
  createCheckoutSession,
  handleWebhook,
} from "../controllers/stripeController.js";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";

const router = express.Router();

router.post(
  "/create-checkout-session",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  createCheckoutSession
);
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

export default router;
