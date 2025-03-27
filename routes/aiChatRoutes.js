// routes\aiChatRoutes.js
import express from "express";
import auth from "../middleware/authMiddleware.js";
import { createEmailService } from "../services/emailService.js";
import { catchAsync } from "../utils/errorHandler.js";
import MCPServer from "../services/mcpServer.js";

const router = express.Router();

// Store conversation history
const userConversations = new Map();

// Function to get or create conversation history
function getConversationHistory(userId) {
  if (!userConversations.has(userId)) {
    userConversations.set(userId, []);
  }
  return userConversations.get(userId);
}

// Function to update conversation history
function updateConversationHistory(userId, message, response) {
  const history = getConversationHistory(userId);
  history.push({ role: "user", content: message });
  history.push({ role: "assistant", content: response });

  // Keep history at a reasonable size
  if (history.length > 20) {
    history.splice(0, 2);
  }
}

router.post(
  "/",
  auth(),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const { prompt, maxResults = 50 } = req.body;
    const userId = req.user.id;

    if (!prompt) {
      return res
        .status(400)
        .json({ success: false, message: "Prompt is required" });
    }

    // Get conversation history
    const history = getConversationHistory(userId);

    // Process the request
    try {
      const emails = (await emailService.fetchEmails({ maxResults })).messages;

      // Get time of day for more natural responses
      const hour = new Date().getHours();
      let timeContext = "";
      if (hour >= 5 && hour < 12) {
        timeContext = "morning";
      } else if (hour >= 12 && hour < 18) {
        timeContext = "afternoon";
      } else {
        timeContext = "evening";
      }

      // Process the prompt considering context and history
      const response = await mcpServer.chatWithBot(req, prompt, history, {
        timeContext,
        emailCount: emails.length,
        unreadCount: emails.filter((e) => e.unread).length,
      });

      // Update conversation history
      updateConversationHistory(userId, prompt, response[0].text);

      // Return the response
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

// Add an endpoint for conversation context
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

// Add an endpoint to clear conversation history
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
