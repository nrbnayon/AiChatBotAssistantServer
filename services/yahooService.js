import fetch from "node-fetch";
import fs from "fs";
import FormData from "form-data";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import EmailService from "./emailService.js";
import { convert } from "html-to-text";

class YahooService extends EmailService {
  async getClient() {
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
      if (!response.ok) {
        const errorData = await response.json();
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          `Failed to refresh Yahoo token: ${
            errorData.error?.description || "Unknown error"
          }`
        );
      }
      const { access_token, refresh_token, expires_in } = await response.json();
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
  }

  async fetchEmails({ query, maxResults = 1000, pageToken, filter = "all" }) {
    const client = await this.getClient();
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

    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Yahoo API error: ${errorData.error?.description || "Unknown error"}`
      );
    }
    const data = await response.json();
    let messages = data.messages?.map(this.formatEmail.bind(this)) || [];
    if (filter === "read") messages = messages.filter((m) => m.isRead);
    if (filter === "unread") messages = messages.filter((m) => !m.isRead);

    return { messages, nextPageToken: data.nextPageToken || null };
  }

  formatEmail(email) {
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
    const client = await this.getClient();
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
    const response = await fetch(`${client.baseUrl}/v1/message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${client.accessToken}` },
      body: formData,
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to send Yahoo email: ${
          errorData.error?.description || "Unknown error"
        }`
      );
    }
  }

  async getEmail(emailId) {
    const client = await this.getClient();
    const response = await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Yahoo API error: ${errorData.error?.description || "Unknown error"}`
      );
    }
    return this.formatEmail(await response.json());
  }

  async replyToEmail(emailId, { body, attachments = [] }) {
    const client = await this.getClient();
    const email = await this.getEmail(emailId);
    const replyTo = email.from === this.user.email ? email.to : email.from;
    const formData = new FormData();
    formData.append("to", replyTo);
    formData.append("subject", `Re: ${email.subject}`);
    formData.append("body", body);
    attachments.forEach((file) => {
      formData.append(
        "attachments",
        fs.createReadStream(file.path),
        file.filename
      );
    });
    const response = await fetch(`${client.baseUrl}/v1/message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${client.accessToken}` },
      body: formData,
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to reply to Yahoo email: ${
          errorData.error?.description || "Unknown error"
        }`
      );
    }
  }

  async trashEmail(emailId) {
    const client = await this.getClient();
    const response = await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to trash Yahoo email: ${
          errorData.error?.description || "Unknown error"
        }`
      );
    }
  }

  async markAsRead(emailId, read = true) {
    const client = await this.getClient();
    const response = await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isRead: read }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to mark Yahoo email as read: ${
          errorData.error?.description || "Unknown error"
        }`
      );
    }
  }

  async draftEmail({ to, subject, body, attachments = [] }) {
    const client = await this.getClient();
    const formData = new FormData();
    formData.append("to", to);
    formData.append("subject", subject);
    formData.append("body", body);
    formData.append("isDraft", "true");
    attachments.forEach((file) => {
      formData.append(
        "attachments",
        fs.createReadStream(file.path),
        file.filename
      );
    });
    const response = await fetch(`${client.baseUrl}/v1/draft`, {
      method: "POST",
      headers: { Authorization: `Bearer ${client.accessToken}` },
      body: formData,
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to create Yahoo draft: ${
          errorData.error?.description || "Unknown error"
        }`
      );
    }
    const draft = await response.json();
    return draft.id;
  }
}

export default YahooService;
