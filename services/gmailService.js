// services/gmailService.js
import { google } from "googleapis";
import fs from "fs/promises";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import EmailService from "./emailService.js";
import { convert } from "html-to-text";
import { decrypt, encrypt } from "../utils/encryptionUtils.js";
import NodeCache from "node-cache";
const statsCache = new NodeCache({ stdTTL: 300 });

class GmailService extends EmailService {
  async getClient() {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const encryptedRefreshToken = this.user.googleRefreshToken;
    if (!encryptedRefreshToken) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "No Google refresh token available. Please re-authenticate."
      );
    }

    const refreshToken = decrypt(encryptedRefreshToken);
    const encryptedAccessToken = this.user.googleAccessToken;
    let accessToken = encryptedAccessToken
      ? decrypt(encryptedAccessToken)
      : null;

    const googleTokenExpiry = this.user.googleAccessTokenExpires || 0;
    if (googleTokenExpiry < Date.now() || !accessToken) {
      auth.setCredentials({
        refresh_token: refreshToken,
      });
      try {
        const { credentials } = await auth.refreshAccessToken();
        accessToken = credentials.access_token;
        this.user.googleAccessToken = encrypt(credentials.access_token);
        this.user.googleRefreshToken = credentials.refresh_token
          ? encrypt(credentials.refresh_token)
          : this.user.googleRefreshToken;
        this.user.googleAccessTokenExpires = credentials.expiry_date;
        await this.user.save();
        console.log("[DEBUG] Google token refreshed");
      } catch (error) {
        console.error("[ERROR] Google token refresh failed:", error);
        if (error.response?.data?.error === "invalid_grant") {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Refresh token is invalid or revoked. Please re-authenticate."
          );
        }
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          `Failed to refresh Google token: ${error.message || "Unknown error"}`
        );
      }
    }

    auth.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return google.gmail({ version: "v1", auth });
  }

  async fetchEmails({
    query = "",
    maxResults = 1000,
    pageToken,
    filter = "all",
  }) {
    const client = await this.getClient();

    // Ensure maxResults is a number
    const maxResultsNum = Number(maxResults);
    if (isNaN(maxResultsNum)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid maxResults value");
    }

    const params = {
      userId: "me",
      maxResults: maxResultsNum,
      q: query,
      pageToken,
    };

    const filterMap = {
      all: (params) => params, 
      read: (params) => {
        params.q = params.q ? `${params.q} is:read` : "is:read";
        return params;
      },
      unread: (params) => {
        params.q = params.q ? `${params.q} is:unread` : "is:unread";
        return params;
      },
      archived: (params) => {
        params.q = params.q ? `${params.q} -in:inbox` : "-in:inbox";
        return params;
      },
      starred: (params) => {
        params.q = params.q ? `${params.q} is:starred` : "is:starred";
        return params;
      },
      sent: (params) => {
        params.labelIds = ["SENT"];
        return params;
      },
      drafts: (params) => {
        params.labelIds = ["DRAFT"];
        return params;
      },
      important: (params) => {
        params.labelIds = ["IMPORTANT"];
        return params;
      },
      // trash: (params) => {
      //   params.labelIds = ["TRASH"];
      //   return params;
      // },
    };

    const appliedFilter = filterMap[filter.toLowerCase()] || filterMap["all"];
    const filteredParams = appliedFilter(params, filter);

    try {
      const response = await client.users.messages.list(filteredParams);
      // Check if response status is not 200 or data is invalid
      if (response.status !== 200 || !response.data) {
        console.error(
          `[ERROR] Gmail API returned status ${response.status}: ${response.statusText}`
        );
        return { messages: [], nextPageToken: null };
      }

      const messages = response.data.messages || [];
      const emails = await Promise.all(
        messages.map(async (msg) => {
          try {
            const email = await client.users.messages.get({
              userId: "me",
              id: msg.id,
              format: "full",
            });
            return this.formatEmail(email.data);
          } catch (error) {
            console.error(`[ERROR] Failed to fetch email ${msg.id}:`, error);
            return null; // Skip failed emails
          }
        })
      );

      return {
        messages: emails.filter(Boolean), 
        nextPageToken: response.data.nextPageToken || null,
      };
    } catch (error) {
      console.error("[ERROR] Failed to fetch emails:", error);
      return { messages: [], nextPageToken: null }; 
    }
  }

  formatEmail(email) {
    const headers = email.payload.headers || [];
    return {
      id: email.id || "",
      threadId: email.threadId || "",
      subject: headers.find((h) => h.name === "Subject")?.value || "",
      from: headers.find((h) => h.name === "From")?.value || "",
      to: headers.find((h) => h.name === "To")?.value || "",
      date: headers.find((h) => h.name === "Date")?.value || "",
      snippet: email.snippet || "",
      body: this.getEmailBody(email.payload),
      isRead: !(email.labelIds || []).includes("UNREAD"),
    };
  }

  getEmailBody(payload) {
    if (!payload) return "";

    let body = "";
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
          break;
        } else if (part.mimeType === "text/html" && part.body?.data) {
          body = convert(
            Buffer.from(part.body.data, "base64").toString("utf-8")
          );
        } else if (part.parts) {
          // Handle nested multipart messages
          for (const nestedPart of part.parts) {
            if (nestedPart.mimeType === "text/plain" && nestedPart.body?.data) {
              body = Buffer.from(nestedPart.body.data, "base64").toString(
                "utf-8"
              );
              break;
            } else if (
              nestedPart.mimeType === "text/html" &&
              nestedPart.body?.data
            ) {
              body = convert(
                Buffer.from(nestedPart.body.data, "base64").toString("utf-8")
              );
            }
          }
        }
      }
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, "base64").toString("utf-8");
      if (payload.mimeType === "text/html") {
        body = convert(body);
      }
    }
    return body;
  }

  async sendEmail({ to, subject, body, attachments = [] }) {
    const client = await this.getClient();
    const raw = await this.createRawEmail({ to, subject, body, attachments });
    try {
      await client.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
    } catch (error) {
      console.error("[ERROR] Failed to send email:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to send email: ${error.message || "Unknown error"}`
      );
    }
  }

  async getEmail(emailId) {
    const client = await this.getClient();
    try {
      const email = await client.users.messages.get({
        userId: "me",
        id: emailId,
        format: "full",
      });
      return this.formatEmail(email.data);
    } catch (error) {
      console.error("[ERROR] Failed to get email:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to get email: ${error.message || "Unknown error"}`
      );
    }
  }

  async replyToEmail(emailId, { body, attachments = [] }) {
    const client = await this.getClient();
    try {
      const email = await this.getEmail(emailId);
      const replyTo = email.from === this.user.email ? email.to : email.from;
      const raw = await this.createRawEmail({
        to: replyTo,
        subject: `Re: ${email.subject}`,
        body,
        attachments,
      });

      await client.users.messages.send({
        userId: "me",
        requestBody: { raw, threadId: email.threadId },
      });
    } catch (error) {
      console.error("[ERROR] Failed to reply to email:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to reply to email: ${error.message || "Unknown error"}`
      );
    }
  }

  async trashEmail(emailId) {
    const client = await this.getClient();
    try {
      await client.users.messages.trash({ userId: "me", id: emailId });
    } catch (error) {
      console.error("[ERROR] Failed to trash email:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to trash email: ${error.message || "Unknown error"}`
      );
    }
  }

  async markAsRead(emailId, read = true) {
    const client = await this.getClient();
    try {
      await client.users.messages.modify({
        userId: "me",
        id: emailId,
        requestBody: {
          removeLabelIds: read ? ["UNREAD"] : [],
          addLabelIds: read ? [] : ["UNREAD"],
        },
      });
    } catch (error) {
      console.error("[ERROR] Failed to mark email as read:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to mark email as read: ${error.message || "Unknown error"}`
      );
    }
  }

  async draftEmail({ to, subject, body, attachments = [] }) {
    const client = await this.getClient();
    try {
      const raw = await this.createRawEmail({ to, subject, body, attachments });

      const draft = await client.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw } },
      });
      return draft.data.id;
    } catch (error) {
      console.error("[ERROR] Failed to create draft:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to create draft: ${error.message || "Unknown error"}`
      );
    }
  }

  async getInboxStats() {
    const cacheKey = `inbox-stats-${this.user.email}`;
    const cachedStats = statsCache.get(cacheKey);
    if (cachedStats) return cachedStats;

    const client = await this.getClient();
    try {
      const inboxResponse = await client.users.labels.get({
        userId: "me",
        id: "INBOX",
      });
      const totalUnreadResponse = await client.users.messages.list({
        userId: "me",
        // q: "is:unread", // all unread emails
        q: "in:inbox is:unread", // unread emails in inbox
        maxResults: 1000,
      });

      let totalEmails = inboxResponse.data.messagesTotal ?? 0;
      let unreadEmails = totalUnreadResponse.data.resultSizeEstimate ?? 0;
      const stats = { totalEmails, unreadEmails };
      statsCache.set(cacheKey, stats);
      return stats;
    } catch (error) {
      console.error("[ERROR] Failed to get Gmail inbox stats:", error);
      return { totalEmails: 0, unreadEmails: 0 };
    }
  }

  async getEmailCount({ filter = "all", query = "" }) {
    const client = await this.getClient();
    let q = query;
    if (filter === "unread") q += " is:unread";
    // Add other filters as needed (e.g., "read", "starred")
    try {
      const response = await client.users.messages.list({
        userId: "me",
        q,
        maxResults: 1000, // Just get the count
      });
      return response.data.resultSizeEstimate || 0;
    } catch (error) {
      console.error("[ERROR] Failed to count Gmail emails:", error);
      return 0;
    }
  }

  async createRawEmail({ to, subject, body, attachments = [] }) {
    const boundary = `boundary_${Date.now().toString(16)}`;
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
      try {
        const fileContent = await fs.readFile(attachment.path, {
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
      } catch (error) {
        console.error(`Failed to read attachment ${attachment.path}:`, error);
        throw new ApiError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          `Failed to read attachment: ${error.message || "Unknown error"}`
        );
      }
    }

    email.push(`--${boundary}--`);

    return Buffer.from(email.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
}

export default GmailService;
