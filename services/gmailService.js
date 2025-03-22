import { google } from "googleapis";
import fs from "fs";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import EmailService from "./emailService.js";
import { convert } from "html-to-text";

class GmailService extends EmailService {
  async getClient() {
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
      try {
        const { credentials } = await auth.refreshAccessToken();
        this.user.googleAccessToken = credentials.access_token;
        this.user.googleRefreshToken =
          credentials.refresh_token || this.user.googleRefreshToken;
        this.user.googleAccessTokenExpires = credentials.expiry_date;
        await this.user.save();
        console.log("[DEBUG] Google token refreshed");
      } catch (error) {
        console.error("[ERROR] Google token refresh failed:", error);
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          `Failed to refresh Google token: ${error.message}`
        );
      }
    }
    auth.setCredentials({
      access_token: this.user.googleAccessToken,
      refresh_token: this.user.googleRefreshToken,
    });
    return google.gmail({ version: "v1", auth });
  }

  async fetchEmails({
    query = "",
    maxResults = 5000,
    pageToken,
    filter = ["all", "sent", "archived", "important"],
  }) {
    const client = await this.getClient();
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

    const response = await client.users.messages.list(params);
    if (!response.data.messages || response.data.messages.length === 0) {
      return {
        messages: [],
        nextPageToken: response.data.nextPageToken || null,
      };
    }

    const emails = await Promise.all(
      response.data.messages.map(async (msg) => {
        const email = await client.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });
        return this.formatEmail(email.data);
      })
    );

    return {
      messages: emails,
      nextPageToken: response.data.nextPageToken || null,
    };
  }

  formatEmail(email) {
    const headers = email.payload.headers;
    return {
      id: email.id,
      threadId: email.threadId,
      subject: headers.find((h) => h.name === "Subject")?.value || "",
      from: headers.find((h) => h.name === "From")?.value || "",
      to: headers.find((h) => h.name === "To")?.value || "",
      date: headers.find((h) => h.name === "Date")?.value || "",
      snippet: email.snippet,
      body: this.getEmailBody(email.payload),
      isRead: !email.labelIds.includes("UNREAD"),
    };
  }

  getEmailBody(payload) {
    let body = "";
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
          break;
        } else if (part.mimeType === "text/html" && part.body.data) {
          body = convert(
            Buffer.from(part.body.data, "base64").toString("utf-8")
          );
        }
      }
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, "base64").toString("utf-8");
    }
    return body;
  }

  async sendEmail({ to, subject, body, attachments = [] }) {
    const client = await this.getClient();
    const raw = this.createRawEmail({ to, subject, body, attachments });
    await client.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
  }

  async getEmail(emailId) {
    const client = await this.getClient();
    const email = await client.users.messages.get({
      userId: "me",
      id: emailId,
      format: "full",
    });
    return this.formatEmail(email.data);
  }

  async replyToEmail(emailId, { body, attachments = [] }) {
    const client = await this.getClient();
    const email = await this.getEmail(emailId);
    const replyTo = email.from === this.user.email ? email.to : email.from;
    const raw = this.createRawEmail({
      to: replyTo,
      subject: `Re: ${email.subject}`,
      body,
      attachments,
    });
    await client.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: email.threadId },
    });
  }

  async trashEmail(emailId) {
    const client = await this.getClient();
    await client.users.messages.trash({ userId: "me", id: emailId });
  }

  async markAsRead(emailId, read = true) {
    const client = await this.getClient();
    await client.users.messages.modify({
      userId: "me",
      id: emailId,
      requestBody: {
        removeLabelIds: read ? ["UNREAD"] : [],
        addLabelIds: read ? [] : ["UNREAD"],
      },
    });
  }

  async draftEmail({ to, subject, body, attachments = [] }) {
    const client = await this.getClient();
    const raw = this.createRawEmail({ to, subject, body, attachments });
    const draft = await client.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw } },
    });
    return draft.data.id;
  }

  createRawEmail({ to, subject, body, attachments }) {
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
}

export default GmailService;