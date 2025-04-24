// controllers\emailController.js
import { createEmailService } from "../services/emailService.js";
import MCPServer from "../services/mcpServer.js";
import { StatusCodes } from "http-status-codes";
import { ApiError, catchAsync } from "../utils/errorHandler.js";
import NodeCache from "node-cache";
const emailListCache = new NodeCache({ stdTTL: 600 });

const fetchEmails = catchAsync(async (req, res, filter = "all") => {
  const { q, maxResults = 1000, pageToken, _t } = req.query;

  // console.log("Get query params:", q);
  // console.log("Get Filter :::", filter);

  const timeFilter = req.query.timeFilter || "all";
  if (
    timeFilter &&
    !["all", "daily", "weekly", "monthly"].includes(timeFilter) &&
    !/^\d{4}\/\d{2}\/\d{2}$/.test(timeFilter)
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid timeFilter. Must be 'all', 'daily', 'weekly', 'monthly', or a date in 'YYYY/MM/DD' format."
    );
  }

  // Include _t in cache key to ensure unique requests bypass cache
  const cacheKey = `${req.user.id}-${filter}-${q || ""}-${pageToken || ""}-${
    timeFilter || ""
  }`;
  const cachedEmails = emailListCache.get(cacheKey);
  if (cachedEmails) {
    // console.log(`Cache hit for ${cacheKey}`);
    return res.json(cachedEmails);
  }

  if (pageToken && typeof pageToken !== "string") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid pageToken");
  }

  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);

  const inboxStats = await emailService.getInboxStats();

  const emailsResponse = await mcpServer.callTool(
    "fetch-emails",
    {
      filter,
      query: q?.toString(),
      maxResults,
      pageToken: pageToken?.toString(),
      timeFilter,
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

  const responseData = {
    success: true,
    totalEmails:
      emailsData?.totalCount || parseInt(inboxStats.totalEmails || 0),
    emails: messages,
    nextPageToken: emailsData.nextPageToken,
    prevPageToken: emailsData.prevPageToken,
    maxResults,
  };

  try {
    emailListCache.set(cacheKey, responseData);
    // console.log(`Cache set for ${cacheKey}`);
  } catch (error) {
    console.error(`Failed to cache response for ${cacheKey}:`, error);
  }

  res.json(responseData);
});

// Other functions remain unchanged...
const fetchImportantEmails = catchAsync(async (req, res) => {
  const emailService = await createEmailService(req);
  const { q, maxResults = 200, pageToken, keywords = [] } = req.query;

  const timeFilter = req.query.timeFilter || "daily";

  // Normalize and validate timeFilter
  let normalizedTimeFilter = timeFilter;
  if (
    timeFilter &&
    !["all", "daily", "weekly", "monthly"].includes(timeFilter)
  ) {
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(timeFilter)) {
      const [year, month, day] = timeFilter.split("/").map(Number);
      normalizedTimeFilter = `${year}/${String(month).padStart(
        2,
        "0"
      )}/${String(day).padStart(2, "0")}`;
      // Validate the date
      const date = new Date(year, month - 1, day);
      if (
        date.getFullYear() !== year ||
        date.getMonth() + 1 !== month ||
        date.getDate() !== day
      ) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid date in timeFilter. Must be a valid date in 'YYYY/MM/DD' or 'YYYY/M/D' format."
        );
      }
    } else {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid timeFilter. Must be 'all', 'daily', 'weekly', 'monthly', or a date in 'YYYY/MM/DD' or 'YYYY/M/D' format."
      );
    }
  }

  const result = await emailService.fetchEmails({
    query: q?.toString(),
    maxResults,
    pageToken: pageToken?.toString(),
    timeFilter,
  });
  let customKeywords = [];
  if (Array.isArray(keywords)) {
    customKeywords = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
  } else if (typeof keywords === "string") {
    customKeywords = keywords
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  } else {
    customKeywords = []; // Fallback for unexpected types
  }

  const importantEmails = await emailService.filterImportantEmails(
    result.messages,
    customKeywords,
    timeFilter?.toString() || "daily"
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
  const { query, timeFilter } = req.query;
  if (!query)
    throw new ApiError(StatusCodes.BAD_REQUEST, "Search query is required");

  let normalizedTimeFilter = timeFilter || "weekly";
  if (
    normalizedTimeFilter &&
    !["all", "daily", "weekly", "monthly"].includes(normalizedTimeFilter)
  ) {
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(normalizedTimeFilter)) {
      const [year, month, day] = normalizedTimeFilter.split("/").map(Number);
      normalizedTimeFilter = `${year}/${String(month).padStart(
        2,
        "0"
      )}/${String(day).padStart(2, "0")}`;
      const date = new Date(year, month - 1, day);
      if (
        date.getFullYear() !== year ||
        date.getMonth() + 1 !== month ||
        date.getDate() !== day
      ) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid date in timeFilter. Must be a valid date in 'YYYY/MM/DD' or 'YYYY/M/D' format."
        );
      }
    } else {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid timeFilter. Must be 'all', 'daily', 'weekly', 'monthly', or a date in 'YYYY/MM/DD' or 'YYYY/M/D' format."
      );
    }
  }

  const emailService = await createEmailService(req);
  const mcpServer = new MCPServer(emailService);
  const effectiveTimeFilter = timeFilter || "weekly";
  const searchResponse = await mcpServer.callTool(
    "search-emails",
    { query, timeFilter: effectiveTimeFilter },
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
