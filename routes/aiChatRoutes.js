// routes\aiChatRoutes.js
import express from "express";
import auth from "../middleware/authMiddleware.js";
import { getEmailService } from "../services/emailService.js";
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
import Chat from "../models/Chat.js";

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

// Set the path to CMAP files for PDF.js
const cMapUrl =
  path.join(__dirname, "..", "node_modules", "pdfjs-dist", "cmaps") + "/";

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

// Legacy endpoint (without chat ID, creates a new chat)
router.post(
  "/",
  auth(),
  chatRateLimit(),
  upload.single("file"),
  catchAsync(async (req, res) => {
    const emailService = await getEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const {
      message,
      maxResults = 1000,
      modelId,
      history: providedHistory,
    } = req.body;
    const userId = req.user.id;

    if (!modelId) {
      return res.status(400).json({ error: "modelId is required" });
    }

    if (!message && !req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Message or file is required" });
    }

    // Build the full user message
    let userMessage = message || "";
    if (req.file) {
      try {
        let fileText = await extractTextFromFile(
          req.file.path,
          req.file.mimetype
        );
        fileText = fileText.replace(/\s+/g, " ").trim();
        userMessage = userMessage
          ? `Analyze this given file ${userMessage}\n\nContent from file ${req.file.originalname}:\n${fileText}`
          : `Analyze this file and summarize and provide corrected information'${req.file.originalname}':\n${fileText}`;
        await fs.promises.unlink(req.file.path);
      } catch (error) {
        console.error("File processing error:", error);
        return res.status(400).json({
          success: false,
          message: `Error processing uploaded file: ${error.message}`,
        });
      }
    }

    const chatName = message ? `${message}` : "Untitled Chat";

    const newChat = new Chat({ userId, name: chatName });

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

    try {
      const hour = new Date().getHours();
      const timeContext =
        hour >= 5 && hour < 12
          ? "morning"
          : hour >= 12 && hour < 18
          ? "afternoon"
          : "evening";

      const inboxStats = await emailService.getInboxStats();
      const chatResponse = await mcpServer.chatWithBot(
        req,
        userMessage,
        history,
        {
          timeContext,
          emailCount: inboxStats.totalEmails,
          unreadCount: inboxStats.unreadEmails,
        },
        modelId,
        maxResults
      );

      const user = await User.findById(userId);
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

      newChat.messages.push(
        {
          userRole: "user",
          message: userMessage,
          date: new Date(),
        },
        {
          userRole: "assistant",
          message: chatResponse.text,
          date: new Date(),
          model: chatResponse.modelUsed,
        }
      );

      await newChat.save();

      res.json({
        success: true,
        chatId: newChat._id,
        message: chatResponse.text,
        model: chatResponse.modelUsed,
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

router.post(
  "/:chatId",
  auth(),
  chatRateLimit(),
  upload.single("file"),
  catchAsync(async (req, res) => {
    const startTime = Date.now();
    const emailService = await getEmailService(req);
    console.log(`Email service initialized in ${Date.now() - startTime}ms`);

    const mcpServer = new MCPServer(emailService);
    const { chatId } = req.params;
    const userId = req.user.id;
    const {
      message,
      maxResults = 1000,
      modelId,
      history: providedHistory,
    } = req.body;

    if (!modelId) {
      return res.status(400).json({ error: "modelId is required" });
    }

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

    let history = chat.messages.map((msg) => ({
      role: msg.userRole,
      content: msg.message,
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
    if (req.file) {
      try {
        let fileText = await extractTextFromFile(
          req.file.path,
          req.file.mimetype
        );
        userMessage = userMessage
          ? `${userMessage}\n\nFile content: ${fileText}`
          : fileText;
        fs.unlinkSync(req.file.path);
      } catch (error) {
        console.error("File processing error:", error);
        return res.status(400).json({
          success: false,
          message: `Error processing file: ${error.message}`,
        });
      }
    }

    try {
      console.log("Starting chat processing for user:", userId);
      const inboxStats = await emailService.getInboxStats();
      console.log("Inbox stats fetched:", inboxStats);

      const user = await User.findById(userId);
      const combinedKeywords = [
        ...new Set([
          ...(user.getAllImportantKeywords() || []),
          ...extractContextKeywords(userMessage),
        ]),
      ];

      const importantTriggers = ["important", "priority", "urgent"];
      const isImportantQuery = importantTriggers.some((trigger) =>
        userMessage.toLowerCase().includes(trigger)
      );
      console.log("Is important query:", isImportantQuery);

      let importantEmails = [];
     if (isImportantQuery) {
       try {
         console.log("Fetching and filtering important emails...");
         const fetchStart = Date.now();
         // Change maxResults from 1000 to 100
         const emails = (await emailService.fetchEmails({ maxResults: 100 }))
           .messages;
         const fetchTime = Date.now() - fetchStart;
         console.log(`Fetched ${emails.length} emails in ${fetchTime}ms`);

         const analysisStart = Date.now();
         importantEmails = await emailService.filterImportantEmails(
           emails,
           combinedKeywords,
           "daily", // Already set to "daily", ensuring today’s emails
           modelId
         );
         console.log(
           `Analyzed important emails in ${
             Date.now() - analysisStart
           }ms. Found ${importantEmails.length} important emails`
         );
       } catch (error) {
         console.error("Error filtering important emails:", error);
         importantEmails = [];
       }
     }

      console.log("Calling chatWithBot with context...");
      const chatResponse = await mcpServer.chatWithBot(
        req,
        userMessage,
        history,
        {
          timeContext: ["morning", "afternoon", "evening"][
            Math.floor(new Date().getHours() / 6)
          ],
          emailCount: inboxStats.totalEmails,
          unreadCount: inboxStats.unreadEmails,
          importantCount: importantEmails.length,
          topImportantEmails: importantEmails.slice(0, 10).map((email) => ({
            from: email.from,
            subject: email.subject,
            score: email.importanceScore,
            snippet: email.snippet,
            body: email.body,
          })),
        },
        modelId
      );
      console.log("chatWithBot response received");

      const newTokenCount =
        (user.subscription.dailyTokens || 0) + (chatResponse.tokenCount || 0);
      if (newTokenCount > req.maxTokens) {
        return res
          .status(429)
          .json({ success: false, message: "Daily token limit reached." });
      }
      user.subscription.dailyTokens = newTokenCount;
      await user.save();

      chat.messages.push(
        { userRole: "user", message: userMessage, date: new Date() },
        {
          userRole: "assistant",
          message: chatResponse.text,
          date: new Date(),
          model: chatResponse.modelUsed,
        }
      );
      console.log("Saving chat messages...");
      await chat.save();
      console.log("Chat messages saved");

      res.json({
        success: true,
        message: chatResponse.text,
        model: chatResponse.modelUsed,
        fallbackUsed: chatResponse.fallbackUsed,
        tokenCount: chatResponse.tokenCount || 0,
        data: chatResponse.artifact?.data || null,
      });
    } catch (error) {
      console.error("Error processing chat request:", error);
      res.status(500).json({
        success: false,
        message: "Trouble processing your request. Try again?",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  })
);

// Helper function to extract potential keywords from user message
function extractContextKeywords(message) {
  // Simple keyword extraction with better patterns
  const keywords = [];
  const lowerCaseMessage = message.toLowerCase();

  // Add direct check for important-related words
  if (/\b(important|urgent|priority)\b/i.test(lowerCaseMessage)) {
    keywords.push("important");
  }

  // Look for potential important terms in the message
  const importantPatterns = [
    /\bimportant\s+(\w+)\b/gi,
    /\bcheck\s+for\s+(\w+)\b/gi,
    /\bfind\s+(\w+)\b/gi,
    /\bpriority\s+(\w+)\b/gi,
    /\burgent\s+(\w+)\b/gi,
    /\bcritical\s+(\w+)\b/gi,
  ];

  for (const pattern of importantPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      if (match[1] && match[1].length > 3) {
        keywords.push(match[1].toLowerCase());
      }
    }
  }

  // Add more general keywords for common important topics
  if (lowerCaseMessage.includes("email")) keywords.push("email");

  // Extract potential topic keywords
  const words = lowerCaseMessage.split(/\s+/);
  const potentialKeywords = words.filter(
    (word) =>
      word.length > 4 &&
      ![
        "about",
        "these",
        "those",
        "their",
        "there",
        "where",
        "which",
        "would",
        "could",
        "should",
        "anything",
        "email",
      ].includes(word)
  );

  // Add top 3 potential topic keywords
  keywords.push(...potentialKeywords.slice(0, 3));

  return [...new Set(keywords)];
}

// Extract Text from Uploaded File
async function extractTextFromFile(filePath, mimeType) {
  try {
    let fileText = ""; // Use let instead of const to allow reassignment

    if (mimeType === "text/plain") {
      fileText = fs.readFileSync(filePath, "utf-8");
    } else if (mimeType === "application/pdf") {
      const data = new Uint8Array(fs.readFileSync(filePath));
      const loadingTask = pdfjsLib.getDocument({
        data,
        cMapUrl, // Provide CMAP URL for text extraction
        cMapPacked: true,
        standardFontDataUrl:
          path.join(
            __dirname,
            "..",
            "node_modules",
            "pdfjs-dist",
            "standard_fonts"
          ) + "/",
      });

      const pdf = await loadingTask.promise;
      const textParts = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        textParts.push(content.items.map((item) => item.str).join(" "));
      }

      fileText = textParts.join("\n");
    } else if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ path: filePath });
      fileText = result.value;
    } else {
      throw new Error(
        "Unsupported file type. Only TXT, PDF, and DOCX files are supported."
      );
    }

    // Clean up the text (now using let, so reassignment is fine)
    fileText = fileText.replace(/\s+/g, " ").trim();

    const MAX_FILE_CHARS = 4000;
    if (fileText.length > MAX_FILE_CHARS) {
      fileText =
        fileText.substring(0, MAX_FILE_CHARS) + "\n\n[File content truncated]";
    }

    return fileText;
  } catch (error) {
    console.error("File extraction error:", error);
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}

export default router;
