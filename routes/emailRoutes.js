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
} from "../controllers/emailController.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Route for fetching emails with optional filter
router.get("/", auth(), emailAuth, rateLimitMiddleware(), (req, res) => {
  const filter = req.query.filter || "all";
  fetchEmails(req, res, filter);
});

// Route for fetching important emails using AI filtering
router.get(
  "/important",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  fetchImportantEmails
);

// Route for getting a single email by ID
router.get("/:emailId", auth(), setRefreshedTokenCookie, emailAuth, readEmail);

// Route for sending an email
router.post(
  "/send",
  auth(),
  emailAuth,
  uploadMiddleware.array("attachments"),
  sendEmail
);

// Route for replying to an email
router.post(
  "/reply/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  uploadMiddleware.array("attachments"),
  replyToEmail
);

// Route for trashing an email
router.delete("/trash/:emailId", auth(), emailAuth, trashEmail);

// Route for searching emails
router.get("/all/search", auth(), emailAuth, searchEmails);

// Route for marking email as read
router.patch("/mark-as-read/:emailId", auth(), emailAuth, markEmailAsRead);

// Route for summarizing an email
router.get("/summarize/:emailId", auth(), emailAuth, summarizeEmail);

// Route for chatting with AI bot
router.post("/chat", auth(), emailAuth, chatWithBot);

export default router;
