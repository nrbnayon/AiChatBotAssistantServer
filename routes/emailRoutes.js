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

router.get("/", auth(), emailAuth, rateLimitMiddleware(), (req, res) => {
  const filter = req.query.filter || "all";
  fetchEmails(req, res, filter);
});

router.get(
  "/important",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  fetchImportantEmails
);

router.get("/:emailId", auth(), setRefreshedTokenCookie, emailAuth, readEmail);

router.post(
  "/send",
  auth(),
  emailAuth,
  uploadMiddleware.array("attachments"),
  sendEmail
);

router.post(
  "/reply/:emailId",
  auth(),
  emailAuth,
  setRefreshedTokenCookie,
  uploadMiddleware.array("attachments"),
  replyToEmail
);

router.delete("/trash/:emailId", auth(), emailAuth, trashEmail);

router.get("/all/search", auth(), emailAuth, searchEmails);

router.patch("/mark-as-read/:emailId", auth(), emailAuth, markEmailAsRead);

router.get("/summarize/:emailId", auth(), emailAuth, summarizeEmail);

router.post("/chat", auth(), emailAuth, chatWithBot);

router.post(
  "/draft",
  auth(),
  emailAuth,
  uploadMiddleware.array("attachments"),
  createDraft
);

export default router;
