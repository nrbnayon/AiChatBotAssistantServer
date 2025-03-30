// routes\aiChatRoutes.js
import express from "express";
import auth from "../middleware/authMiddleware.js";
import { createEmailService } from "../services/emailService.js";
import { catchAsync } from "../utils/errorHandler.js";
import MCPServer from "../services/mcpServer.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";

const router = express.Router();

// **File Upload Configuration**
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

const upload = multer({ storage });

const userConversations = new Map();

// **Get or Create Conversation History**
function getConversationHistory(userId) {
  if (!userConversations.has(userId)) {
    userConversations.set(userId, []);
  }
  return userConversations.get(userId);
}

// **Update Conversation History**
function updateConversationHistory(userId, message, response) {
  const history = getConversationHistory(userId);
  history.push({ role: "user", content: message });
  history.push({ role: "assistant", content: response });

  if (history.length > 20) {
    history.splice(0, 2);
  }
}

// **Extract Text from Uploaded File**
async function extractTextFromFile(filePath, mimeType) {
  try {
    if (mimeType === "text/plain") {
      return fs.readFileSync(filePath, "utf-8");
    } else if (mimeType === "application/pdf") {
      const data = new Uint8Array(fs.readFileSync(filePath));
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => item.str).join(" ") + "\n";
      }
      return text;
    } else if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } else {
      throw new Error("Unsupported file type");
    }
  } catch (error) {
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}

// **Main Chat Route with File Analysis**
router.post(
  "/",
  auth(),
  upload.single("file"),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const {
      message,
      maxResults = 5000,
      modelId,
      history: providedHistory,
    } = req.body;
    const userId = req.user.id;

    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Message is required" });
    }

    const history = providedHistory || getConversationHistory(userId);

    const userMessage = message; 

    try {
      const emails = (await emailService.fetchEmails({ maxResults })).messages;
      const hour = new Date().getHours();
      let timeContext = "";
      if (hour >= 5 && hour < 12) timeContext = "morning";
      else if (hour >= 12 && hour < 18) timeContext = "afternoon";
      else timeContext = "evening";

      const chatResponse = await mcpServer.chatWithBot(
        req,
        userMessage,
        history,
        {
          timeContext,
          emailCount: emails.length,
          unreadCount: emails.filter((e) => e.unread).length,
        },
        modelId
      );

      updateConversationHistory(userId, userMessage, chatResponse.text);

      res.json({
        success: true,
        message: chatResponse.text,
        modelUsed: chatResponse.modelUsed,
        fallbackUsed: chatResponse.fallbackUsed,
        data: chatResponse.artifact?.data || null,
      });
    } catch (error) {
      console.error("Error processing request:", error);
      res.status(500).json({
        success: false,
        message: "I'm having trouble processing your request right now.",
      });
    }
  })
);

router.get(
  "/context",
  auth(),
  catchAsync(async (req, res) => {
    const userId = req.user.id;
    const history = getConversationHistory(userId);

    res.json({
      success: true,
      conversationLength: history.length / 2,
      lastInteraction: history.length > 0 ? new Date().toISOString() : null,
    });
  })
);

// **Clear Conversation History**
router.delete(
  "/context",
  auth(),
  catchAsync(async (req, res) => {
    const userId = req.user.id;
    userConversations.set(userId, []);

    res.json({
      success: true,
      message: "Conversation history cleared successfully.",
    });
  })
);

export default router;