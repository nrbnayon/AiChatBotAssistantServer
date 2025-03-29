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
    const { message, maxResults = 500 } = req.body; 
    const userId = req.user.id;

    // **Validate Message**
    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Message is required" });
    }

    // **Handle File Upload**
    let fileContent = "";
    const supportedTypes = [
      "text/plain",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (req.file) {
      // **Check File Size (Limit to 5MB)**
      if (req.file.size > 5 * 1024 * 1024) {
        fs.unlink(req.file.path, () => {}); 
        return res.status(400).json({
          success: false,
          message: "File is too large. Please upload a file smaller than 5MB.",
        });
      }

      // **Check File Type**
      if (!supportedTypes.includes(req.file.mimetype)) {
        fs.unlink(req.file.path, () => {}); 
        return res.status(400).json({
          success: false,
          message:
            "Unsupported file type. Please upload a TXT, PDF, or DOCX file.",
        });
      }

      try {
        fileContent = await extractTextFromFile(
          req.file.path,
          req.file.mimetype
        );
        fileContent = fileContent.substring(0, 2000); 
      } catch (error) {
        console.error("Error extracting file content:", error);
        fs.unlink(req.file.path, () => {}); 
        return res.status(400).json({
          success: false,
          message: "Failed to extract content from the uploaded file.",
        });
      } finally {
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting uploaded file:", err);
        });
      }
    }

    const history = getConversationHistory(userId);

    const userMessage = fileContent
      ? `The user has uploaded a file. Here is the content (truncated to 2000 characters):\n${fileContent}\n\nUser's request: ${message}`
      : message;

    // **Process the Request**
    try {
      const emails = (await emailService.fetchEmails({ maxResults })).messages;

      const hour = new Date().getHours();
      let timeContext = "";
      if (hour >= 5 && hour < 12) timeContext = "morning";
      else if (hour >= 12 && hour < 18) timeContext = "afternoon";
      else timeContext = "evening";

      // **Generate AI Response**
      const response = await mcpServer.chatWithBot(req, userMessage, history, {
        timeContext,
        emailCount: emails.length,
        unreadCount: emails.filter((e) => e.unread).length,
      });

      updateConversationHistory(userId, userMessage, response[0].text);

      // **Send Response**
      res.json({
        success: true,
        message: response[0].text,
        data: response[0].artifact?.data || null,
      });
    } catch (error) {
      console.error("Error processing request:", error);
      res.status(500).json({
        success: false,
        message:
          "I'm having trouble processing your request right now. Could you try again in a moment?",
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