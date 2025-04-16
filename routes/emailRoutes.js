// routes\emailRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import emailAuth from "../middleware/emailMiddleware.js";
import { rateLimitMiddleware, chatRateLimit } from "../middleware/rateLimit.js";
import { fileURLToPath } from "url";
import { dirname } from "path";
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
  fetchImportantEmails,
  createDraft,
} from "../controllers/emailController.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ╔═══════════════════════════════════════╗
 * ║    File Upload Configuration          ║
 * ╚═══════════════════════════════════════╝
 */
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

/**
 * ╔═══════════════════════════════════════╗
 * ║    Email Fetching Routes              ║
 * ╚═══════════════════════════════════════╝
 */
// Fetch emails with optional filtering
router.get(
  "/",
  auth(),
  emailAuth,
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: "Too many email fetch requests. Please try again later.",
  }),
  (req, res) => {
    const filter = req.query.filter || "all";
    fetchEmails(req, res, filter);
  }
);

// Fetch important emails
router.get(
  "/important",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: "Too many important email requests. Please try again later.",
  }),
  fetchImportantEmails
);

// Read a specific email
router.get(
  "/:emailId",
  auth(),
  setRefreshedTokenCookie,
  emailAuth,
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many email read requests. Please slow down.",
  }),
  readEmail
);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Email Interaction Routes            ║
 * ╚═══════════════════════════════════════╝
 */
// Send a new email with attachments
router.post(
  "/send",
  auth(),
  emailAuth,
  rateLimitMiddleware({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: "Too many emails sent. Please wait before sending more.",
  }),
  uploadMiddleware.array("attachments"),
  sendEmail
);

// Reply to an existing email with attachments
router.post(
  "/reply/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 30 * 60 * 1000,
    max: 15,
    message: "Too many email replies. Please slow down.",
  }),
  uploadMiddleware.array("attachments"),
  replyToEmail
);

// Move email to trash
router.delete(
  "/trash/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "Too many trash actions. Please slow down.",
  }),
  trashEmail
);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Email Management Routes            ║
 * ╚═══════════════════════════════════════╝
 */
// Search emails
router.get(
  "/all/search",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 25,
    message: "Too many search requests. Please try again later.",
  }),
  searchEmails
);

// Mark email as read
router.patch(
  "/mark-as-read/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: "Too many mark as read actions. Please slow down.",
  }),
  markEmailAsRead
);

// Summarize email content
router.get(
  "/summarize/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 30 * 60 * 1000,
    max: 10,
    message: "Too many email summarization requests. Please try again later.",
  }),
  summarizeEmail
);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Additional Email Features          ║
 * ╚═══════════════════════════════════════╝
 */
// AI-powered email chat
router.post(
  "/chat",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  chatRateLimit(),
  chatWithBot
);

// Create email draft with attachments
router.post(
  "/draft",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: "Too many draft creations. Please slow down.",
  }),
  uploadMiddleware.array("attachments"),
  createDraft
);

router.get("/download/attachment", auth(), async (req, res) => {
  const { emailId, attachmentId } = req.query;
  if (!emailId || !attachmentId) {
    return res.status(400).json({ error: "Missing emailId or attachmentId" });
  }
  try {
    const emailService = await getEmailService(req);
    const attachment = await emailService.getAttachment(emailId, attachmentId);
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachment.filename}"`
    );
    res.send(attachment.content);
  } catch (error) {
    console.error("Failed to download attachment:", error);
    res.status(500).json({ error: "Failed to download attachment" });
  }
});

export default router;
