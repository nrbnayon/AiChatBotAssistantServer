// routes\userRoutes.js
import express from "express";
import {
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  getAllUsers,
} from "../controllers/userController.js";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";

const router = express.Router();

router.get("/me", auth(),setRefreshedTokenCookie, rateLimitMiddleware(), getMe);
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
router.get(
  "/admin/users",
  auth("ADMIN"),
  setRefreshedTokenCookie,
  rateLimitMiddleware({ max: 1000 }),
  getAllUsers
);

export default router;
