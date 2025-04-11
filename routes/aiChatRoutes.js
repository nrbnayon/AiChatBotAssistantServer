// routes/aiChatRoutes.js
import express from "express";
import auth from "../middleware/authMiddleware.js";
import { createEmailService, getEmailService } from "../services/emailService.js";
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

const serviceCreationTracker = new Map();

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
// router.post(
//   "/:chatId",
//   auth(),
//   chatRateLimit(),
//   upload.single("file"),
//   catchAsync(async (req, res) => {
//     const emailService = await getEmailService(req);
//     const mcpServer = new MCPServer(emailService);
//     const { chatId } = req.params;
//     const { message, maxResults, modelId, history: providedHistory } = req.body;
//     const userId = req.user.id;

//     // Validate chat exists and belongs to user
//     const chat = await Chat.findOne({ _id: chatId, userId });
//     if (!chat) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Chat not found" });
//     }

//     if (!message && !req.file) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Message or file is required" });
//     }

//     // Parse history if provided, otherwise use chat history
//     let history = chat.messages.map((msg) => ({
//       role: msg.userRole,
//       content: msg.message,
//     }));

//     if (providedHistory) {
//       try {
//         history =
//           typeof providedHistory === "string"
//             ? JSON.parse(providedHistory)
//             : providedHistory;
//       } catch (error) {
//         console.error("Error parsing history:", error);
//       }
//     }

//     let userMessage = message || "";

//     // Process uploaded file if present
//     if (req.file) {
//       try {
//         const fileText = await extractTextFromFile(
//           req.file.path,
//           req.file.mimetype
//         );
//         userMessage = userMessage
//           ? `Analyze this given file ${userMessage}\n\nContent from file ${req.file.originalname}:\n${fileText}`
//           : `Analyze this file and summarize and provide corrected information'${req.file.originalname}':\n${fileText}`;
//         fs.unlinkSync(req.file.path);
//       } catch (error) {
//         console.error("File processing error:", error);
//         return res.status(400).json({
//           success: false,
//           message: `Error processing uploaded file: ${error.message}`,
//         });
//       }
//     }

//     try {
//       const emails = (await emailService.fetchEmails({ maxResults })).messages;
//       const hour = new Date().getHours();
//       let timeContext =
//         hour >= 5 && hour < 12
//           ? "morning"
//           : hour >= 12 && hour < 18
//           ? "afternoon"
//           : "evening";

//       const inboxStats = await emailService.getInboxStats();
//       const chatResponse = await mcpServer.chatWithBot(
//         req,
//         userMessage,
//         history,
//         {
//           timeContext,
//           emailCount: inboxStats.totalEmails,
//           unreadCount: inboxStats.unreadEmails,
//         },
//         modelId
//       );

//       const user = await User.findById(req.user.id);
//       const newTokenCount =
//         (user.subscription.dailyTokens || 0) + (chatResponse.tokenCount || 0);
//       if (newTokenCount > req.maxTokens) {
//         return res.status(429).json({
//           success: false,
//           message:
//             "Daily token limit reached for your plan. Please try again tomorrow.",
//         });
//       }
//       user.subscription.dailyTokens = newTokenCount;
//       await user.save();

//       // Store messages in the chat
//       chat.messages.push({
//         userRole: "user",
//         message: userMessage,
//         date: new Date(),
//       });
//       chat.messages.push({
//         userRole: "assistant",
//         message: chatResponse.text,
//         date: new Date(),
//         model: chatResponse.modelUsed,
//       });
//       await chat.save();

//       res.json({
//         success: true,
//         message: chatResponse.text,
//         model: chatResponse.modelUsed,
//         fallbackUsed: chatResponse.fallbackUsed,
//         tokenCount: chatResponse.tokenCount || 0,
//         data: chatResponse.artifact?.data || null,
//       });
//     } catch (error) {
//       console.error("Error processing request:", error);
//       res.status(500).json({
//         success: false,
//         message: "I'm having trouble processing your request right now.",
//         error:
//           process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     }
//   })
// );

// Modify your POST "/:chatId" endpoint to include tracking

// 2nd best
// router.post(
//   "/:chatId",
//   auth(),
//   chatRateLimit(),
//   upload.single("file"),
//   catchAsync(async (req, res) => {
//     console.log(
//       `POST /${req.params.chatId} request received for user ${req.user.id}`
//     );

//     const startTime = Date.now();
//     const emailService = await getEmailService(req);
//     const serviceTime = Date.now() - startTime;

//     // Track email service creation/retrieval
//     const trackingId = `${req.user.id}-${Date.now()}`;
//     serviceCreationTracker.set(trackingId, {
//       userId: req.user.id,
//       chatId: req.params.chatId,
//       time: serviceTime,
//       cached: serviceTime < 100, // Rough estimate - cached retrievals should be fast
//     });

//     console.log(
//       `Email service ${
//         serviceCreationTracker.get(trackingId).cached
//           ? "retrieved from cache"
//           : "created"
//       } in ${serviceTime}ms`
//     );

//     // Rest of your code remains the same...
//     const mcpServer = new MCPServer(emailService);
//     const { chatId } = req.params;
//     const { message, maxResults, modelId, history: providedHistory } = req.body;
//     const userId = req.user.id;

//     // Validate chat exists and belongs to user
//     const chat = await Chat.findOne({ _id: chatId, userId });
//     if (!chat) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Chat not found" });
//     }

//     if (!message && !req.file) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Message or file is required" });
//     }

//     // Parse history if provided, otherwise use chat history
//     let history = chat.messages.map((msg) => ({
//       role: msg.userRole,
//       content: msg.message,
//     }));

//     if (providedHistory) {
//       try {
//         history =
//           typeof providedHistory === "string"
//             ? JSON.parse(providedHistory)
//             : providedHistory;
//       } catch (error) {
//         console.error("Error parsing history:", error);
//       }
//     }

//     let userMessage = message || "";

//     // Process uploaded file if present
//     if (req.file) {
//       try {
//         const fileText = await extractTextFromFile(
//           req.file.path,
//           req.file.mimetype
//         );
//         userMessage = userMessage
//           ? `Analyze this given file ${userMessage}\n\nContent from file ${req.file.originalname}:\n${fileText}`
//           : `Analyze this file and summarize and provide corrected information'${req.file.originalname}':\n${fileText}`;
//         fs.unlinkSync(req.file.path);
//       } catch (error) {
//         console.error("File processing error:", error);
//         return res.status(400).json({
//           success: false,
//           message: `Error processing uploaded file: ${error.message}`,
//         });
//       }
//     }

//     try {
//       console.log(`Fetching emails for user ${userId}`);
//       const emails = (await emailService.fetchEmails({ maxResults })).messages;
//       console.log(`Retrieved ${emails.length} emails`);

//       const hour = new Date().getHours();
//       let timeContext =
//         hour >= 5 && hour < 12
//           ? "morning"
//           : hour >= 12 && hour < 18
//           ? "afternoon"
//           : "evening";

//       console.log(`Getting inbox stats for user ${userId}`);
//       const inboxStats = await emailService.getInboxStats();

//       // Testing email analysis caching
//       console.log("Testing email analysis caching...");
//       console.log(
//         "First call to filterImportantEmails (should analyze emails):"
//       );
//       const importantEmails1 = await emailService.filterImportantEmails(
//         emails.slice(0, 10), // Use a subset for testing
//         ["urgent", "important"],
//         "daily"
//       );

//       console.log("Second call with same parameters (should use cache):");
//       const importantEmails2 = await emailService.filterImportantEmails(
//         emails.slice(0, 10),
//         ["urgent", "important"],
//         "daily"
//       );

//       console.log(
//         `Found ${importantEmails1.length} important emails in first call`
//       );
//       console.log(
//         `Found ${importantEmails2.length} important emails in second call`
//       );

//       const chatResponse = await mcpServer.chatWithBot(
//         req,
//         userMessage,
//         history,
//         {
//           timeContext,
//           emailCount: inboxStats.totalEmails,
//           unreadCount: inboxStats.unreadEmails,
//         },
//         modelId
//       );

//       const user = await User.findById(req.user.id);
//       const newTokenCount =
//         (user.subscription.dailyTokens || 0) + (chatResponse.tokenCount || 0);
//       if (newTokenCount > req.maxTokens) {
//         return res.status(429).json({
//           success: false,
//           message:
//             "Daily token limit reached for your plan. Please try again tomorrow.",
//         });
//       }
//       user.subscription.dailyTokens = newTokenCount;
//       await user.save();

//       // Store messages in the chat
//       chat.messages.push({
//         userRole: "user",
//         message: userMessage,
//         date: new Date(),
//       });
//       chat.messages.push({
//         userRole: "assistant",
//         message: chatResponse.text,
//         date: new Date(),
//         model: chatResponse.modelUsed,
//       });
//       await chat.save();

//       // Add service tracking stats to response in dev mode
//       const debugInfo =
//         process.env.NODE_ENV === "development"
//           ? {
//               serviceTracking: Object.fromEntries(serviceCreationTracker),
//               cacheStats: {
//                 emailAnalysisCacheEntries: emailService.analysisCache
//                   ? emailService.analysisCache.cache.size
//                   : "unknown",
//               },
//             }
//           : null;

//       res.json({
//         success: true,
//         message: chatResponse.text,
//         model: chatResponse.modelUsed,
//         fallbackUsed: chatResponse.fallbackUsed,
//         tokenCount: chatResponse.tokenCount || 0,
//         data: chatResponse.artifact?.data || null,
//         debug: debugInfo,
//       });
//     } catch (error) {
//       console.error("Error processing request:", error);
//       res.status(500).json({
//         success: false,
//         message: "I'm having trouble processing your request right now.",
//         error:
//           process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     }
//   })
// );

router.post(
  "/:chatId",
  auth(),
  chatRateLimit(),
  upload.single("file"),
  catchAsync(async (req, res) => {
    console.log(
      `POST /${req.params.chatId} request received for user ${req.user.id}`
    );

    const startTime = Date.now();
    const emailService = await getEmailService(req);
    const serviceTime = Date.now() - startTime;

    // Track email service creation/retrieval
    const trackingId = `${req.user.id}-${Date.now()}`;
    serviceCreationTracker.set(trackingId, {
      userId: req.user.id,
      chatId: req.params.chatId,
      time: serviceTime,
      cached: serviceTime < 100, // Rough estimate - cached retrievals should be fast
    });

    console.log(
      `Email service ${
        serviceCreationTracker.get(trackingId).cached
          ? "retrieved from cache"
          : "created"
      } in ${serviceTime}ms`
    );

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

    // Process uploaded file if present
    if (req.file) {
      try {
        const fileText = await extractTextFromFile(
          req.file.path,
          req.file.mimetype
        );
        userMessage = userMessage
          ? `Analyze this given file ${userMessage}\n\nContent from file ${req.file.originalname}:\n${fileText}`
          : `Analyze this file and summarize and provide corrected information'${req.file.originalname}':\n${fileText}`;
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
      console.log(`Fetching emails for user ${userId}`);
      const emails = (await emailService.fetchEmails({ maxResults })).messages;
      console.log(`Retrieved ${emails.length} emails`);

      const hour = new Date().getHours();
      let timeContext =
        hour >= 5 && hour < 12
          ? "morning"
          : hour >= 12 && hour < 18
          ? "afternoon"
          : "evening";

      console.log(`Getting inbox stats for user ${userId}`);
      const inboxStats = await emailService.getInboxStats();

      // Fetch user for both token counting and keyword customization
      const user = await User.findById(req.user.id);

      // Get user's important keywords (dynamically)
      const userKeywords = user.getAllImportantKeywords();

      // Context-based keywords from user message, if any
      const contextKeywords = extractContextKeywords(userMessage);

      // Combine user's default keywords with contextual ones
      const combinedKeywords = [
        ...new Set([...userKeywords, ...contextKeywords]),
      ];

      // Analysis of emails with proper caching
      // First call will populate the cache, subsequent calls will use it
      console.log("Analyzing important emails with dynamic keywords");
      const importantEmails = await emailService.filterImportantEmails(
        emails.slice(0, 100), // Use a reasonable subset
        combinedKeywords,
        "daily"
      );

      console.log(`Found ${importantEmails} important emails`);

      // Verify cache is working by examining cache size
      const cacheSize = emailService.analysisCache
        ? emailService.analysisCache.cache.size
        : 0;
      console.log(`Analysis cache size: ${cacheSize} entries`);

      const chatResponse = await mcpServer.chatWithBot(
        req,
        userMessage,
        history,
        {
          timeContext,
          emailCount: inboxStats.totalEmails,
          unreadCount: inboxStats.unreadEmails,
          importantCount: importantEmails.length,
          // Include top important emails if relevant
          topImportantEmails: importantEmails.slice(0, 100).map((email) => ({
            from: email.from,
            subject: email.subject,
            score: email.importanceScore,
          })),
        },
        modelId
      );

      const newTokenCount =
        (user.subscription.dailyTokens || 0) + (chatResponse.tokenCount || 0);
      if (newTokenCount > req.maxTokens) {
        return res.status(429).json({
          success: false,
          message:
            "Daily token limit reached for your plan. Please try again tomorrow.",
        });
      }
      user.subscription.dailyTokens = newTokenCount;
      await user.save();

      // Store messages in the chat
      chat.messages.push({
        userRole: "user",
        message: userMessage,
        date: new Date(),
      });
      chat.messages.push({
        userRole: "assistant",
        message: chatResponse.text,
        date: new Date(),
        model: chatResponse.modelUsed,
      });
      await chat.save();

      // Add service tracking stats to response in dev mode
      const debugInfo =
        process.env.NODE_ENV === "development"
          ? {
              serviceTracking: Object.fromEntries(serviceCreationTracker),
              cacheStats: {
                emailAnalysisCacheEntries: emailService.analysisCache
                  ? emailService.analysisCache.cache.size
                  : "unknown",
                keywordsUsed: combinedKeywords,
                importantEmailsFound: importantEmails.length,
              },
            }
          : null;

      res.json({
        success: true,
        message: chatResponse.text,
        model: chatResponse.modelUsed,
        fallbackUsed: chatResponse.fallbackUsed,
        tokenCount: chatResponse.tokenCount || 0,
        data: chatResponse.artifact?.data || null,
        debug: debugInfo,
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

// Helper function to extract potential keywords from user message
function extractContextKeywords(message) {
  // Simple keyword extraction - could be enhanced with NLP
  const keywords = [];

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
        // Only add meaningful words
        keywords.push(match[1].toLowerCase());
      }
    }
  }

  // Extract potential topic keywords
  const words = message.toLowerCase().split(/\s+/);
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
      ].includes(word)
  );

  // Add top 3 potential topic keywords
  keywords.push(...potentialKeywords.slice(0, 3));

  return [...new Set(keywords)]; // Remove duplicates
}

// Legacy endpoint (without chat ID, creates a new chat)
router.post(
  "/",
  auth(),
  chatRateLimit(),
  upload.single("file"),
  catchAsync(async (req, res) => {
    const emailService = await getEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const { message, maxResults, modelId, history: providedHistory } = req.body;
    const userId = req.user.id;

    if (!message && !req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Message or file is required" });
    }

    // Build the full user message
    let userMessage = message || "";
    if (req.file) {
      try {
        const fileText = await extractTextFromFile(
          req.file.path,
          req.file.mimetype
        );
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
      const emails = (await emailService.fetchEmails({ maxResults })).messages;

      console.log("Get emails:::", emails.length);

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
        modelId
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
