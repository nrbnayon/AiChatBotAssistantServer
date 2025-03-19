import { google } from "googleapis";
import fetch from "node-fetch";
import fs from "fs";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import Groq from "groq-sdk";
import User from "../models/User.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class EmailService {
  constructor(user) {
    this.user = user;
    this.grok = groq;
    this.analysisCache = new Map();
  }

  async getEmailClient() {
    console.log(
      "[DEBUG] Getting email client for provider:",
      this.user.authProvider
    );
    switch (this.user.authProvider) {
      case "google":
        const auth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        if (!this.user.googleRefreshToken) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "No Google refresh token available. Please re-authenticate."
          );
        }
        const googleTokenExpiry = this.user.googleAccessTokenExpires || 0;
        if (googleTokenExpiry < Date.now()) {
          auth.setCredentials({
            access_token: this.user.googleAccessToken,
            refresh_token: this.user.googleRefreshToken,
          });
          const { credentials } = await auth.refreshAccessToken();
          this.user.googleAccessToken = credentials.access_token;
          this.user.googleRefreshToken =
            credentials.refresh_token || this.user.googleRefreshToken;
          this.user.googleAccessTokenExpires = credentials.expiry_date;
          await this.user.save();
          console.log("[DEBUG] Google token refreshed");
        }
        auth.setCredentials({
          access_token: this.user.googleAccessToken,
          refresh_token: this.user.googleRefreshToken,
        });
        return google.gmail({ version: "v1", auth });

      case "microsoft":
        const microsoftTokenExpiry = this.user.microsoftAccessTokenExpires || 0;
        if (microsoftTokenExpiry < Date.now()) {
          const response = await fetch(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: process.env.MICROSOFT_CLIENT_ID,
                client_secret: process.env.MICROSOFT_CLIENT_SECRET,
                refresh_token: this.user.microsoftRefreshToken,
                grant_type: "refresh_token",
              }),
            }
          );
          if (!response.ok)
            throw new ApiError(
              StatusCodes.UNAUTHORIZED,
              "Failed to refresh Microsoft token"
            );
          const { access_token, refresh_token, expires_in } =
            await response.json();
          this.user.microsoftAccessToken = access_token;
          this.user.microsoftRefreshToken =
            refresh_token || this.user.microsoftRefreshToken;
          this.user.microsoftAccessTokenExpires =
            Date.now() + expires_in * 1000;
          await this.user.save();
          console.log("[DEBUG] Microsoft token refreshed");
        }
        return {
          accessToken: this.user.microsoftAccessToken,
          baseUrl: "https://graph.microsoft.com/v1.0/me",
        };

      case "yahoo":
        const yahooTokenExpiry = this.user.yahooAccessTokenExpires || 0;
        if (yahooTokenExpiry < Date.now()) {
          const response = await fetch(
            "https://api.login.yahoo.com/oauth2/get_token",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: process.env.YAHOO_CLIENT_ID,
                client_secret: process.env.YAHOO_CLIENT_SECRET,
                refresh_token: this.user.yahooRefreshToken,
                grant_type: "refresh_token",
              }),
            }
          );
          if (!response.ok)
            throw new ApiError(
              StatusCodes.UNAUTHORIZED,
              "Failed to refresh Yahoo token"
            );
          const { access_token, refresh_token, expires_in } =
            await response.json();
          this.user.yahooAccessToken = access_token;
          this.user.yahooRefreshToken =
            refresh_token || this.user.yahooRefreshToken;
          this.user.yahooAccessTokenExpires = Date.now() + expires_in * 1000;
          await this.user.save();
          console.log("[DEBUG] Yahoo token refreshed");
        }
        return {
          accessToken: this.user.yahooAccessToken,
          baseUrl: "https://api.mail.yahoo.com",
        };

      default:
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Unsupported email provider"
        );
    }
  }

  async fetchEmails({
    query = "",
    maxResults = 5000,
    pageToken,
    filter = "all",
  } = {}) {
    const client = await this.getEmailClient();
    console.log(
      "[DEBUG] Fetching emails with filter:",
      filter,
      "query:",
      query,
      "for provider:",
      this.user.authProvider
    );
    try {
      switch (this.user.authProvider) {
        case "google":
          return await this.fetchGmailEmails(client, {
            query,
            maxResults,
            pageToken,
            filter,
          });
        case "microsoft":
          return await this.fetchMicrosoftEmails(client, {
            query,
            maxResults,
            pageToken,
            filter,
          });
        case "yahoo":
          return await this.fetchYahooEmails(client, {
            query,
            maxResults,
            pageToken,
            filter,
          });
        default:
          throw new ApiError(StatusCodes.BAD_REQUEST, "Unsupported provider");
      }
    } catch (error) {
      console.error("[ERROR] Fetch emails failed:", error.message);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to fetch emails: ${error.message}`
      );
    }
  }

  async fetchGmailEmails(
    client,
    { query, maxResults = 5000, pageToken, filter }
  ) {
    const params = { userId: "me", maxResults, q: query, pageToken };
    switch (filter.toLowerCase()) {
      case "all":
        break;
      case "read":
        params.q = params.q ? `${params.q} is:read` : "is:read";
        break;
      case "unread":
        params.q = params.q ? `${params.q} is:unread` : "is:unread";
        break;
      case "archived":
        params.q = params.q ? `${params.q} -in:inbox` : "-in:inbox";
        break;
      case "starred":
        params.q = params.q ? `${params.q} is:starred` : "is:starred";
        break;
      case "sent":
        params.labelIds = ["SENT"];
        break;
      case "drafts":
        params.labelIds = ["DRAFT"];
        break;
      case "important":
        params.labelIds = ["IMPORTANT"];
        break;
      case "trash":
        params.labelIds = ["TRASH"];
        break;
      default:
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Unsupported filter: ${filter}`
        );
    }

    console.log("[DEBUG] Gmail API list params:", params);

    let response;
    try {
      response = await client.users.messages.list(params);
    } catch (error) {
      console.error(
        "[ERROR] Gmail list API failed:",
        error.response?.data || error
      );
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Gmail search failed: ${error.message}`
      );
    }

    if (!response.data.messages || response.data.messages.length === 0) {
      return {
        messages: [],
        nextPageToken: response.data.nextPageToken || null,
      };
    }

    const emails = await Promise.all(
      response.data.messages.map(async (msg) => {
        try {
          const email = await client.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "full",
          });
          return this.formatGoogleEmail(email.data);
        } catch (error) {
          console.error(
            `[ERROR] Failed to fetch Gmail email ${msg.id}:`,
            error.response?.data || error
          );
          return null; // Skip invalid emails
        }
      })
    ).then((results) => results.filter((email) => email !== null));

    return {
      messages: emails,
      nextPageToken: response.data.nextPageToken || null,
    };
  }

  async fetchMicrosoftEmails(client, { query, maxResults, pageToken, filter }) {
    let endpoint;
    const baseParams = `?$top=${maxResults}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead`;
    switch (filter.toLowerCase()) {
      case "all":
        endpoint = `${client.baseUrl}/messages${baseParams}`;
        break;
      case "read":
        endpoint = `${client.baseUrl}/messages${baseParams}&$filter=isRead eq true`;
        break;
      case "unread":
        endpoint = `${client.baseUrl}/messages${baseParams}&$filter=isRead eq false`;
        break;
      case "archived":
        endpoint = `${client.baseUrl}/mailFolders/archive/messages${baseParams}`;
        break;
      case "starred":
        endpoint = `${client.baseUrl}/messages${baseParams}&$filter=flag/flagStatus eq 'flagged'`;
        break;
      case "sent":
        endpoint = `${client.baseUrl}/mailFolders/sentitems/messages${baseParams}`;
        break;
      case "drafts":
        endpoint = `${client.baseUrl}/mailFolders/drafts/messages${baseParams}`;
        break;
      case "trash":
        endpoint = `${client.baseUrl}/mailFolders/deleteditems/messages${baseParams}`;
        break;
      default:
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Unsupported filter: ${filter}`
        );
    }
    if (pageToken) endpoint += `&$skiptoken=${pageToken}`;
    if (query) endpoint += `&$search="${encodeURIComponent(query)}"`;

    console.log("[DEBUG] Microsoft Graph API endpoint:", endpoint);

    let response;
    try {
      response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Microsoft API error: ${errorData.error.message}`);
      }
    } catch (error) {
      console.error("[ERROR] Microsoft fetch failed:", error.message);
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Microsoft search failed: ${error.message}`
      );
    }

    const data = await response.json();
    return {
      messages: data.value.map(this.formatMicrosoftEmail),
      nextPageToken: data["@odata.nextLink"]
        ? data["@odata.nextLink"].split("skiptoken=")[1]
        : null,
    };
  }

  async fetchYahooEmails(client, { query, maxResults, pageToken, filter }) {
    let endpoint = `${client.baseUrl}/v1/messages?count=${maxResults}`;
    let folder;
    switch (filter.toLowerCase()) {
      case "all":
        folder = "inbox";
        break;
      case "read":
        folder = "inbox";
        break;
      case "unread":
        folder = "inbox";
        break;
      case "archived":
        folder = "archive";
        break;
      case "starred":
        folder = "starred";
        break;
      case "sent":
        folder = "sent";
        break;
      case "drafts":
        folder = "drafts";
        break;
      case "trash":
        folder = "trash";
        break;
      default:
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Unsupported filter: ${filter}`
        );
    }
    if (folder) endpoint += `&folder=${folder}`;
    if (query) endpoint += `&query=${encodeURIComponent(query)}`;
    if (pageToken) endpoint += `&start=${pageToken}`;

    console.log("[DEBUG] Yahoo API endpoint:", endpoint);

    let response;
    try {
      response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          `Yahoo API error: ${errorData.error?.description || "Unknown error"}`
        );
      }
    } catch (error) {
      console.error("[ERROR] Yahoo fetch failed:", error.message);
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Yahoo search failed: ${error.message}`
      );
    }

    const data = await response.json();
    let messages = data.messages?.map(this.formatYahooEmail) || [];
    if (filter === "read") messages = messages.filter((m) => m.isRead);
    if (filter === "unread") messages = messages.filter((m) => !m.isRead);

    return { messages, nextPageToken: data.nextPageToken || null };
  }

  async filterImportantEmails(
    emails,
    customKeywords = [],
    timeRange = "weekly"
  ) {
    // Correctly fetch user keywords from userImportantMailKeywords
    const userKeywords = this.user.userImportantMailKeywords || [];
    const keywords = [...new Set([...userKeywords, ...customKeywords])];
    const timeFrames = {
      daily: 1 * 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
    };
    const timeLimit = timeFrames[timeRange] || timeFrames.weekly;

    // Filter emails by time range
    const recentEmails = emails.filter((email) => {
      const emailDate = new Date(email.date);
      const cutoffDate = new Date(Date.now() - timeLimit);
      return emailDate >= cutoffDate;
    });

    // Pre-filter emails and use cache
    const emailsToAnalyze = [];
    const processedEmails = [];

    for (const email of recentEmails) {
      const emailKey = `${email.id}-${timeRange}`; // Unique key per email and time range
      const content =
        `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();

      // Check cache first
      if (this.analysisCache.has(emailKey)) {
        processedEmails.push(this.analysisCache.get(emailKey));
        continue;
      }

      // Pre-filter based on keywords
      const hasKeyword = keywords.some((keyword) =>
        content.includes(keyword.toLowerCase())
      );

      if (hasKeyword) {
        emailsToAnalyze.push(email);
      } else {
        const nonImportantEmail = {
          ...email,
          importanceScore: 0,
          isImportant: false,
        };
        processedEmails.push(nonImportantEmail);
        this.analysisCache.set(emailKey, nonImportantEmail);
      }
    }

    // Analyze only emails with keywords
    const analysisPromises = emailsToAnalyze.map(async (email) => {
      const emailKey = `${email.id}-${timeRange}`;
      const content =
        `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();
      const prompt = `
        Analyze the following email content and determine if it's important based on these keywords: ${keywords.join(
          ", "
        )}.
        Consider context, sender, and urgency. Return only a valid JSON object: {"score": NUMBER_BETWEEN_0_AND_100, "isImportant": BOOLEAN_VALUE}
        
        Email content: "${content}"
        Sender: "${email.from}"
      `;

      try {
        const response = await this.grok.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama3-70b-8192",
          temperature: 0.5,
        });

        const responseText = response.choices[0]?.message?.content || "";
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch
          ? jsonMatch[0]
          : '{"score": 25, "isImportant": false}';
        let result;
        try {
          result = JSON.parse(jsonStr);
        } catch (parseError) {
          console.error(
            "JSON parse error:",
            parseError,
            "Response:",
            responseText
          );
          result = { score: 25, isImportant: false };
        }

        const analyzedEmail = {
          ...email,
          importanceScore: result.score,
          isImportant: result.isImportant,
        };
        this.analysisCache.set(emailKey, analyzedEmail); // Cache the result
        return analyzedEmail;
      } catch (error) {
        console.error("Error analyzing email:", error);
        const fallbackEmail = {
          ...email,
          importanceScore: 0,
          isImportant: false,
        };
        this.analysisCache.set(emailKey, fallbackEmail);
        return fallbackEmail;
      }
    });

    const analyzedEmails = await Promise.all(analysisPromises);
    const allEmails = [...analyzedEmails, ...processedEmails];

    // Return filtered and sorted important emails
    return allEmails
      .filter((email) => email.isImportant)
      .sort((a, b) => b.importanceScore - a.importanceScore);
  }

  formatGoogleEmail(email) {
    const headers = email.payload.headers;
    return {
      id: email.id,
      threadId: email.threadId,
      subject: headers.find((h) => h.name === "Subject")?.value || "",
      from: headers.find((h) => h.name === "From")?.value || "",
      to: headers.find((h) => h.name === "To")?.value || "",
      date: headers.find((h) => h.name === "Date")?.value || "",
      snippet: email.snippet,
      body: this.getGoogleEmailBody(email.payload),
      isRead: !email.labelIds.includes("UNREAD"),
    };
  }

  getGoogleEmailBody(payload) {
    let body = "";
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
          break;
        } else if (part.mimeType === "text/html" && part.body.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      }
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, "base64").toString("utf-8");
    }
    return body;
  }

  formatMicrosoftEmail(email) {
    return {
      id: email.id,
      subject: email.subject || "",
      from: email.from?.emailAddress?.address || "",
      to:
        email.toRecipients?.map((r) => r.emailAddress.address).join(", ") || "",
      date: email.receivedDateTime || "",
      snippet: email.bodyPreview || "",
      body: email.body?.content || "",
      isRead: email.isRead || false,
    };
  }

  formatYahooEmail(email) {
    return {
      id: email.id,
      subject: email.subject || "",
      from: email.from?.email || "",
      to: email.to?.map((r) => r.email).join(", ") || "",
      date: email.receivedDate || "",
      snippet: email.snippet || "",
      body: email.plainText || "",
      isRead: email.isRead || false,
    };
  }

  async sendEmail({ to, subject, body, attachments = [] }) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        const raw = this.createGoogleRawEmail({
          to,
          subject,
          body,
          attachments,
        });
        await client.users.messages.send({
          userId: "me",
          requestBody: { raw },
        });
        break;
      case "microsoft":
        await this.sendMicrosoftEmail(client, {
          to,
          subject,
          body,
          attachments,
        });
        break;
      case "yahoo":
        await this.sendYahooEmail(client, { to, subject, body, attachments });
        break;
      default:
        throw new ApiError(StatusCodes.BAD_REQUEST, "Unsupported provider");
    }
  }

  createGoogleRawEmail({ to, subject, body, attachments }) {
    const boundary = "boundary_example";
    let email = [
      `To: ${to}`,
      "Content-Type: multipart/mixed; boundary=" + boundary,
      `Subject: ${subject}`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body,
    ];
    for (const attachment of attachments) {
      const fileContent = fs.readFileSync(attachment.path, {
        encoding: "base64",
      });
      email.push(
        `--${boundary}`,
        `Content-Type: ${attachment.mimetype}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        "",
        fileContent
      );
    }
    email.push(`--${boundary}--`);
    return Buffer.from(email.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  async sendMicrosoftEmail(client, { to, subject, body, attachments }) {
    const message = {
      subject,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    if (attachments.length) {
      message.attachments = attachments.map((file) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: file.filename,
        contentBytes: fs.readFileSync(file.path, { encoding: "base64" }),
        contentType: file.mimetype,
      }));
    }
    await fetch(`${client.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
  }

  async sendYahooEmail(client, { to, subject, body, attachments }) {
    const formData = new FormData();
    formData.append("to", to);
    formData.append("subject", subject);
    formData.append("body", body);
    attachments.forEach((file) => {
      formData.append(
        "attachments",
        fs.createReadStream(file.path),
        file.filename
      );
    });
    await fetch(`${client.baseUrl}/v1/message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${client.accessToken}` },
      body: formData,
    });
  }

  async getEmail(emailId) {
    if (!emailId || typeof emailId !== "string" || emailId.trim() === "") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Valid email ID is required");
    }
    const client = await this.getEmailClient();
    console.log(
      "[DEBUG] Fetching email with ID:",
      emailId,
      "for provider:",
      this.user.authProvider
    );
    try {
      switch (this.user.authProvider) {
        case "google":
          const email = await client.users.messages.get({
            userId: "me",
            id: emailId,
            format: "full",
          });
          return this.formatGoogleEmail(email.data);
        case "microsoft":
          const msResponse = await fetch(
            `${client.baseUrl}/messages/${emailId}`,
            {
              headers: { Authorization: `Bearer ${client.accessToken}` },
            }
          );
          if (!msResponse.ok) {
            const errorData = await msResponse.json();
            throw new Error(`Microsoft API error: ${errorData.error.message}`);
          }
          return this.formatMicrosoftEmail(await msResponse.json());
        case "yahoo":
          const yahooResponse = await fetch(
            `${client.baseUrl}/v1/message/${emailId}`,
            {
              headers: { Authorization: `Bearer ${client.accessToken}` },
            }
          );
          if (!yahooResponse.ok) {
            const errorData = await yahooResponse.json();
            throw new Error(
              `Yahoo API error: ${
                errorData.error?.description || "Unknown error"
              }`
            );
          }
          return this.formatYahooEmail(await yahooResponse.json());
        default:
          throw new ApiError(StatusCodes.BAD_REQUEST, "Unsupported provider");
      }
    } catch (error) {
      console.error(
        "[ERROR] Get email failed for ID:",
        emailId,
        "Error:",
        error.message
      );
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to get email: ${error.message}`
      );
    }
  }

  async replyToEmail(emailId, { body, attachments = [] }) {
    const client = await this.getEmailClient();
    const email = await this.getEmail(emailId);
    const replyTo = email.from === this.user.email ? email.to : email.from;

    switch (this.user.authProvider) {
      case "google":
        const raw = this.createGoogleRawEmail({
          to: replyTo,
          subject: `Re: ${email.subject}`,
          body,
          attachments,
        });
        await client.users.messages.send({
          userId: "me",
          requestBody: { raw, threadId: email.threadId },
        });
        break;
      case "microsoft":
        await this.sendMicrosoftEmail(client, {
          to: replyTo,
          subject: `Re: ${email.subject}`,
          body,
          attachments,
        });
        break;
      case "yahoo":
        await this.sendYahooEmail(client, {
          to: replyTo,
          subject: `Re: ${email.subject}`,
          body,
          attachments,
        });
        break;
    }
  }

  async trashEmail(emailId) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        await client.users.messages.trash({ userId: "me", id: emailId });
        break;
      case "microsoft":
        await fetch(`${client.baseUrl}/messages/${emailId}/move`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destinationId: "deleteditems" }),
        });
        break;
      case "yahoo":
        await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${client.accessToken}` },
        });
        break;
    }
  }

  async markAsRead(emailId, read = true) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        await client.users.messages.modify({
          userId: "me",
          id: emailId,
          requestBody: {
            removeLabelIds: read ? ["UNREAD"] : [],
            addLabelIds: read ? [] : ["UNREAD"],
          },
        });
        break;
      case "microsoft":
        await fetch(`${client.baseUrl}/messages/${emailId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isRead: read }),
        });
        break;
      case "yahoo":
        await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isRead: read }),
        });
        break;
    }
  }
  clearCache() {
    this.analysisCache.clear();
  }
}

export const createEmailService = async (req) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  return new EmailService(user);
};
