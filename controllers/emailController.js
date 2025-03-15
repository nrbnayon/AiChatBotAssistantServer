// controllers/emailController.js
import { createEmailService } from "../services/emailService.js";
import MCPServer from "../services/mcpServer.js";
import { StatusCodes } from "http-status-codes";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

const fetchEmails = async (req, res, next) => {
  try {
    const user = req.user;
    if (user.emailSyncStatus !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Email sync is still pending. Please try again later.",
      });
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const emailsResponse = await mcpServer.callTool(
      "fetch-emails",
      {},
      req.user.id
    );
    res.json({ success: true, emails: emailsResponse[0].artifact?.data });
  } catch (error) {
    next(error);
  }
};

const sendEmail = async (req, res, next) => {
  try {
    const { to, subject, message } = req.body;
    const attachments = req.files || [];
    if (!to || !subject || !message) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Missing required fields");
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const sendResponse = await mcpServer.callTool(
      "send-email",
      { recipient_id: to, subject, message },
      req.user.id
    );
    res.json({ success: true, message: sendResponse[0].text });
  } catch (error) {
    next(error);
  }
};

const readEmail = async (req, res, next) => {
  try {
    const { emailId } = req.params;
    if (!emailId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Email ID is required");
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const emailContent = await mcpServer.callTool(
      "read-email",
      { email_id: emailId },
      req.user.id
    );
    res.json({ success: true, email: emailContent[0].artifact?.data });
  } catch (error) {
    next(error);
  }
};

const replyToEmail = async (req, res, next) => {
  try {
    const { emailId } = req.params;
    const { message } = req.body;
    const attachments = req.files || [];
    if (!emailId || !message) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Email ID and message are required"
      );
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const replyResponse = await mcpServer.callTool(
      "reply-to-email",
      { email_id: emailId, message },
      req.user.id
    );
    res.json({ success: true, message: replyResponse[0].text });
  } catch (error) {
    next(error);
  }
};

const trashEmail = async (req, res, next) => {
  try {
    const { emailId } = req.params;
    if (!emailId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Email ID is required");
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const trashResponse = await mcpServer.callTool(
      "trash-email",
      { email_id: emailId },
      req.user.id
    );
    res.json({ success: true, message: trashResponse[0].text });
  } catch (error) {
    next(error);
  }
};

const searchEmails = async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Search query is required");
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const searchResponse = await mcpServer.callTool(
      "search-emails",
      { query },
      req.user.id
    );
    res.json({ success: true, emails: searchResponse[0].artifact?.data });
  } catch (error) {
    next(error);
  }
};

const markEmailAsRead = async (req, res, next) => {
  try {
    const { emailId } = req.params;
    if (!emailId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Email ID is required");
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const readResponse = await mcpServer.callTool(
      "mark-email-as-read",
      { email_id: emailId },
      req.user.id
    );
    res.json({ success: true, message: readResponse[0].text });
  } catch (error) {
    next(error);
  }
};

const summarizeEmail = async (req, res, next) => {
  try {
    const { emailId } = req.params;
    if (!emailId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Email ID is required");
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const summaryResponse = await mcpServer.callTool(
      "summarize-email",
      { email_id: emailId },
      req.user.id
    );
    res.json({ success: true, summary: summaryResponse[0].text });
  } catch (error) {
    next(error);
  }
};

const chatWithBot = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Message is required");
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);
    const response = await mcpServer.chatWithBot(req, message);
    res.json({ success: true, response });
  } catch (error) {
    next(error);
  }
};

const moveEmailToFolder = async (req, res, next) => {
  try {
    const { emailId, folderName } = req.body;
    if (!emailId || !folderName) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Email ID and folder name are required"
      );
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);

    // Implement folder movement logic based on provider
    let response;
    switch (req.user.authProvider) {
      case "google":
        response = await emailService.gmail.users.messages.modify({
          userId: "me",
          id: emailId,
          requestBody: {
            addLabelIds: [folderName], // Assuming folderName matches Gmail label
            removeLabelIds: ["INBOX"],
          },
        });
        break;
      case "microsoft":
        response = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${emailId}/move`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${req.user.microsoftAccessToken}`,
            },
            body: JSON.stringify({ destinationId: folderName }),
          }
        );
        break;
      case "yahoo":
        // Yahoo uses IMAP, so we need to move the message
        const config = {
          imap: {
            user: req.user.email,
            password: req.user.yahooAccessToken,
            host: "imap.mail.yahoo.com",
            port: 993,
            tls: true,
            authTimeout: 3000,
            tlsOptions: { rejectUnauthorized: false },
          },
        };
        const connection = await imap.connect(config);
        await connection.openBox("INBOX");
        await connection.moveMessage(emailId, folderName);
        await connection.end();
        response = { status: "success" };
        break;
      default:
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Unsupported auth provider"
        );
    }

    if (response.status === "success" || response.ok) {
      res.json({
        success: true,
        message: "Email moved to folder successfully",
      });
    } else {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to move email"
      );
    }
  } catch (error) {
    next(error);
  }
};

const createFolder = async (req, res, next) => {
  try {
    const { folderName } = req.body;
    if (!folderName) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Folder name is required");
    }
    const emailService = await createEmailService(req);
    const mcpServer = new MCPServer(emailService);

    let response;
    switch (req.user.authProvider) {
      case "google":
        response = await emailService.gmail.users.labels.create({
          userId: "me",
          requestBody: {
            name: folderName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          },
        });
        break;
      case "microsoft":
        response = await fetch(
          `https://graph.microsoft.com/v1.0/me/mailFolders`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${req.user.microsoftAccessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ displayName: folderName }),
          }
        );
        break;
      case "yahoo":
        // Yahoo uses IMAP, so we create a mailbox
        const config = {
          imap: {
            user: req.user.email,
            password: req.user.yahooAccessToken,
            host: "imap.mail.yahoo.com",
            port: 993,
            tls: true,
            authTimeout: 3000,
            tlsOptions: { rejectUnauthorized: false },
          },
        };
        const connection = await imap.connect(config);
        await connection.addBox(folderName);
        await connection.end();
        response = { status: "success" };
        break;
      default:
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Unsupported auth provider"
        );
    }

    if (response.status === "success" || response.ok) {
      res.json({ success: true, message: "Folder created successfully" });
    } else {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to create folder"
      );
    }
  } catch (error) {
    next(error);
  }
};

export {
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
};
