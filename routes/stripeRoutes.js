// routes/stripeRoutes.js
import express from "express";
import {
  createCheckoutSession,
  cancelSubscription,
  cancelAutoRenew,
  adminCancelUserSubscription,
  adminTotalEarningByUserSubscription,
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

// Cancel auto-renew
router.post(
  "/cancel-auto-renew",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  cancelAutoRenew
);

// Admin/Super-Admin Cancel user subscription
router.post(
  "/admin/cancel-user-subscription",
  auth("admin", "super_admin"), 
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  adminCancelUserSubscription
);

// Admin/Super-Admin total earning by user subscription
router.post(
  "/admin/total-earning-by-user-subscription",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  adminTotalEarningByUserSubscription
);

export default router;