// services\outlookService.js
import fetch from "node-fetch";
import { promises as fsPromises } from "fs";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import EmailService from "./emailService.js";
import { convert } from "html-to-text";
import { decrypt, encrypt } from "../utils/encryptionUtils.js";

class OutlookService extends EmailService {
  constructor(user) {
    super(user);
    this.pageTokenCache = [];
  }

  async getClient(forceRefresh = false) {
    const encryptedRefreshToken = this.user.microsoftRefreshToken;
    if (!encryptedRefreshToken) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "No Microsoft refresh token available. Please re-authenticate."
      );
    }

    // const refreshToken = decrypt(encryptedRefreshToken);
    // const encryptedAccessToken = this.user.microsoftAccessToken;
    // let accessToken = encryptedAccessToken
    //   ? decrypt(encryptedAccessToken)
    //   : null;
    const refreshToken = encryptedRefreshToken;
    const encryptedAccessToken = this.user.microsoftAccessToken;
    let accessToken = encryptedAccessToken ? encryptedAccessToken : null;
    const microsoftTokenExpiry = this.user.microsoftAccessTokenExpires || 0;

    console.log(
      `[DEBUG] Token expiry: ${microsoftTokenExpiry}, Current time: ${Date.now()}`
    );

    // Refresh token if expired or forced
    if (forceRefresh || microsoftTokenExpiry < Date.now() || !accessToken) {
      try {
        const params = {
          client_id: process.env.MICROSOFT_CLIENT_ID,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
          scope: "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send",
        };
        console.log("[DEBUG] Refreshing Microsoft token...");

        const response = await fetch(
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(params),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch (e) {
            errorData = {
              error: "Unknown error",
              error_description: errorText,
            };
          }
          if (errorData.error === "invalid_grant") {
            throw new ApiError(
              StatusCodes.UNAUTHORIZED,
              "Refresh token is invalid. Please re-authenticate."
            );
          }
          console.error("[ERROR] Token refresh failed:", errorData);
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Failed to refresh Microsoft token: ${
              errorData.error_description || errorData.error
            }`
          );
        }

        const { access_token, refresh_token, expires_in } =
          await response.json();

        if (!access_token) {
          console.error("[ERROR] No access token received from Microsoft");
          throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            "Failed to obtain access token from Microsoft"
          );
        }

        accessToken = access_token;
        // const newEncryptedAccessToken = encrypt(access_token);
        // this.user.microsoftAccessToken = newEncryptedAccessToken;
        // if (refresh_token) {
        //   const newEncryptedRefreshToken = encrypt(refresh_token);
        //   this.user.microsoftRefreshToken = newEncryptedRefreshToken;
        // }
        const newEncryptedAccessToken = access_token;
        this.user.microsoftAccessToken = newEncryptedAccessToken;
        if (refresh_token) {
          const newEncryptedRefreshToken = refresh_token;
          this.user.microsoftRefreshToken = newEncryptedRefreshToken;
        }
        this.user.microsoftAccessTokenExpires = Date.now() + expires_in * 1000;
        await this.user.save();
        console.log("[DEBUG] Microsoft token refreshed successfully");
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          `Token refresh failed: ${error.message}`
        );
      }
    }

    // Basic validation: ensure access token exists
    if (!accessToken) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "No access token available. Please re-authenticate."
      );
    }

    return {
      accessToken,
      baseUrl: "https://graph.microsoft.com/v1.0/me",
    };
  }

  // services/outlookService.js
  // Revised fetchEmails method for OutlookService class
  async fetchEmails({
    query,
    maxResults = 1000,
    pageToken,
    filter = "all",
    timeFilter = "all",
  }) {
    try {
      let client = await this.getClient();
      let endpoint;
      const baseParams = `?$top=${maxResults}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead`;

      // Define filter conditions and handle query separately
      let hasSearchQuery = query && query.trim().length > 0;
      let hasFilterConditions = false;

      // Start with base endpoints without filters
      const baseEndpoints = {
        all: `${client.baseUrl}/messages`,
        sent: `${client.baseUrl}/mailFolders/sentitems/messages`,
        archived: `${client.baseUrl}/mailFolders/archive/messages`,
        unread: `${client.baseUrl}/messages`,
        starred: `${client.baseUrl}/messages`,
        drafts: `${client.baseUrl}/mailFolders/drafts/messages`,
        important: `${client.baseUrl}/messages`,
        promotions: `${client.baseUrl}/messages`,
      };

      endpoint = baseEndpoints[filter.toLowerCase()] || baseEndpoints.all;

      // Build filter conditions separately from search
      const filterConditions = [];

      // Add specific filter conditions based on selected filter
      if (filter.toLowerCase() === "unread") {
        filterConditions.push("isRead eq false");
        hasFilterConditions = true;
      } else if (filter.toLowerCase() === "starred") {
        filterConditions.push("flag/flagStatus eq 'flagged'");
        hasFilterConditions = true;
      } else if (filter.toLowerCase() === "important") {
        filterConditions.push("importance eq 'high'");
        hasFilterConditions = true;
      } else if (filter.toLowerCase() === "promotions") {
        filterConditions.push(
          "categories/any(c:c eq 'Promotions') or contains(from/emailAddress/address,'newsletter') " +
            "or contains(from/emailAddress/address,'noreply') or contains(from/emailAddress/address,'marketing') " +
            "or contains(subject,'newsletter') or contains(subject,'offer') or contains(subject,'deal') " +
            "or contains(subject,'sale') or contains(subject,'discount')"
        );
        hasFilterConditions = true;
      }

      // Add time filter conditions if applicable
      function getDateRange(timeFilter) {
        const now = new Date();
        if (timeFilter === "daily") {
          const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          return { after: start };
        } else if (timeFilter === "weekly") {
          const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return { after: start };
        } else if (timeFilter === "monthly") {
          const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          return { after: start };
        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(timeFilter)) {
          const [year, month, day] = timeFilter
            .split("/")
            .map((part) => parseInt(part, 10));
          const paddedMonth = month.toString().padStart(2, "0");
          const paddedDay = day.toString().padStart(2, "0");
          const startDate = new Date(Date.UTC(year, month - 1, day));
          const endDate = new Date(Date.UTC(year, month - 1, day + 1));
          return { after: startDate, before: endDate };
        } else if (timeFilter === "all") {
          return {};
        } else {
          return {};
        }
      }

      if (timeFilter && timeFilter !== "all") {
        const dateRange = getDateRange(timeFilter);
        if (dateRange.after) {
          const afterDate = dateRange.after.toISOString();
          filterConditions.push(`receivedDateTime ge ${afterDate}`);
          hasFilterConditions = true;
        }
        if (dateRange.before) {
          const beforeDate = dateRange.before.toISOString();
          filterConditions.push(`receivedDateTime lt ${beforeDate}`);
          hasFilterConditions = true;
        }
      }

      // Determine which approach to use based on query and filters
      endpoint += baseParams;

      if (hasSearchQuery && hasFilterConditions) {
        // If we have both search and filters, we need to use two separate requests
        // and merge results, or prioritize one over the other

        // Option 1: Prioritize search
        endpoint += `&$search="${encodeURIComponent(query)}"`;
        console.log(
          "[DEBUG] Prioritizing search query over filters due to API limitations"
        );

        // Option 2: Alternative approach - get IDs from search, then filter
        // This would be more complex but could be implemented if needed
      } else if (hasSearchQuery) {
        // Only search, no filters
        endpoint += `&$search="${encodeURIComponent(query)}"`;
      } else if (hasFilterConditions) {
        // Only filters, no search
        endpoint += `&$filter=${encodeURIComponent(
          filterConditions.join(" and ")
        )}`;
      }

      if (pageToken) endpoint += `&$skiptoken=${encodeURIComponent(pageToken)}`;

      let response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      });

      // Retry with forced refresh if 401 Unauthorized
      if (response.status === 401) {
        console.log("[DEBUG] Received 401, attempting token refresh...");
        client = await this.getClient(true); // Force refresh
        response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${client.accessToken}` },
        });
      }

      if (!response.ok) {
        const statusCode = response.status;
        const errorText = await response.text();
        let errorMessage;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || JSON.stringify(errorData);
        } catch (e) {
          errorMessage = errorText || "Unknown error";
        }
        throw new ApiError(statusCode, `Microsoft API error: ${errorMessage}`);
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

      const pageTokenCache = this.pageTokenCache;
      if (pageToken) {
        pageTokenCache.push(pageToken);
      }

      return {
        messages: emails,
        nextPageToken,
        prevPageToken:
          pageTokenCache.length > 1
            ? pageTokenCache[pageTokenCache.length - 2]
            : null,
        totalCount: data["@odata.count"] || 0,
      };
    } catch (error) {
      console.error("[ERROR] fetchEmails failed:", error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to fetch emails: ${error.message}`
      );
    }
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

  // Other methods remain unchanged...
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
