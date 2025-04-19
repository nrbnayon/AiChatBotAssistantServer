// routes/stripeRoutes.js
import express from "express";
import {
  createCheckoutSession,
  cancelSubscription,
  cancelAutoRenew,
  enableAutoRenew,
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
  rateLimitMiddleware({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: "You can only create three checkout session every 5 minutes.",
  }),
  createCheckoutSession
);

// Cancel subscription
router.post(
  "/cancel-subscription",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: "You can only cancel subscription three times every 5 minutes.",
  }),
  cancelSubscription
);

// Cancel auto-renew
router.post(
  "/cancel-auto-renew",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 5 * 60 * 1000,
    max: 1,
    message: "You can only cancel auto-renew one times every 5 minutes.",
  }),
  cancelAutoRenew
);

router.post(
  "/enable-auto-renew",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 5 * 60 * 1000,
    max: 1,
    message: "You can only enable auto-renew once every 5 minutes.",
  }),
  enableAutoRenew
);

// Admin/Super-Admin Cancel user subscription
router.put(
  "/admin/cancel-user-subscription",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  adminCancelUserSubscription
);

// Admin/Super-Admin total earning by user subscription
router.get(
  "/admin/total-earning-by-user-subscription",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  adminTotalEarningByUserSubscription
);

export default router;
