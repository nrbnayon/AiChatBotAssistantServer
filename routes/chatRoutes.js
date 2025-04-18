// routes/chatRoutes.js
import express from "express";
import mongoose from "mongoose";

import auth from "../middleware/authMiddleware.js";
import {
  createChat,
  getChats,
  getChatById,
  updateChat,
  deleteChat,
} from "../controllers/chatController.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";

const router = express.Router();

// Middleware to validate MongoDB ObjectId
const validateObjectId = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({
      success: false,
      message: "Invalid Chat ID format",
    });
  }
  next();
};

// Create a new chat
router.post("/", auth(), rateLimitMiddleware(), createChat);

// Get all chats for the authenticated user
router.get("/", auth(), rateLimitMiddleware(), getChats);

// Get a specific chat by ID
router.get(
  "/:id",
  auth(),
  rateLimitMiddleware(),
  validateObjectId,
  getChatById
);

// Update a chat (e.g., rename it)
router.put("/:id", auth(), rateLimitMiddleware(), validateObjectId, updateChat);

// Delete a chat
router.delete(
  "/:id",
  auth(),
  rateLimitMiddleware(),
  validateObjectId,
  deleteChat
);

export default router;
