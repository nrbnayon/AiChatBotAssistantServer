import { createEmailService } from "../services/emailService.js";
import MCPServer from "../services/mcpServer.js";
import { StatusCodes } from "http-status-codes";
import multer from "multer";
import { ApiError, catchAsync } from "../utils/errorHandler.js";

const upload = multer({ storage: multer.memoryStorage() });

const fetchEmails = catchAsync(async (req, res) => {
  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const emailsResponse = await mcpServer.callTool(
    "fetch-emails",
    {},
    req.user.id
  );
  res.json({ success: true, emails: emailsResponse[0].artifact?.data });
});

const sendEmail = catchAsync(async (req, res) => {
  const { to, subject, message } = req.body;
  const attachments = req.files || [];
  if (!to || !subject || !message) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Missing required fields");
  }
  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const sendResponse = await mcpServer.callTool(
    "send-email",
    {
      recipient_id: to,
      subject,
      message,
      attachments: attachments.map((file) => ({
        originalname: file.originalname,
        mimetype: file.mimetype,
        content: file.buffer,
      })),
    },
    req.user.id
  );
  res.json({ success: true, message: sendResponse[0].text });
});

const readEmail = catchAsync(async (req, res) => {
  const { emailId } = req.params;
  if (!emailId)
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email ID is required");
  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const emailContent = await mcpServer.callTool(
    "read-email",
    { email_id: emailId },
    req.user.id
  );
  res.json({ success: true, email: emailContent[0].artifact?.data });
});

const replyToEmail = catchAsync(async (req, res) => {
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
    {
      email_id: emailId,
      message,
      attachments: attachments.map((file) => ({
        originalname: file.originalname,
        mimetype: file.mimetype,
        content: file.buffer,
      })),
    },
    req.user.id
  );
  res.json({ success: true, message: replyResponse[0].text });
});

const trashEmail = catchAsync(async (req, res) => {
  const { emailId } = req.params;
  if (!emailId)
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email ID is required");
  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const trashResponse = await mcpServer.callTool(
    "trash-email",
    { email_id: emailId },
    req.user.id
  );
  res.json({ success: true, message: trashResponse[0].text });
});

const searchEmails = catchAsync(async (req, res) => {
  const { query } = req.query;
  if (!query)
    throw new ApiError(StatusCodes.BAD_REQUEST, "Search query is required");
  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const searchResponse = await mcpServer.callTool(
    "search-emails",
    { query },
    req.user.id
  );
  res.json({ success: true, emails: searchResponse[0].artifact?.data });
});

const markEmailAsRead = catchAsync(async (req, res) => {
  const { emailId } = req.params;
  if (!emailId)
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email ID is required");
  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const readResponse = await mcpServer.callTool(
    "mark-email-as-read",
    { email_id: emailId },
    req.user.id
  );
  res.json({ success: true, message: readResponse[0].text });
});

const summarizeEmail = catchAsync(async (req, res) => {
  const { emailId } = req.params;
  if (!emailId)
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email ID is required");
  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const summaryResponse = await mcpServer.callTool(
    "summarize-email",
    { email_id: emailId },
    req.user.id
  );
  res.json({ success: true, summary: summaryResponse[0].text });
});

const chatWithBot = catchAsync(async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message)
    throw new ApiError(StatusCodes.BAD_REQUEST, "Message is required");
  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const response = await mcpServer.chatWithBot(req, message, history);
  res.json({ success: true, response });
});

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
  upload,
};
