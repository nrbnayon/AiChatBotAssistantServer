// routes\emailRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import emailAuth from "../middleware/emailMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
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
 * @description Configures multer for file upload management
 * @middleware Handles file storage and naming conventions
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
 * @description Routes for retrieving emails
 * @access Authenticated Users
 */
// Fetch emails with optional filtering
router.get("/", auth(), emailAuth, rateLimitMiddleware(), (req, res) => {
  const filter = req.query.filter || "all";
  fetchEmails(req, res, filter);
});

// Fetch important emails
router.get(
  "/important",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  fetchImportantEmails
);

// Read a specific email
router.get("/:emailId", auth(), setRefreshedTokenCookie, emailAuth, readEmail);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Email Interaction Routes            ║
 * ╚═══════════════════════════════════════╝
 * @description Routes for email sending, replying, and management
 * @access Authenticated Users
 */
// Send a new email with attachments
router.post(
  "/send",
  auth(),
  emailAuth,
  uploadMiddleware.array("attachments"),
  sendEmail
);

// Reply to an existing email with attachments
router.post(
  "/reply/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  uploadMiddleware.array("attachments"),
  replyToEmail
);

// Move email to trash
router.delete(
  "/trash/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  trashEmail
);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Email Management Routes            ║
 * ╚═══════════════════════════════════════╝
 * @description Routes for email search and status management
 * @access Authenticated Users
 */
// Search emails
router.get(
  "/all/search",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  searchEmails
);

// Mark email as read
router.patch(
  "/mark-as-read/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  markEmailAsRead
);

// Summarize email content
router.get(
  "/summarize/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  summarizeEmail
);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Additional Email Features          ║
 * ╚═══════════════════════════════════════╝
 * @description Advanced email interaction routes
 * @access Authenticated Users
 */
// AI-powered email chat
router.post("/chat", auth(), emailAuth, setRefreshedTokenCookie, chatWithBot);

// Create email draft with attachments
router.post(
  "/draft",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  uploadMiddleware.array("attachments"),
  createDraft
);

export default router;
