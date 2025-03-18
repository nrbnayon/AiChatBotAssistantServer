import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import auth from "../middleware/authMiddleware.js";
import emailAuth from "../middleware/emailMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import {
  fetchEmails,
  sendEmail,
  readEmail,
  replyToEmail,
  trashEmail,
  searchEmails,
  markEmailAsRead,
  summarizeEmail,
  chatWithBot,
  upload,
} from "../controllers/emailController.js";
import { createEmailService } from "../services/emailService.js";
import { catchAsync } from "../utils/errorHandler.js";
import User from "../models/User.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const uploadMiddleware = multer({ storage });

// Fetch emails
router.get("/", auth(), emailAuth, rateLimitMiddleware(), fetchEmails);

// Get a single email by ID
router.get("/:id", auth(), emailAuth, readEmail);

// Send an email
router.post(
  "/send",
  auth(),
  emailAuth,
  uploadMiddleware.array("attachments"),
  sendEmail
);

// Reply to an email
router.post(
  "/reply/:emailId",
  auth(),
  emailAuth,
  uploadMiddleware.array("attachments"),
  replyToEmail
);

// Trash an email
router.delete("/trash/:emailId", auth(), emailAuth, trashEmail);

// Search emails
router.get("/search", auth(), emailAuth, searchEmails);

// Mark email as read
router.patch("/mark-as-read/:emailId", auth(), emailAuth, markEmailAsRead);

// Summarize an email
router.get("/summarize/:emailId", auth(), emailAuth, summarizeEmail);

// Chat with AI bot
router.post("/chat", auth(), emailAuth, chatWithBot);

// Fetch important emails with AI filtering
router.get(
  "/important",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const user = await User.findById(req.user.id);
    const { query, maxResults, pageToken, keywords, timeRange } = req.query;
    const result = await emailService.fetchEmails({
      query: query?.toString(),
      maxResults: parseInt(maxResults?.toString() || "100"),
      pageToken: pageToken?.toString(),
    });
    const customKeywords = keywords ? keywords.split(",") : [];
    const importantEmails = await emailService.filterImportantEmails(
      result.messages,
      customKeywords,
      timeRange?.toString() || "weekly"
    );
    res.json({
      success: true,
      messages: importantEmails,
      nextPageToken: result.nextPageToken,
    });
  })
);

export default router;
