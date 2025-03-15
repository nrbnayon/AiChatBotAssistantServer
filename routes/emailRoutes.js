// routes/emailRoutes.js
import express from "express";
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
  moveEmailToFolder,
  createFolder,
  upload,
} from "../controllers/emailController.js";
import auth from "../middleware/authMiddleware.js";
import emailAuth from "../middleware/emailMiddleware.js";
import { authRateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

router.get("/", auth(), emailAuth, authRateLimit(), fetchEmails);
router.post(
  "/send",
  auth(),
  emailAuth,
  authRateLimit(),
  upload.array("attachments"),
  sendEmail
);
router.get("/:emailId", auth(), emailAuth, authRateLimit(), readEmail);
router.post(
  "/:emailId/reply",
  auth(),
  emailAuth,
  authRateLimit(),
  upload.array("attachments"),
  replyToEmail
);
router.post("/:emailId/trash", auth(), emailAuth, authRateLimit(), trashEmail);
router.get("/search", auth(), emailAuth, authRateLimit(), searchEmails);
router.post(
  "/:emailId/mark-read",
  auth(),
  emailAuth,
  authRateLimit(),
  markEmailAsRead
);
router.get(
  "/:emailId/summarize",
  auth(),
  emailAuth,
  authRateLimit(),
  summarizeEmail
);
router.post("/chat", auth(), emailAuth, authRateLimit(), chatWithBot);
router.post("/move", auth(), emailAuth, authRateLimit(), moveEmailToFolder);
router.post("/create-folder", auth(), emailAuth, authRateLimit(), createFolder);

export default router;
