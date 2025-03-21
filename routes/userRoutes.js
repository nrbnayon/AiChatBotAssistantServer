import express from "express";
import {
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  getAllUsers,
  updateKeywords,
  createUser, 
  deleteUser, 
} from "../controllers/userController.js";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";

const router = express.Router();

// Existing routes (accessible to authenticated users)
router.get(
  "/me",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  getMe
);
router.put(
  "/profile",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateProfile
);
router.put(
  "/subscription",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateSubscription
);
router.delete(
  "/me",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  deleteMe
);

// Admin-only routes (accessible only to users with ADMIN role)
router.get(
  "/admin/users",
  auth("ADMIN"),
  setRefreshedTokenCookie,
  rateLimitMiddleware({ max: 1000 }),
  getAllUsers
);
router.put(
  "/keywords",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateKeywords
);
router.post(
  "/admin/users",
  auth("ADMIN"), // Restricts to ADMIN role
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  createUser
);
router.delete(
  "/admin/users/:id",
  auth("ADMIN"), // Restricts to ADMIN role
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  deleteUser
);

export default router;
