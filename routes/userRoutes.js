// routes\userRoutes.js
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
  addInbox,
  getIncome,
  getUserStats,
  approveWaitingList,
  rejectWaitingList,
} from "../controllers/userController.js";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import WaitingList from "../models/WaitingList.js";

const router = express.Router();

/**
 * ╔═══════════════════════════════════════╗
 * ║    Public Waiting List Endpoint       ║
 * ╚═══════════════════════════════════════╝
 * @description Allows users to join the waiting list
 * @route POST /add-to-waiting-list
 * @access Public
 * @param {string} email - User's email address
 * @param {string} name - User's name
 * @param {string} inbox - User's preferred inbox
 * @param {string} description - Additional user details
 */
router.post("/add-to-waiting-list", async (req, res) => {
  const { email, name, inbox, description } = req.body;
  try {
    const entry = new WaitingList({ email, name, inbox, description });
    await entry.save();
    res.status(201).json({ message: "Added to waiting list" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

/**
 * ╔═══════════════════════════════════════╗
 * ║    Authenticated User Endpoints       ║
 * ╚═══════════════════════════════════════╝
 * @description Routes for authenticated user operations
 */
// 🔐 Retrieve current user's profile information
router.get(
  "/me",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  getMe
);

// 🖊️ Update user profile details
router.put(
  "/profile",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateProfile
);

// 💳 Manage user subscription settings
router.put(
  "/subscription",
  auth("user"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateSubscription
);

// 🗑️ Delete user account
router.delete(
  "/me",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  deleteMe
);

// 🏷️ Update user's keywords or interests
router.put(
  "/keywords",
  auth("user"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateKeywords
);

// 📥 Add a new inbox for the user
router.post(
  "/add-inbox",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  addInbox
);

/**
 * ╔═══════════════════════════════════════╗
 * ║     Admin: User Management            ║
 * ╚═══════════════════════════════════════╝
 * @description Administrative routes for user management
 * @access Admin only
 */
// Retrieve all registered users
router.get(
  "/admin/users",
  auth("admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware({ max: 1000 }),
  getAllUsers
);

// Create a new user
router.post(
  "/admin/users",
  auth("admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  createUser
);

// Delete a specific user
router.delete(
  "/admin/users/:id",
  auth("admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  deleteUser
);

/**
 * ╔═══════════════════════════════════════╗
 * ║     Admin: Financial Endpoints        ║
 * ╚═══════════════════════════════════════╝
 * @description Routes for financial and statistical data
 * @access Admin only
 */
// Retrieve income information
router.get("/income", auth("admin"), setRefreshedTokenCookie, getIncome);

// Get user platform statistics
router.get("/stats", auth("admin"), setRefreshedTokenCookie, getUserStats);

/**
 * ╔═══════════════════════════════════════╗
 * ║     Waiting List Management           ║
 * ╚═══════════════════════════════════════╝
 * @description Admin routes for waiting list operations
 * @access Admin only
 */
// Approve a user from the waiting list
router.post(
  "/waiting-list/approve",
  auth("admin"),
  setRefreshedTokenCookie,
  approveWaitingList
);

// Reject a user from the waiting list
router.post(
  "/waiting-list/reject",
  auth("admin"),
  setRefreshedTokenCookie,
  rejectWaitingList
);

export default router;
