import { google } from "googleapis";
import fetch from "node-fetch";
import { refreshGoogleToken } from "./googleRefreshToken.js";
import Groq from "groq-sdk";
import User from "../models/User.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class EmailService {
  constructor(user) {
    this.user = user;
    this.grok = groq;
  }

  async getEmailClient() {
    switch (this.user.authProvider) {
      case "google":
        const auth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        let { accessToken, refreshToken } = await refreshGoogleToken(this.user);
        auth.setCredentials({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        return google.gmail({ version: "v1", auth });
      case "microsoft":
        return {
          baseUrl: "https://graph.microsoft.com/v1.0/me",
          accessToken: this.user.microsoftAccessToken,
        };
      case "yahoo":
        return {
          baseUrl: "https://api.login.yahoo.com",
          accessToken: this.user.yahooAccessToken,
        };
      default:
        throw new Error("Unsupported email provider");
    }
  }

  async fetchEmails({
    query = "",
    maxResults = 100,
    pageToken,
    filter = "all",
  } = {}) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        const res = await client.users.messages.list({
          userId: "me",
          q: query,
          maxResults,
          pageToken,
          labelIds:
            filter === "starred"
              ? ["STARRED"]
              : filter === "all"
              ? []
              : [filter.toUpperCase()],
        });
        const messages = await Promise.all(
          (res.data.messages || []).map(async (msg) => {
            const email = await client.users.messages.get({
              userId: "me",
              id: msg.id,
            });
            return this.formatGoogleEmail(email.data);
          })
        );
        return { messages, nextPageToken: res.data.nextPageToken };
      case "microsoft":
        const url = `${client.baseUrl}/messages?$top=${maxResults}&$filter=${query}`;
        const response = await fetch(
          pageToken ? `${url}&$skiptoken=${pageToken}` : url,
          {
            headers: { Authorization: `Bearer ${client.accessToken}` },
          }
        );
        const data = await response.json();
        return {
          messages: data.value.map(this.formatMicrosoftEmail),
          nextPageToken: data["@odata.nextLink"]?.split("$skiptoken=")[1],
        };
      case "yahoo":
        const yahooUrl = `${client.baseUrl}/ws/v3/mailboxes?fields=messages`;
        const yahooRes = await fetch(yahooUrl, {
          headers: { Authorization: `Bearer ${client.accessToken}` },
        });
        const yahooData = await yahooRes.json();
        return {
          messages: yahooData.messages.map(this.formatYahooEmail),
          nextPageToken: yahooData.nextPageToken,
        };
      default:
        throw new Error("Unsupported provider");
    }
  }

  async getEmail(emailId) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        const email = await client.users.messages.get({
          userId: "me",
          id: emailId,
        });
        return this.formatGoogleEmail(email.data);
      case "microsoft":
        const response = await fetch(`${client.baseUrl}/messages/${emailId}`, {
          headers: { Authorization: `Bearer ${client.accessToken}` },
        });
        return this.formatMicrosoftEmail(await response.json());
      case "yahoo":
        const yahooRes = await fetch(
          `${client.baseUrl}/v1/message/${emailId}`,
          {
            headers: { Authorization: `Bearer ${client.accessToken}` },
          }
        );
        return this.formatYahooEmail(await yahooRes.json());
      default:
        throw new Error("Unsupported provider");
    }
  }

  async sendEmail({ to, subject, body, attachments = [], isHtml = false }) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        const raw = this.createGoogleRawEmail(
          to,
          subject,
          body,
          attachments,
          isHtml
        );
        await client.users.messages.send({
          userId: "me",
          requestBody: { raw },
        });
        return { success: true };
      case "microsoft":
        const microsoftEmail = this.createMicrosoftEmail(
          to,
          subject,
          body,
          attachments,
          isHtml
        );
        await fetch(`${client.baseUrl}/sendMail`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(microsoftEmail),
        });
        return { success: true };
      case "yahoo":
        const yahooEmail = this.createYahooEmail(
          to,
          subject,
          body,
          attachments,
          isHtml
        );
        await fetch(`${client.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(yahooEmail),
        });
        return { success: true };
      default:
        throw new Error("Unsupported provider");
    }
  }

  async replyToEmail(emailId, { body, attachments = [], isHtml = false }) {
    const client = await this.getEmailClient();
    const email = await this.getEmail(emailId);
    switch (this.user.authProvider) {
      case "google":
        const raw = this.createGoogleRawEmail(
          email.from,
          `Re: ${email.subject}`,
          body,
          attachments,
          isHtml,
          emailId
        );
        await client.users.messages.send({
          userId: "me",
          requestBody: { raw, threadId: email.threadId },
        });
        return { success: true };
      case "microsoft":
        const microsoftReply = this.createMicrosoftEmail(
          email.from,
          `Re: ${email.subject}`,
          body,
          attachments,
          isHtml
        );
        await fetch(`${client.baseUrl}/messages/${emailId}/createReply`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(microsoftReply),
        });
        return { success: true };
      case "yahoo":
        const yahooReply = this.createYahooEmail(
          email.from,
          `Re: ${email.subject}`,
          body,
          attachments,
          isHtml
        );
        await fetch(`${client.baseUrl}/v1/messages/${emailId}/reply`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(yahooReply),
        });
        return { success: true };
      default:
        throw new Error("Unsupported provider");
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
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ folder: "Trash" }),
        });
        break;
      default:
        throw new Error("Unsupported provider");
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
      default:
        throw new Error("Unsupported provider");
    }
  }

  async filterImportantEmails(
    emails,
    customKeywords = [],
    timeRange = "weekly"
  ) {
    const userKeywords = this.user.getAllImportantKeywords(); // Fetch from User model
    const keywords = [...new Set([...userKeywords, ...customKeywords])]; // Combine with custom keywords
    const timeFrames = {
      daily: 1 * 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
    };
    const timeLimit = timeFrames[timeRange] || timeFrames.weekly;
    const recentEmails = emails.filter((email) => {
      const emailDate = new Date(email.date);
      const cutoffDate = new Date(Date.now() - timeLimit);
      return emailDate >= cutoffDate;
    });

    const importantEmails = await Promise.all(
      recentEmails.map(async (email) => {
        const content =
          `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();
        const prompt = `
          Analyze the following email content and determine if it's important based on these keywords: ${keywords.join(
            ", "
          )}.
          Consider context, sender, and urgency. Return a JSON object with a score (0-100) and a boolean indicating importance.
          Email content: "${content}"
          Sender: "${email.from}"
        `;
        const response = await this.grok.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama3-70b-8192",
          temperature: 0.7,
        });
        const result = JSON.parse(
          response.choices[0]?.message?.content ||
            '{"score": 25, "isImportant": false}'
        );
        return {
          ...email,
          importanceScore: result.score,
          isImportant: result.isImportant,
        };
      })
    );

    return importantEmails
      .filter((email) => email.isImportant)
      .sort((a, b) => b.importanceScore - a.importanceScore);
  }

  // Utility methods for formatting emails
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
    };
  }

  formatMicrosoftEmail(email) {
    return {
      id: email.id,
      subject: email.subject,
      from: email.from.emailAddress.address,
      to: email.toRecipients.map((r) => r.emailAddress.address).join(", "),
      date: email.receivedDateTime,
      snippet: email.bodyPreview,
      body: email.body.content,
    };
  }

  formatYahooEmail(email) {
    return {
      id: email.id,
      subject: email.subject,
      from: email.from,
      to: email.to,
      date: email.receivedTime,
      snippet: email.snippet,
      body: email.messageBody,
    };
  }

  getGoogleEmailBody(payload) {
    if (payload.parts) {
      const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
      const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
      return Buffer.from((htmlPart || textPart).body.data, "base64").toString();
    }
    return Buffer.from(payload.body.data || "", "base64").toString();
  }

  createGoogleRawEmail(to, subject, body, attachments, isHtml, inReplyTo) {
    const boundary = "boundary_example";
    let email = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      `Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset=UTF-8`,
      "",
      body,
    ];
    attachments.forEach((att) => {
      email.push(
        `--${boundary}`,
        `Content-Type: ${att.mimetype}`,
        `Content-Disposition: attachment; filename="${att.originalname}"`,
        `Content-Transfer-Encoding: base64`,
        "",
        att.content.toString("base64")
      );
    });
    email.push(`--${boundary}--`);
    return Buffer.from(email.filter(Boolean).join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  createMicrosoftEmail(to, subject, body, attachments, isHtml) {
    return {
      message: {
        subject,
        body: { contentType: isHtml ? "HTML" : "Text", content: body },
        toRecipients: [{ emailAddress: { address: to } }],
        attachments: attachments.map((att) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: att.originalname,
          contentType: att.mimetype,
          contentBytes: att.content.toString("base64"),
        })),
      },
    };
  }

  createYahooEmail(to, subject, body, attachments, isHtml) {
    return {
      subject,
      body: { content: body, isHtml },
      to: to,
      attachments: attachments.map((att) => ({
        filename: att.originalname,
        contentType: att.mimetype,
        content: att.content.toString("base64"),
      })),
    };
  }
}

export const createEmailService = async (req) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new Error("User not found");
  return new EmailService(user);
};
