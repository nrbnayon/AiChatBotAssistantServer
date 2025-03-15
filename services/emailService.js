import { google } from "googleapis";
import fetch from "node-fetch";
import * as imap from "imap-simple";
import * as nodemailer from "nodemailer";
import User from "../models/User.js";
import { StatusCodes } from "http-status-codes";

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

const oauth2Client = new google.auth.OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI,
});

const getGoogleAuth = async (user) => {
  oauth2Client.setCredentials({
    access_token: user.googleAccessToken || undefined,
    refresh_token: user.googleRefreshToken || undefined,
  });

  if (!user.googleRefreshToken) {
    try {
      await oauth2Client.getTokenInfo(user.googleAccessToken);
      return oauth2Client;
    } catch (error) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "Authentication expired. Please re-authenticate with Google."
      );
    }
  }

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    if (credentials.access_token) {
      user.googleAccessToken = credentials.access_token;
      if (credentials.refresh_token) {
        user.googleRefreshToken = credentials.refresh_token;
      }
      user.lastSync = new Date();
      await user.save();
    }
    return oauth2Client;
  } catch (error) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Failed to refresh Google token"
    );
  }
};

// Interface for email services
class EmailService {
  async fetchEmails() {
    throw new Error("Method not implemented");
  }

  async sendEmail(recipientId, subject, message, attachments) {
    throw new Error("Method not implemented");
  }

  async readEmail(emailId) {
    throw new Error("Method not implemented");
  }

  async replyToEmail(emailId, message, attachments) {
    throw new Error("Method not implemented");
  }

  async trashEmail(emailId) {
    throw new Error("Method not implemented");
  }

  async markEmailAsRead(emailId) {
    throw new Error("Method not implemented");
  }

  async searchEmails(query) {
    throw new Error("Method not implemented");
  }

  async summarizeEmail(emailId) {
    throw new Error("Method not implemented");
  }

  async syncEmails() {
    throw new Error("Method not implemented");
  }
}

class GmailService extends EmailService {
  constructor(oauth2Client, userEmail, userId) {
    super();
    this.gmail = google.gmail({ version: "v1", auth: oauth2Client });
    this.userEmail = userEmail;
    this.userId = userId;
  }

  async syncEmails() {
    try {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      const year = twoMonthsAgo.getFullYear();
      const month = String(twoMonthsAgo.getMonth() + 1).padStart(2, "0");
      const day = String(twoMonthsAgo.getDate()).padStart(2, "0");
      const formattedDate = `${year}/${month}/${day}`;
      const query = `after:${formattedDate}`;

      const { data } = await this.gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 150,
      });

      if (!data.messages || data.messages.length === 0) {
        await User.findByIdAndUpdate(this.userId, {
          emailSyncStatus: "COMPLETED",
          lastSync: new Date(),
        });
        return [];
      }

      const emails = await Promise.all(
        data.messages.map(async (message) => {
          const response = await this.gmail.users.messages.get({
            userId: "me",
            id: message.id,
            format: "full",
          });

          const { payload, snippet, internalDate } = response.data;
          const headers = payload.headers.reduce((acc, header) => {
            acc[header.name.toLowerCase()] = header.value;
            return acc;
          }, {});

          let body = "";
          const decodeBase64 = (data) => {
            try {
              if (!data) return "";
              return Buffer.from(data, "base64").toString("utf-8");
            } catch (error) {
              return "";
            }
          };

          if (payload.parts && payload.parts.length > 0) {
            const textPart = payload.parts.find(
              (part) => part.mimeType === "text/plain"
            );
            const htmlPart = payload.parts.find(
              (part) => part.mimeType === "text/html"
            );
            if (textPart && textPart.body && textPart.body.data) {
              body = decodeBase64(textPart.body.data);
            } else if (htmlPart && htmlPart.body && htmlPart.body.data) {
              body = decodeBase64(htmlPart.body.data);
            } else {
              for (const part of payload.parts) {
                if (part.parts) {
                  const nestedTextPart = part.parts.find(
                    (p) => p.mimeType === "text/plain"
                  );
                  const nestedHtmlPart = part.parts.find(
                    (p) => p.mimeType === "text/html"
                  );
                  if (
                    nestedTextPart &&
                    nestedTextPart.body &&
                    nestedTextPart.body.data
                  ) {
                    body = decodeBase64(nestedTextPart.body.data);
                    break;
                  } else if (
                    nestedHtmlPart &&
                    nestedHtmlPart.body &&
                    nestedHtmlPart.body.data
                  ) {
                    body = decodeBase64(nestedHtmlPart.body.data);
                    break;
                  }
                }
              }
            }
          } else if (payload.body && payload.body.data) {
            body = decodeBase64(payload.body.data);
          }

          return {
            id: message.id,
            threadId: response.data.threadId,
            date: new Date(parseInt(internalDate)).toISOString(),
            from: headers.from || "",
            to: headers.to || "",
            subject: headers.subject || "(No Subject)",
            snippet,
            body: body.substring(0, 2000),
          };
        })
      );

      await User.findByIdAndUpdate(this.userId, {
        emailSyncStatus: "COMPLETED",
        lastSync: new Date(),
      });

      return emails;
    } catch (error) {
      console.error("Gmail sync error:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to sync Gmail emails"
      );
    }
  }

  async fetchEmails() {
    try {
      const user = await User.findById(this.userId);
      if (user.emailSyncStatus === "PENDING") {
        await this.syncEmails();
      }

      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      const year = twoMonthsAgo.getFullYear();
      const month = String(twoMonthsAgo.getMonth() + 1).padStart(2, "0");
      const day = String(twoMonthsAgo.getDate()).padStart(2, "0");
      const formattedDate = `${year}/${month}/${day}`;
      const query = `after:${formattedDate}`;

      const { data } = await this.gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 150,
      });

      if (!data.messages || data.messages.length === 0) {
        return [];
      }

      const emails = await Promise.all(
        data.messages.map(async (message) => {
          const response = await this.gmail.users.messages.get({
            userId: "me",
            id: message.id,
            format: "full",
          });

          const { payload, snippet, internalDate } = response.data;
          const headers = payload.headers.reduce((acc, header) => {
            acc[header.name.toLowerCase()] = header.value;
            return acc;
          }, {});

          let body = "";
          const decodeBase64 = (data) => {
            try {
              if (!data) return "";
              return Buffer.from(data, "base64").toString("utf-8");
            } catch (error) {
              return "";
            }
          };

          if (payload.parts && payload.parts.length > 0) {
            const textPart = payload.parts.find(
              (part) => part.mimeType === "text/plain"
            );
            const htmlPart = payload.parts.find(
              (part) => part.mimeType === "text/html"
            );
            if (textPart && textPart.body && textPart.body.data) {
              body = decodeBase64(textPart.body.data);
            } else if (htmlPart && htmlPart.body && htmlPart.body.data) {
              body = decodeBase64(htmlPart.body.data);
            } else {
              for (const part of payload.parts) {
                if (part.parts) {
                  const nestedTextPart = part.parts.find(
                    (p) => p.mimeType === "text/plain"
                  );
                  const nestedHtmlPart = part.parts.find(
                    (p) => p.mimeType === "text/html"
                  );
                  if (
                    nestedTextPart &&
                    nestedTextPart.body &&
                    nestedTextPart.body.data
                  ) {
                    body = decodeBase64(nestedTextPart.body.data);
                    break;
                  } else if (
                    nestedHtmlPart &&
                    nestedHtmlPart.body &&
                    nestedHtmlPart.body.data
                  ) {
                    body = decodeBase64(nestedHtmlPart.body.data);
                    break;
                  }
                }
              }
            }
          } else if (payload.body && payload.body.data) {
            body = decodeBase64(payload.body.data);
          }

          return {
            id: message.id,
            threadId: response.data.threadId,
            date: new Date(parseInt(internalDate)).toISOString(),
            from: headers.from || "",
            to: headers.to || "",
            subject: headers.subject || "(No Subject)",
            snippet,
            body: body.substring(0, 2000),
          };
        })
      );

      return emails;
    } catch (error) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to fetch Gmail emails"
      );
    }
  }

  async sendEmail(recipientId, subject, message, attachments) {
    const messageParts = [
      `From: ${this.userEmail}`,
      `To: ${recipientId}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
    ];

    if (attachments && attachments.length > 0) {
      const boundary = `boundary_${Date.now().toString(16)}`;
      messageParts.push(`Content-Type: multipart/mixed; boundary=${boundary}`);
      messageParts.push("");
      messageParts.push(`--${boundary}`);
      messageParts.push("Content-Type: text/plain; charset=UTF-8");
      messageParts.push("Content-Transfer-Encoding: 7bit");
      messageParts.push("");
      messageParts.push(message);
      messageParts.push("");

      for (const file of attachments) {
        messageParts.push(`--${boundary}`);
        messageParts.push(
          `Content-Type: ${file.mimetype || "application/octet-stream"}`
        );
        messageParts.push("Content-Transfer-Encoding: base64");
        messageParts.push(
          `Content-Disposition: attachment; filename="${file.originalname}"`
        );
        messageParts.push("");
        const fileContent = Buffer.from(file.buffer).toString("base64");
        for (let i = 0; i < fileContent.length; i += 76) {
          messageParts.push(fileContent.substring(i, i + 76));
        }
        messageParts.push("");
      }
      messageParts.push(`--${boundary}--`);
    } else {
      messageParts.push("Content-Type: text/plain; charset=UTF-8");
      messageParts.push("");
      messageParts.push(message);
    }

    const email = messageParts.join("\r\n");
    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedEmail },
    });

    return { status: "success", messageId: response.data.id };
  }

  async readEmail(emailId) {
    try {
      // Validate emailId
      if (!emailId || typeof emailId !== "string" || emailId.trim() === "") {
        console.error("[DEBUG] Invalid emailId:", emailId);
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid email ID: Email ID must be a non-empty string"
        );
      }

      // Sanitize emailId (remove any whitespace)
      const sanitizedEmailId = emailId.trim();

      // Log the emailId for debugging
      console.log(
        "[DEBUG] Attempting to read email with ID:",
        sanitizedEmailId
      );

      // Check if the emailId matches the expected format for Gmail (hexadecimal string)
      const gmailIdRegex = /^[a-fA-F0-9]{16,}$/;
      if (!gmailIdRegex.test(sanitizedEmailId)) {
        console.error(
          "[DEBUG] Email ID does not match expected Gmail format:",
          sanitizedEmailId
        );
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid email ID: Must be a valid Gmail message ID (hexadecimal string)"
        );
      }

      const msg = await this.gmail.users.messages.get({
        userId: "me",
        id: sanitizedEmailId,
        format: "full",
      });

      let body = "";
      if (msg.data.payload?.parts) {
        for (const part of msg.data.payload.parts) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            body = Buffer.from(part.body.data, "base64").toString();
            break;
          }
        }
      } else if (msg.data.payload?.body?.data) {
        body = Buffer.from(msg.data.payload.body.data, "base64").toString();
      }

      const headers = msg.data.payload?.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "";
      const from = headers.find((h) => h.name === "From")?.value || "";
      const to = headers.find((h) => h.name === "To")?.value || "";
      const date = headers.find((h) => h.name === "Date")?.value || "";

      await this.markEmailAsRead(sanitizedEmailId);
      return { content: body, subject, from, to, date };
    } catch (error) {
      console.error("[DEBUG] Error in GmailService.readEmail:", error);
      if (error.message.includes("Invalid id value")) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid email ID: The provided email ID does not exist or is not accessible"
        );
      }
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to read Gmail email: ${error.message}`
      );
    }
  }

  async replyToEmail(emailId, message, attachments) {
    const original = await this.gmail.users.messages.get({
      userId: "me",
      id: emailId,
      format: "full",
    });
    const headers = original.data.payload?.headers || [];
    const subject = headers.find((h) => h.name === "Subject")?.value || "";
    const from = headers.find((h) => h.name === "From")?.value || "";
    const messageId = headers.find((h) => h.name === "Message-ID")?.value || "";

    const messageParts = [
      `From: ${this.userEmail}`,
      `To: ${from}`,
      `Subject: Re: ${subject.replace(/^Re: /i, "")}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      "MIME-Version: 1.0",
    ];

    if (attachments && attachments.length > 0) {
      const boundary = `boundary_${Date.now().toString(16)}`;
      messageParts.push(`Content-Type: multipart/mixed; boundary=${boundary}`);
      messageParts.push("");
      messageParts.push(`--${boundary}`);
      messageParts.push("Content-Type: text/plain; charset=UTF-8");
      messageParts.push("Content-Transfer-Encoding: 7bit");
      messageParts.push("");
      messageParts.push(message);
      messageParts.push("");

      for (const file of attachments) {
        messageParts.push(`--${boundary}`);
        messageParts.push(
          `Content-Type: ${file.mimetype || "application/octet-stream"}`
        );
        messageParts.push("Content-Transfer-Encoding: base64");
        messageParts.push(
          `Content-Disposition: attachment; filename="${file.originalname}"`
        );
        messageParts.push("");
        const fileContent = Buffer.from(file.buffer).toString("base64");
        for (let i = 0; i < fileContent.length; i += 76) {
          messageParts.push(fileContent.substring(i, i + 76));
        }
        messageParts.push("");
      }
      messageParts.push(`--${boundary}--`);
    } else {
      messageParts.push("Content-Type: text/plain; charset=UTF-8");
      messageParts.push("");
      messageParts.push(message);
    }

    const email = messageParts.join("\r\n");
    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedEmail, threadId: original.data.threadId },
    });

    return { status: "success", messageId: response.data.id };
  }

  async trashEmail(emailId) {
    await this.gmail.users.messages.trash({ userId: "me", id: emailId });
    return "Email moved to trash successfully.";
  }

  async markEmailAsRead(emailId) {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: emailId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
    return "Email marked as read.";
  }

  async searchEmails(query) {
    const response = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
    });
    return response.data.messages || [];
  }

  async summarizeEmail(emailId) {
    throw new Error("Method not implemented");
  }
}

class OutlookService extends EmailService {
  constructor(accessToken, userEmail, userId) {
    super();
    this.accessToken = accessToken;
    this.userEmail = userEmail;
    this.userId = userId;
  }

  async syncEmails() {
    try {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      const formattedDate = twoMonthsAgo.toISOString();

      const endpoint = `https://graph.microsoft.com/v1.0/me/messages?$filter=receivedDateTime ge ${formattedDate}&$top=100&$select=id,subject,bodyPreview,receivedDateTime,from,toRecipients,body`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new ApiError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          `Microsoft API error: ${errorData.error?.message || "Unknown error"}`
        );
      }

      const data = await response.json();
      if (!data.value || data.value.length === 0) {
        await User.findByIdAndUpdate(this.userId, {
          emailSyncStatus: "COMPLETED",
          lastSync: new Date(),
        });
        return [];
      }

      const emails = data.value.map((message) => {
        const sender = message.from?.emailAddress?.name
          ? `${message.from.emailAddress.name} <${message.from.emailAddress.address}>`
          : message.from?.emailAddress?.address || "Unknown sender";

        const recipients =
          message.toRecipients
            ?.map(
              (recipient) =>
                recipient.emailAddress?.address || "Unknown recipient"
            )
            .join(", ") || "Unknown recipient";

        const bodyContent = message.body?.content || message.bodyPreview || "";

        return {
          id: message.id,
          threadId: message.conversationId || message.id,
          date: message.receivedDateTime,
          from: sender,
          to: recipients,
          subject: message.subject || "(No Subject)",
          snippet: message.bodyPreview || "",
          body: bodyContent.substring(0, 2000),
        };
      });

      await User.findByIdAndUpdate(this.userId, {
        emailSyncStatus: "COMPLETED",
        lastSync: new Date(),
      });

      return emails;
    } catch (error) {
      console.error("Outlook sync error:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to sync Outlook emails"
      );
    }
  }

  async fetchEmails() {
    try {
      const user = await User.findById(this.userId);
      if (user.emailSyncStatus === "PENDING") {
        await this.syncEmails();
      }

      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      const formattedDate = twoMonthsAgo.toISOString();

      const endpoint = `https://graph.microsoft.com/v1.0/me/messages?$filter=receivedDateTime ge ${formattedDate}&$top=100&$select=id,subject,bodyPreview,receivedDateTime,from,toRecipients,body`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new ApiError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          `Microsoft API error: ${errorData.error?.message || "Unknown error"}`
        );
      }

      const data = await response.json();
      if (!data.value || data.value.length === 0) {
        return [];
      }

      const emails = data.value.map((message) => {
        const sender = message.from?.emailAddress?.name
          ? `${message.from.emailAddress.name} <${message.from.emailAddress.address}>`
          : message.from?.emailAddress?.address || "Unknown sender";

        const recipients =
          message.toRecipients
            ?.map(
              (recipient) =>
                recipient.emailAddress?.address || "Unknown recipient"
            )
            .join(", ") || "Unknown recipient";

        const bodyContent = message.body?.content || message.bodyPreview || "";

        return {
          id: message.id,
          threadId: message.conversationId || message.id,
          date: message.receivedDateTime,
          from: sender,
          to: recipients,
          subject: message.subject || "(No Subject)",
          snippet: message.bodyPreview || "",
          body: bodyContent.substring(0, 2000),
        };
      });

      return emails;
    } catch (error) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to fetch Outlook emails"
      );
    }
  }

  async sendEmail(recipientId, subject, message, attachments) {
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/sendMail",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "Text", content: message },
            toRecipients: [{ emailAddress: { address: recipientId } }],
            attachments: attachments?.map((file) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: file.originalname,
              contentType: file.mimetype,
              contentBytes: Buffer.from(file.buffer).toString("base64"),
            })),
          },
        }),
      }
    );

    if (!response.ok) throw new Error(await response.text());
    return { status: "success" };
  }

  async readEmail(emailId) {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${emailId}`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );
    const data = await response.json();
    await this.markEmailAsRead(emailId);
    return {
      content: data.body.content,
      subject: data.subject,
      from: data.from.emailAddress.address,
      to: data.toRecipients[0].emailAddress.address,
      date: data.receivedDateTime,
    };
  }

  async replyToEmail(emailId, message, attachments) {
    const original = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${emailId}`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );
    const originalData = await original.json();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${emailId}/createReply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    const replyDraft = await response.json();

    const sendResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${replyDraft.id}/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            body: { contentType: "Text", content: message },
            attachments: attachments?.map((file) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: file.originalname,
              contentType: file.mimetype,
              contentBytes: Buffer.from(file.buffer).toString("base64"),
            })),
          },
        }),
      }
    );

    if (!sendResponse.ok) throw new Error(await sendResponse.text());
    return { status: "success", messageId: replyDraft.id };
  }

  async trashEmail(emailId) {
    await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${emailId}/move`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ destinationId: "deleteditems" }),
      }
    );
    return "Email moved to trash successfully.";
  }

  async markEmailAsRead(emailId) {
    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${emailId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isRead: true }),
    });
    return "Email marked as read.";
  }

  async searchEmails(query) {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$search="${query}"`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );
    const data = await response.json();
    return data.value.map((msg) => ({
      id: msg.id,
      threadId: msg.conversationId,
    }));
  }

  async summarizeEmail(emailId) {
    throw new Error("Method not implemented");
  }
}

class YahooService extends EmailService {
  constructor(accessToken, refreshToken, userEmail, userId) {
    super();
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.userEmail = userEmail;
    this.userId = userId;
    this.transporter = nodemailer.createTransport({
      host: "smtp.mail.yahoo.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        user: this.userEmail,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        clientId: process.env.YAHOO_CLIENT_ID,
        clientSecret: process.env.YAHOO_CLIENT_SECRET,
      },
    });
  }

  async syncEmails() {
    try {
      const config = {
        imap: {
          user: this.userEmail,
          password: this.accessToken,
          host: "imap.mail.yahoo.com",
          port: 993,
          tls: true,
          authTimeout: 3000,
          tlsOptions: { rejectUnauthorized: false },
        },
      };

      const connection = await imap.connect(config);
      await connection.openBox("INBOX");
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      const searchCriteria = [
        ["SINCE", twoMonthsAgo.toISOString().split("T")[0]],
      ];
      const fetchOptions = { bodies: [""], struct: true };
      const messages = await connection.search(searchCriteria, fetchOptions);
      await connection.end();

      const emails = messages.map((msg) => {
        const body =
          msg.parts.find((part) => part.which === "")?.body.toString() || "";
        const headers = msg.parts.find((part) => part.which === "HEADER")?.body;
        return {
          id: msg.attributes.uid.toString(),
          threadId: msg.attributes["message-id"],
          date: headers?.date?.[0] || new Date().toISOString(),
          from: headers?.from?.[0] || "",
          to: headers?.to?.[0] || "",
          subject: headers?.subject?.[0] || "(No Subject)",
          snippet: body.substring(0, 100),
          body: body.substring(0, 2000),
        };
      });

      await User.findByIdAndUpdate(this.userId, {
        emailSyncStatus: "COMPLETED",
        lastSync: new Date(),
      });

      return emails;
    } catch (error) {
      console.error("Yahoo sync error:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to sync Yahoo emails"
      );
    }
  }

  async fetchEmails() {
    try {
      const user = await User.findById(this.userId);
      if (user.emailSyncStatus === "PENDING") {
        await this.syncEmails();
      }

      const config = {
        imap: {
          user: this.userEmail,
          password: this.accessToken,
          host: "imap.mail.yahoo.com",
          port: 993,
          tls: true,
          authTimeout: 3000,
          tlsOptions: { rejectUnauthorized: false },
        },
      };

      const connection = await imap.connect(config);
      await connection.openBox("INBOX");
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      const searchCriteria = [
        ["SINCE", twoMonthsAgo.toISOString().split("T")[0]],
      ];
      const fetchOptions = { bodies: [""], struct: true };
      const messages = await connection.search(searchCriteria, fetchOptions);
      await connection.end();

      const emails = messages.map((msg) => {
        const body =
          msg.parts.find((part) => part.which === "")?.body.toString() || "";
        const headers = msg.parts.find((part) => part.which === "HEADER")?.body;
        return {
          id: msg.attributes.uid.toString(),
          threadId: msg.attributes["message-id"],
          date: headers?.date?.[0] || new Date().toISOString(),
          from: headers?.from?.[0] || "",
          to: headers?.to?.[0] || "",
          subject: headers?.subject?.[0] || "(No Subject)",
          snippet: body.substring(0, 100),
          body: body.substring(0, 2000),
        };
      });

      return emails;
    } catch (error) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to fetch Yahoo emails"
      );
    }
  }

  async sendEmail(recipientId, subject, message, attachments) {
    const mailOptions = {
      from: this.userEmail,
      to: recipientId,
      subject,
      text: message,
      attachments: attachments?.map((file) => ({
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype,
      })),
    };

    const info = await this.transporter.sendMail(mailOptions);
    return { status: "success", messageId: info.messageId };
  }

  async readEmail(emailId) {
    const config = {
      imap: {
        user: this.userEmail,
        password: this.accessToken,
        host: "imap.mail.yahoo.com",
        port: 993,
        tls: true,
        authTimeout: 3000,
        tlsOptions: { rejectUnauthorized: false },
      },
    };

    const connection = await imap.connect(config);
    await connection.openBox("INBOX");
    const searchCriteria = [["UID", emailId]];
    const fetchOptions = { bodies: [""], struct: true };
    const messages = await connection.search(searchCriteria, fetchOptions);

    if (!messages.length) throw new Error("Email not found");

    const msg = messages[0];
    const body =
      msg.parts.find((part) => part.which === "")?.body.toString() || "";
    const headers = msg.parts.find((part) => part.which === "HEADER")?.body;
    const subject = headers?.subject?.[0] || "";
    const from = headers?.from?.[0] || "";
    const to = headers?.to?.[0] || "";
    const date = headers?.date?.[0] || "";

    await this.markEmailAsRead(emailId);
    await connection.end();

    return { content: body, subject, from, to, date };
  }

  async replyToEmail(emailId, message, attachments) {
    const config = {
      imap: {
        user: this.userEmail,
        password: this.accessToken,
        host: "imap.mail.yahoo.com",
        port: 993,
        tls: true,
        authTimeout: 3000,
        tlsOptions: { rejectUnauthorized: false },
      },
    };

    const connection = await imap.connect(config);
    await connection.openBox("INBOX");
    const searchCriteria = [["UID", emailId]];
    const fetchOptions = { bodies: ["HEADER"], struct: true };
    const messages = await connection.search(searchCriteria, fetchOptions);
    await connection.end();

    if (!messages.length) throw new Error("Email not found");

    const original = messages[0];
    const headers = original.parts.find(
      (part) => part.which === "HEADER"
    )?.body;
    const subject = headers?.subject?.[0] || "";
    const from = headers?.from?.[0] || "";

    const mailOptions = {
      from: this.userEmail,
      to: from,
      subject: `Re: ${subject.replace(/^Re: /i, "")}`,
      text: message,
      inReplyTo: headers?.["message-id"]?.[0],
      references: headers?.["message-id"]?.[0],
      attachments: attachments?.map((file) => ({
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype,
      })),
    };

    const info = await this.transporter.sendMail(mailOptions);
    return { status: "success", messageId: info.messageId };
  }

  async trashEmail(emailId) {
    const config = {
      imap: {
        user: this.userEmail,
        password: this.accessToken,
        host: "imap.mail.yahoo.com",
        port: 993,
        tls: true,
        authTimeout: 3000,
        tlsOptions: { rejectUnauthorized: false },
      },
    };

    const connection = await imap.connect(config);
    await connection.openBox("INBOX");
    await connection.moveMessage(emailId, "Trash");
    await connection.end();
    return "Email moved to trash successfully.";
  }

  async markEmailAsRead(emailId) {
    const config = {
      imap: {
        user: this.userEmail,
        password: this.accessToken,
        host: "imap.mail.yahoo.com",
        port: 993,
        tls: true,
        authTimeout: 3000,
        tlsOptions: { rejectUnauthorized: false },
      },
    };

    const connection = await imap.connect(config);
    await connection.openBox("INBOX");
    await connection.addFlags(emailId, "\\Seen");
    await connection.end();
    return "Email marked as read.";
  }

  async searchEmails(query) {
    const config = {
      imap: {
        user: this.userEmail,
        password: this.accessToken,
        host: "imap.mail.yahoo.com",
        port: 993,
        tls: true,
        authTimeout: 3000,
        tlsOptions: { rejectUnauthorized: false },
      },
    };

    const connection = await imap.connect(config);
    await connection.openBox("INBOX");
    const searchCriteria = [query];
    const fetchOptions = { bodies: ["HEADER"], struct: true };
    const messages = await connection.search(searchCriteria, fetchOptions);
    await connection.end();

    return messages.map((msg) => ({
      id: msg.attributes.uid.toString(),
      threadId: msg.attributes["message-id"],
    }));
  }

  async summarizeEmail(emailId) {
    throw new Error("Method not implemented");
  }
}

const createEmailService = async (req) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");

  const authProvider = user.authProvider;
  const userEmail = user.email;

  switch (authProvider) {
    case "google": {
      const auth = await getGoogleAuth(user);
      return new GmailService(auth, userEmail, user._id);
    }
    case "microsoft": {
      return new OutlookService(user.microsoftAccessToken, userEmail, user._id);
    }
    case "yahoo": {
      return new YahooService(
        user.yahooAccessToken,
        user.yahooRefreshToken,
        userEmail,
        user._id
      );
    }
    default:
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Unsupported auth provider: ${authProvider}`
      );
  }
};

export { createEmailService, EmailService };
