// services\outlookService.js
import fetch from "node-fetch";
import { promises as fsPromises } from "fs";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import EmailService from "./emailService.js";
import { convert } from "html-to-text";
import { decrypt, encrypt } from "../utils/encryptionUtils.js";

class OutlookService extends EmailService {
  async getClient() {
    // Retrieve encrypted refresh token from user model
    const encryptedRefreshToken = this.user.microsoftRefreshToken;
    if (!encryptedRefreshToken) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "No Microsoft refresh token available. Please re-authenticate."
      );
    }

    // Decrypt the refresh token for use
    const refreshToken = decrypt(encryptedRefreshToken);

    // Retrieve encrypted access token from user model
    const encryptedAccessToken = this.user.microsoftAccessToken;
    let accessToken = encryptedAccessToken
      ? decrypt(encryptedAccessToken)
      : null;

    const microsoftTokenExpiry = this.user.microsoftAccessTokenExpires || 0;
    // Check if access token is expired or missing
    if (microsoftTokenExpiry < Date.now() || !accessToken) {
      try {
        const response = await fetch(
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.MICROSOFT_CLIENT_ID,
              client_secret: process.env.MICROSOFT_CLIENT_SECRET,
              refresh_token: refreshToken,
              grant_type: "refresh_token",
              scope:
                "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send",
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage;
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error_description || errorData.error;
          } catch (e) {
            errorMessage = errorText || "Unknown error";
          }
          console.error("Microsoft token refresh error:", errorMessage);
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            `Failed to refresh Microsoft token: ${errorMessage}`
          );
        }

        const { access_token, refresh_token, expires_in } =
          await response.json();
        accessToken = access_token; // Assign new plain access token
        const newEncryptedAccessToken = encrypt(access_token); // Encrypt new access token
        this.user.microsoftAccessToken = newEncryptedAccessToken; // Save encrypted access token
        if (refresh_token) {
          const newEncryptedRefreshToken = encrypt(refresh_token); // Encrypt new refresh token if provided
          this.user.microsoftRefreshToken = newEncryptedRefreshToken;
        } // If no new refresh token, retain the existing one
        this.user.microsoftAccessTokenExpires = Date.now() + expires_in * 1000;
        await this.user.save();
        console.log("[DEBUG] Microsoft token refreshed");
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          `Token refresh failed: ${error.message}`
        );
      }
    }

    // Return the decrypted access token for API calls
    return {
      accessToken, // Plain text token for immediate use
      baseUrl: "https://graph.microsoft.com/v1.0/me",
    };
  }

  async fetchEmails({ query, maxResults = 1000, pageToken, filter = "all" }) {
    const client = await this.getClient();
    let endpoint;
    const baseParams = `?$top=${maxResults}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead`;

    const filterMap = {
      all: `${client.baseUrl}/messages${baseParams}`,
      sent: `${client.baseUrl}/mailFolders/sentitems/messages${baseParams}`,
      archived: `${client.baseUrl}/mailFolders/archive/messages${baseParams}`,
      unread: `${client.baseUrl}/messages${baseParams}&$filter=isRead eq false`,
      starred: `${client.baseUrl}/messages${baseParams}&$filter=flag/flagStatus eq 'flagged'`,
      drafts: `${client.baseUrl}/mailFolders/drafts/messages${baseParams}`,
      important: `${client.baseUrl}/messages${baseParams}&$filter=importance eq 'high'`,
      // trash: `${client.baseUrl}/mailFolders/deleteditems/messages${baseParams}`,
    };

    endpoint = filterMap[filter.toLowerCase()];

    if (!endpoint) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Unsupported filter: ${filter}`
      );
    }

    if (pageToken) endpoint += `&$skiptoken=${encodeURIComponent(pageToken)}`;
    if (query) endpoint += `&$search="${encodeURIComponent(query)}"`;

    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || JSON.stringify(errorData);
      } catch (e) {
        errorMessage = errorText || "Unknown error";
      }
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Microsoft API error: ${errorMessage}`
      );
    }

    const data = await response.json();
    const emails = data.value.map(this.formatEmail.bind(this));

    let nextPageToken = null;
    if (data["@odata.nextLink"]) {
      const linkParts = data["@odata.nextLink"].split("skiptoken=");
      if (linkParts.length > 1) {
        nextPageToken = decodeURIComponent(linkParts[1]);
      }
    }

    return { messages: emails, nextPageToken };
  }

  formatEmail(email) {
    const bodyContent = email.body?.content || "";
    const bodyText =
      email.body?.contentType === "html" ? convert(bodyContent) : bodyContent;
    return {
      id: email.id || "",
      subject: email.subject || "",
      from: email.from?.emailAddress?.address || "",
      to:
        email.toRecipients
          ?.map((r) => r.emailAddress?.address || "")
          .filter(Boolean)
          .join(", ") || "",
      date: email.receivedDateTime || "",
      snippet: email.bodyPreview || "",
      body: bodyText,
      isRead: email.isRead || false,
      hasAttachments: email.hasAttachments || false,
    };
  }

  async getAttachments(emailId) {
    const client = await this.getClient();
    const response = await fetch(
      `${client.baseUrl}/messages/${emailId}/attachments`,
      {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      }
    );
    if (!response.ok) throw new Error("Failed to fetch attachments");
    const data = await response.json();
    return data.value.map((att) => ({
      id: att.id,
      filename: att.name,
      mimeType: att.contentType,
      size: att.size,
    }));
  }

  async getAttachment(emailId, attachmentId) {
    const client = await this.getClient();
    const response = await fetch(
      `${client.baseUrl}/messages/${emailId}/attachments/${attachmentId}`,
      {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      }
    );
    if (!response.ok) throw new Error("Failed to fetch attachment");
    const attachment = await response.json();
    return {
      filename: attachment.name || "unnamed",
      mimeType: attachment.contentType || "application/octet-stream",
      content: Buffer.from(attachment.contentBytes, "base64"),
    };
  }

  async sendEmail({ to, subject, body, attachments = [] }) {
    const client = await this.getClient();
    const message = {
      subject,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    };

    if (attachments.length > 0) {
      message.attachments = await Promise.all(
        attachments.map(async (file) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: file.filename,
          contentBytes: (
            await fsPromises.readFile(file.path)
          ).toString("base64"),
          contentType: file.mimetype,
        }))
      );
    }

    const sendMailBody = { message, saveToSentItems: "true" };
    const response = await fetch(`${client.baseUrl}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sendMailBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || JSON.stringify(errorData);
      } catch (e) {
        errorMessage = errorText || "Unknown error";
      }
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to send Microsoft email: ${errorMessage}`
      );
    }
  }

  async getEmail(emailId) {
    const client = await this.getClient();
    const response = await fetch(`${client.baseUrl}/messages/${emailId}`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || JSON.stringify(errorData);
      } catch (e) {
        errorMessage = errorText || "Unknown error";
      }
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Microsoft API error: ${errorMessage}`
      );
    }

    return this.formatEmail(await response.json());
  }

  async replyToEmail(emailId, { body, attachments = [] }) {
    const client = await this.getClient();
    const email = await this.getEmail(emailId);
    const replyTo = email.from === this.user.email ? email.to : email.from;
    const message = {
      subject: `Re: ${email.subject}`,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: replyTo } }],
    };

    if (attachments.length > 0) {
      message.attachments = await Promise.all(
        attachments.map(async (file) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: file.filename,
          contentBytes: (
            await fsPromises.readFile(file.path)
          ).toString("base64"),
          contentType: file.mimetype,
        }))
      );
    }

    const sendMailBody = { message, saveToSentItems: "true" };
    const response = await fetch(`${client.baseUrl}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sendMailBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || JSON.stringify(errorData);
      } catch (e) {
        errorMessage = errorText || "Unknown error";
      }
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to reply to Microsoft email: ${errorMessage}`
      );
    }
  }

  async trashEmail(emailId) {
    const client = await this.getClient();
    const response = await fetch(`${client.baseUrl}/messages/${emailId}/move`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ destinationId: "deleteditems" }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || JSON.stringify(errorData);
      } catch (e) {
        errorMessage = errorText || "Unknown error";
      }
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to trash Microsoft email: ${errorMessage}`
      );
    }
  }

  async markAsRead(emailId, read = true) {
    const client = await this.getClient();
    const response = await fetch(`${client.baseUrl}/messages/${emailId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isRead: read }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || JSON.stringify(errorData);
      } catch (e) {
        errorMessage = errorText || "Unknown error";
      }
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to mark Microsoft email as read: ${errorMessage}`
      );
    }
  }

  async getInboxStats() {
    const client = await this.getClient();
    try {
      const unreadResponse = await fetch(
        `${client.baseUrl}/messages?$filter=isRead eq false&$count=true`,
        { headers: { Authorization: `Bearer ${client.accessToken}` } }
      );
      const unreadData = await unreadResponse.json();
      const unreadCount = unreadData["@odata.count"] || 0;

      const totalResponse = await fetch(
        `${client.baseUrl}/messages?$count=true`,
        { headers: { Authorization: `Bearer ${client.accessToken}` } }
      );
      const totalData = await totalResponse.json();
      const totalCount = totalData["@odata.count"] || 0;

      return {
        totalEmails: totalCount,
        unreadEmails: unreadCount,
      };
    } catch (error) {
      console.error("[ERROR] Failed to get Outlook inbox stats:", error);
      return { totalEmails: 0, unreadEmails: 0 };
    }
  }

  async getEmailCount({ filter = "all", query = "" }) {
    const client = await this.getClient();
    let url = `${client.baseUrl}/messages?$count=true`;
    if (filter === "unread") url += `&$filter=isRead eq false`;
    if (query) url += `&$search="${encodeURIComponent(query)}"`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      });
      const data = await response.json();
      return data["@odata.count"] || 0;
    } catch (error) {
      console.error("[ERROR] Failed to count Outlook emails:", error);
      return 0;
    }
  }

  async draftEmail({ to, subject, body, attachments = [] }) {
    const client = await this.getClient();
    const message = {
      subject,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
      isDraft: true,
    };

    const createResponse = await fetch(`${client.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      let errorMessage;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || JSON.stringify(errorData);
      } catch (e) {
        errorMessage = errorText || "Unknown error";
      }
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Failed to create draft: ${errorMessage}`
      );
    }

    const draft = await createResponse.json();
    const draftId = draft.id;

    if (attachments.length > 0) {
      for (const attachment of attachments) {
        const fileBuffer = await fsPromises.readFile(attachment.path);
        const attachmentData = {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.filename,
          contentBytes: fileBuffer.toString("base64"),
          contentType: attachment.mimetype,
        };

        const attachResponse = await fetch(
          `${client.baseUrl}/messages/${draftId}/attachments`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${client.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(attachmentData),
          }
        );

        if (!attachResponse.ok) {
          const errorText = await attachResponse.text();
          let errorMessage;
          try {
            const errorData = JSON.parse(errorText);
            errorMessage =
              errorData.error?.message || JSON.stringify(errorData);
          } catch (e) {
            errorMessage = errorText || "Unknown error";
          }
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Failed to attach file: ${errorMessage}`
          );
        }
      }
    }
    return draftId;
  }
}

export default OutlookService;
