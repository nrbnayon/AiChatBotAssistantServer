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
// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Polyfill for Promise.withResolvers to support older Node.js versions
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
// **File Upload Configuration**
const isLambda = !!process.env.LAMBDA_TASK_ROOT; // Detect if running in AWS Lambda
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

// const upload = multer({ storage });
const upload = multer({ dest: "/tmp" });
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
      // Fixed PDF processing code that doesn't use Promise.withResolvers
      const data = new Uint8Array(fs.readFileSync(filePath));
      const loadingTask = pdfjsLib.getDocument({ data });

      // Use standard Promise approach
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

// **Main Chat Route with File Analysis**
router.post(
  "/",
  auth(),
  // chatRateLimit(),
  // upload.single("file"), // vercel upload issue
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const {
      message,
      maxResults,
      modelId,
      history: providedHistory,
    } = req.body;

    console.log("Get body data::", {
      message,
      maxResults,
      modelId,
      providedHistory,
    });
    const userId = req.user.id;

    if (!message && !req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Message or file is required" });
    }

    // Parse history if it's provided as a string
    let history;
    if (providedHistory) {
      try {
        history =
          typeof providedHistory === "string"
            ? JSON.parse(providedHistory)
            : providedHistory;
      } catch (error) {
        console.error("Error parsing history:", error);
        history = getConversationHistory(userId);
      }
    } else {
      history = getConversationHistory(userId);
    }

    let userMessage = message || "";

    // Process uploaded file if present
    // if (req.file) {
    //   try {
    //     const fileText = await extractTextFromFile(
    //       req.file.path,
    //       req.file.mimetype
    //     );
    //     userMessage = userMessage
    //       ? `${userMessage}\n\nContent from file ${req.file.originalname}:\n${fileText}`
    //       : `I have uploaded a file named '${req.file.originalname}'. Please analyze its content and provide a summary or key points based on the text extracted from it:\n${fileText}`;

    //     // Clean up file after processing
    //     try {
    //       fs.unlinkSync(req.file.path);
    //     } catch (err) {
    //       console.error(`Error deleting file: ${err}`);
    //     }
    //   } catch (error) {
    //     console.error("File processing error:", error);
    //     return res.status(400).json({
    //       success: false,
    //       message: `Error processing uploaded file: ${error.message}`,
    //     });
    //   }
    // }

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


      updateConversationHistory(userId, userMessage, chatResponse.text);
      console.log(
        chatResponse.text,
      );
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
