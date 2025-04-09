// routes/chatRoutes.js
import express from "express";
import auth from "../middleware/authMiddleware.js";
import {
  createChat,
  getChats,
  getChatById,
  updateChat,
  deleteChat,
} from "../controllers/chatController.js";

const router = express.Router();

// Create a new chat
router.post("/", auth(), createChat);

// Get all chats for the authenticated user
router.get("/", auth(), getChats);

// Get a specific chat by ID
router.get("/:id", auth(), getChatById);

// Update a chat (e.g., rename it)
router.put("/:id", auth(), updateChat);

// Delete a chat
router.delete("/:id", auth(), deleteChat);

export default router;
