// routes\userRoutes.js
import express from "express";
import {
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  getAllUsers,
} from "../controllers/userController.js";
import auth from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";

const router = express.Router();

router.get("/me", auth(), rateLimitMiddleware(), getMe);
router.put("/profile", auth(), rateLimitMiddleware(), updateProfile);
router.put("/subscription", auth(), rateLimitMiddleware(), updateSubscription);
router.delete("/me", auth(), rateLimitMiddleware(), deleteMe);
router.get(
  "/admin/users",
  auth("ADMIN"),
  rateLimitMiddleware({ max: 1000 }),
  getAllUsers
);

export default router;
