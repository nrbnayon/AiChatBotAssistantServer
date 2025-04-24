// routes/userRoutes.js
import express from "express";
import {
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  getAllUsers,
  getKeywords,
  addKeyword,
  deleteKeyword,
  updateKeywords,
  createUser,
  deleteUser,
  updateUser,
  addInbox,
  getIncome,
  getUserStats,
  approveWaitingList,
  rejectWaitingList,
  getAllWaitingList,
  getAllSystemMessages,
  getSystemMessage,
  createSystemMessage,
  updateSystemMessage,
  deleteSystemMessage,
  getAllAiModels,
  getAiModel,
  createAiModel,
  updateAiModel,
  deleteAiModel,
} from "../controllers/userController.js";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import WaitingList from "../models/WaitingList.js";
import upload from "../middleware/multerConfig.js";
import {
  sendAdminNotification,
  sendWaitingListConfirmation,
} from "../helper/notifyByEmail.js";
import User from "../models/User.js";

const router = express.Router();

/**
 * ╔═══════════════════════════════════════╗
 * ║    Public Waiting List Endpoint       ║
 * ╚═══════════════════════════════════════╝
 */
router.post("/add-to-waiting-list", async (req, res) => {
  // console.log("New waiting list entry:", req.body);
  const { email, name, inbox, description } = req.body;

  try {
    // Normalize email to match schema's pre-save hook
    const normalizedEmail = email.toLowerCase().trim();

    // Step 1: Check if the email exists in the User collection
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(200).json({ message: "You are already registered." });
    }

    // Step 2: Check if the email exists in the WaitingList collection
    const existingWaiting = await WaitingList.findOne({
      email: normalizedEmail,
    });
    if (existingWaiting) {
      if (existingWaiting.status === "waiting") {
        return res
          .status(200)
          .json({ message: "You are already on the waiting list." });
      } else if (existingWaiting.status === "approved") {
        return res.status(200).json({
          message: "Your request has been approved. Please proceed to login.",
        });
      } else if (existingWaiting.status === "rejected") {
        return res.status(200).json({
          message:
            "Your request has been rejected. Please contact the support team.",
        });
      }
    }

    // Step 3: If not in User or WaitingList, add to WaitingList
    const entry = new WaitingList({
      email: normalizedEmail,
      name,
      inbox,
      description,
    });
    await entry.save();

    // Send confirmation emails
    await sendWaitingListConfirmation(entry);
    await sendAdminNotification(entry);

    res.status(201).json({
      message:
        "Added to waiting list. We will notify you when approved by admin.",
      entry,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/waiting-list-status", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const entry = await WaitingList.findOne({ email });
    if (!entry) {
      return res.status(404).json({
        message: "Not found in waiting list",
        status: "not_found",
      });
    }

    return res.status(200).json({
      success: true,
      data: entry,
      status: entry.status,
      message: `Your status is: ${entry.status}`,
    });
  } catch (error) {
    console.error("Error checking waiting list status:", error);
    res.status(500).json({ message: "Server error" });
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
  upload.single("profilePicture"),
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

// 🏷️ Retrieve user's keywords
router.get(
  "/keywords",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  getKeywords
);

// 🏷️ Add a new keyword
router.post(
  "/keywords",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  addKeyword
);

// 🏷️ Remove a specific keyword
router.delete(
  "/keywords/:keyword",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  deleteKeyword
);

// 🏷️ Update user's keywords (replace entire list)
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
 * @access Admin and Super Admin
 */
// Retrieve all registered users
router.get(
  "/admin/users",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware({ max: 1000 }),
  getAllUsers
);

// Create a new user
router.post(
  "/admin/users",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  createUser
);

// Update a specific user
router.put(
  "/admin/users/:id",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateUser
);

// Delete a specific user
router.delete(
  "/admin/users/:id",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  deleteUser
);

/**
 * ╔═══════════════════════════════════════╗
 * ║     Admin: Financial Endpoints        ║
 * ╚═══════════════════════════════════════╝
 * @description Routes for financial and statistical data
 * @access Admin and Super Admin
 */
// Retrieve income information
router.get(
  "/income",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  getIncome
);

// Get user platform statistics
router.get(
  "/stats",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  getUserStats
);

/**
 * ╔═══════════════════════════════════════╗
 * ║     Waiting List Management           ║
 * ╚═══════════════════════════════════════╝
 * @description Admin routes for waiting list operations
 * @access Admin and Super Admin
 */
// Retrieve all waiting list entries
router.get(
  "/admin/waiting-list",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  getAllWaitingList
);

// Approve a user from the waiting list
router.post(
  "/waiting-list/approve",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  approveWaitingList
);

// Reject a user from the waiting list
router.post(
  "/waiting-list/reject",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  rejectWaitingList
);

/**
 * ╔═══════════════════════════════════════╗
 * ║     System Messages Management        ║
 * ╚═══════════════════════════════════════╝
 * @description Routes for managing system messages
 * @access Admin and Super Admin
 */
router.get(
  "/admin/system-messages",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  getAllSystemMessages
);
router.get(
  "/admin/system-messages/:id",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  getSystemMessage
);
router.post(
  "/admin/system-messages",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  createSystemMessage
);
router.put(
  "/admin/system-messages/:id",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  updateSystemMessage
);
router.delete(
  "/admin/system-messages/:id",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  deleteSystemMessage
);

/**
 * ╔═══════════════════════════════════════╗
 * ║     AI Model Management               ║
 * ╚═══════════════════════════════════════╝
 * @description Routes for managing AI models
 * @access Admin and Super Admin
 */
router.get(
  "/admin/ai-models",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  getAllAiModels
);
router.get(
  "/admin/ai-models/:id",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  getAiModel
);
router.post(
  "/admin/ai-models",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  createAiModel
);
router.put(
  "/admin/ai-models/:id",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  updateAiModel
);
router.delete(
  "/admin/ai-models/:id",
  auth("admin", "super_admin"),
  setRefreshedTokenCookie,
  deleteAiModel
);

export default router;
