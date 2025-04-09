// routes/aiChatRoutes.js
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
import { fileURLToPath } from "url";
import { dirname } from "path";
import { chatRateLimit } from "../middleware/rateLimit.js";
import User from "../models/User.js";
import Chat from "../models/Chat.js"; // New import

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Polyfill for Promise.withResolvers
if (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const router = express.Router();

// File Upload Configuration
const isLambda = !!process.env.LAMBDA_TASK_ROOT;
const baseUploadDir = isLambda ? "/tmp" : __dirname;
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(baseUploadDir, "../uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Chat-specific POST endpoint
router.post(
  "/:chatId",
  auth(),
  chatRateLimit(),
  upload.single("file"),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const { chatId } = req.params;
    const { message, maxResults, modelId, history: providedHistory } = req.body;
    const userId = req.user.id;

    // Validate chat exists and belongs to user
    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) {
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }

    if (!message && !req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Message or file is required" });
    }

    // Parse history if provided, otherwise use chat history
    let history = chat.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    if (providedHistory) {
      try {
        history =
          typeof providedHistory === "string"
            ? JSON.parse(providedHistory)
            : providedHistory;
      } catch (error) {
        console.error("Error parsing history:", error);
      }
    }

    let userMessage = message || "";

    // Process uploaded file if present
    if (req.file) {
      try {
        const fileText = await extractTextFromFile(
          req.file.path,
          req.file.mimetype
        );
        userMessage = userMessage
          ? `${userMessage}\n\nContent from file ${req.file.originalname}:\n${fileText}`
          : `Analyze this file '${req.file.originalname}':\n${fileText}`;
        fs.unlinkSync(req.file.path);
      } catch (error) {
        console.error("File processing error:", error);
        return res.status(400).json({
          success: false,
          message: `Error processing uploaded file: ${error.message}`,
        });
      }
    }

    try {
      const emails = (await emailService.fetchEmails({ maxResults })).messages;
      const hour = new Date().getHours();
      let timeContext =
        hour >= 5 && hour < 12
          ? "morning"
          : hour >= 12 && hour < 18
          ? "afternoon"
          : "evening";

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

      const user = await User.findById(req.user.id);
      const newTokenCount =
        (user.subscription.dailyTokens || 0) + (chatResponse.tokenCount || 0);
      if (newTokenCount > req.maxTokens) {
        return res.status(429).json({
          success: false,
          message: "Daily token limit exceeded for your plan",
        });
      }
      user.subscription.dailyTokens = newTokenCount;
      await user.save();

      // Store messages in the chat
      chat.messages.push({
        role: "user",
        content: userMessage,
        timestamp: new Date(),
      });
      chat.messages.push({
        role: "assistant",
        content: chatResponse.text,
        timestamp: new Date(),
        model: chatResponse.modelUsed,
      });
      await chat.save();

      res.json({
        success: true,
        message: chatResponse.text,
        modelUsed: chatResponse.modelUsed,
        fallbackUsed: chatResponse.fallbackUsed,
        tokenCount: chatResponse.tokenCount || 0,
        data: chatResponse.artifact?.data || null,
      });
    } catch (error) {
      console.error("Error processing request:", error);
      res.status(500).json({
        success: false,
        message: "I'm having trouble processing your request right now.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  })
);

// Legacy endpoint (without chat ID, creates a new chat)
router.post(
  "/",
  auth(),
  chatRateLimit(),
  upload.single("file"),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const { message, maxResults, modelId, history: providedHistory } = req.body;
    const userId = req.user.id;

    if (!message && !req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Message or file is required" });
    }

    const chatName = message
      ? `Chat with - ${message.substring(0, 20)}`
      : "Chat with AI";
    const newChat = new Chat({ userId, name: chatName });
    await newChat.save();

    // Add your message to the chat
    newChat.messages.push({
      role: "user",
      content: message,
      timestamp: new Date(),
    });
    await newChat.save();

    let history = [];
    if (providedHistory) {
      try {
        history =
          typeof providedHistory === "string"
            ? JSON.parse(providedHistory)
            : providedHistory;
      } catch (error) {
        console.error("Error parsing history:", error);
      }
    }

    let userMessage = message || "";

    if (req.file) {
      try {
        const fileText = await extractTextFromFile(
          req.file.path,
          req.file.mimetype
        );
        userMessage = userMessage
          ? `${userMessage}\n\nContent from file ${req.file.originalname}:\n${fileText}`
          : `Analyze this file '${req.file.originalname}':\n${fileText}`;
        fs.unlinkSync(req.file.path);
      } catch (error) {
        console.error("File processing error:", error);
        return res.status(400).json({
          success: false,
          message: `Error processing uploaded file: ${error.message}`,
        });
      }
    }

    try {
      const emails = (await emailService.fetchEmails({ maxResults })).messages;
      const hour = new Date().getHours();
      let timeContext =
        hour >= 5 && hour < 12
          ? "morning"
          : hour >= 12 && hour < 18
          ? "afternoon"
          : "evening";

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

      const user = await User.findById(req.user.id);
      const newTokenCount =
        (user.subscription.dailyTokens || 0) + (chatResponse.tokenCount || 0);
      if (newTokenCount > req.maxTokens) {
        return res.status(429).json({
          success: false,
          message: "Daily token limit exceeded for your plan",
        });
      }
      user.subscription.dailyTokens = newTokenCount;
      await user.save();

      // Store messages in the new chat
      newChat.messages.push({
        role: "user",
        content: userMessage,
        timestamp: new Date(),
      });
      newChat.messages.push({
        role: "assistant",
        content: chatResponse.text,
        timestamp: new Date(),
        model: chatResponse.modelUsed,
      });
      await newChat.save();

      res.json({
        success: true,
        chatId: newChat._id,
        message: chatResponse.text,
        modelUsed: chatResponse.modelUsed,
        fallbackUsed: chatResponse.fallbackUsed,
        tokenCount: chatResponse.tokenCount || 0,
        data: chatResponse.artifact?.data || null,
      });
    } catch (error) {
      console.error("Error processing request:", error);
      res.status(500).json({
        success: false,
        message: "I'm having trouble processing your request right now.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  })
);

// Extract Text from Uploaded File
async function extractTextFromFile(filePath, mimeType) {
  try {
    if (mimeType === "text/plain") {
      return fs.readFileSync(filePath, "utf-8");
    } else if (mimeType === "application/pdf") {
      const data = new Uint8Array(fs.readFileSync(filePath));
      const loadingTask = pdfjsLib.getDocument({ data });
      const pdf = await loadingTask.promise;
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
    console.error("File extraction error:", error);
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}

export default router;
