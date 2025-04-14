// controllers\emailController.js
import { createEmailService } from "../services/emailService.js";
import MCPServer from "../services/mcpServer.js";
import { StatusCodes } from "http-status-codes";
import { ApiError, catchAsync } from "../utils/errorHandler.js";
import NodeCache from "node-cache";
const emailListCache = new NodeCache({ stdTTL: 300 });

const fetchEmails = catchAsync(async (req, res, filter = "all") => {
  const { query, maxResults = 1000, pageToken } = req.query;

  const cacheKey = `${req.user.id}-${filter}-${query || ""}-${pageToken || ""}`;
  const cachedEmails = emailListCache.get(cacheKey);
  if (cachedEmails) {
    console.log(`Cache hit for ${cacheKey}`);
    return res.json(cachedEmails);
  }

  if (pageToken && typeof pageToken !== "string") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid pageToken");
  }

  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);

  // Estimate total emails for pagination
  const inboxStats = await emailService.getInboxStats();
  const totalEmailsEstimate = inboxStats.totalEmails || 0;

  const emailsResponse = await mcpServer.callTool(
    "fetch-emails",
    {
      filter,
      query: query?.toString(),
      maxResults: parseInt(maxResults?.toString() || "1000"),
      pageToken: pageToken?.toString(),
    },
    req.user.id
  );

  const emailsData = emailsResponse[0].artifact?.data;
  if (!emailsData) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to fetch emails"
    );
  }

  const messages = emailsData.messages || [];
  res.json({
    success: true,
    totalEmails: messages.length,
    totalEmailsEstimate,
    emails: messages,
    nextPageToken: emailsData.nextPageToken,
    prevPageToken: emailsData.prevPageToken,
    maxResults: parseInt(maxResults || "1000"),
  });

  emailListCache.set(cacheKey, responseData);
  console.log(`Cache set for ${cacheKey}`);

  res.json(responseData);
});

const fetchImportantEmails = catchAsync(async (req, res) => {
  const emailService = await createEmailService(req);
  const {
    query,
    maxResults = 1000,
    pageToken,
    keywords,
    timeRange = "weekly",
  } = req.query;
  const result = await emailService.fetchEmails({
    query: query?.toString(),
    maxResults: parseInt(maxResults?.toString() || "1000"),
    pageToken: pageToken?.toString(),
  });
  const customKeywords = keywords ? keywords.split(",") : [];
  const importantEmails = await emailService.filterImportantEmails(
    result.messages,
    customKeywords,
    timeRange?.toString() || "daily"
  );
  res.json({
    success: true,
    totalEmails: importantEmails.length,
    messages: importantEmails,
    nextPageToken: result.nextPageToken,
  });
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
    { recipient_id: to, subject, message, attachments },
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
    { email_id: emailId, message, attachments },
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

  const searchData = searchResponse[0].artifact?.data;
  if (!searchData) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to search emails"
    );
  }

  const messages = searchData.messages || [];
  res.json({
    success: true,
    totalEmails: messages.length,
    emails: messages,
    nextPageToken: searchData.nextPageToken,
  });
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
  const { message, history = [], modelId = null } = req.body;
  if (!message)
    throw new ApiError(StatusCodes.BAD_REQUEST, "Message is required");

  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);

  // Fetch email counts for context
  const emails = await emailService.fetchEmails({ filter: "all" });
  const emailCount = emails.messages.length;
  const unreadCount = emails.messages.filter((e) => e.unread).length;
  const context = {
    timeContext: new Date().toLocaleTimeString(),
    emailCount,
    unreadCount,
  };

  const response = await mcpServer.chatWithBot(
    req,
    message,
    history,
    context,
    modelId
  );

  res.json({ success: true, response });
});

const createDraft = catchAsync(async (req, res) => {
  const { to, subject, message } = req.body;
  const attachments = req.files || [];

  if (!to || !subject || !message) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Missing required fields");
  }

  const emailService = await createEmailService(req);
  const draftId = await emailService.draftEmail({
    to,
    subject,
    body: message,
    attachments,
  });
  res.json({
    success: true,
    draftId,
    message: "Your mail draft box successfully",
  });
});

export {
  fetchEmails,
  fetchImportantEmails,
  sendEmail,
  readEmail,
  replyToEmail,
  trashEmail,
  searchEmails,
  markEmailAsRead,
  summarizeEmail,
  chatWithBot,
  createDraft,
};
