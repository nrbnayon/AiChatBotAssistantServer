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

  async fetchEmails({ query, maxResults = 5000, pageToken, filter = "all" }) {
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
      trash: `${client.baseUrl}/mailFolders/deleteditems/messages${baseParams}`,
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
// import fetch from "node-fetch";
// import fs from "fs";
// import { ApiError } from "../utils/errorHandler.js";
// import { StatusCodes } from "http-status-codes";
// import EmailService from "./emailService.js";
// import { convert } from "html-to-text";

// class OutlookService extends EmailService {
//   //   async getClient() {
//   //     const microsoftTokenExpiry = this.user.microsoftAccessTokenExpires || 0;
//   //     if (microsoftTokenExpiry < Date.now()) {
//   //       console.log("Refresh Token:", this.user.microsoftRefreshToken);
//   //       const response = await fetch(
//   //         "https://login.microsoftonline.com/common/oauth2/v2.0/token",
//   //         {
//   //           method: "POST",
//   //           headers: { "Content-Type": "application/x-www-form-urlencoded" },
//   //           body: new URLSearchParams({
//   //             client_id: process.env.MICROSOFT_CLIENT_ID,
//   //             client_secret: process.env.MICROSOFT_CLIENT_SECRET,
//   //             refresh_token: this.user.microsoftRefreshToken,
//   //             grant_type: "refresh_token",
//   //             scope:
//   //               "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send",
//   //           }),
//   //         }
//   //       );
//   //       if (!response.ok) {
//   //         const errorData = await response.json();
//   //         throw new ApiError(
//   //           StatusCodes.UNAUTHORIZED,
//   //           `Failed to refresh Microsoft token: ${
//   //             errorData.error_description || errorData.error
//   //           }`
//   //         );
//   //       }
//   //       const { access_token, refresh_token, expires_in } = await response.json();
//   //       this.user.microsoftAccessToken = access_token;
//   //       this.user.microsoftRefreshToken =
//   //         refresh_token || this.user.microsoftRefreshToken;
//   //       this.user.microsoftAccessTokenExpires = Date.now() + expires_in * 1000;
//   //       await this.user.save();
//   //       console.log("[DEBUG] Microsoft token refreshed");
//   //     }
//   //     return {
//   //       accessToken: this.user.microsoftAccessToken,
//   //       baseUrl: "https://graph.microsoft.com/v1.0/me",
//   //     };
//   //   }

//   async getClient() {
//     const microsoftTokenExpiry = this.user.microsoftAccessTokenExpires || 0;
//     const isValidJwt =
//       this.user.microsoftAccessToken &&
//       this.user.microsoftAccessToken.includes(".");

//     if (!isValidJwt || microsoftTokenExpiry < Date.now()) {
//       console.log("Refresh Token:", this.user.microsoftRefreshToken);
//       if (!this.user.microsoftRefreshToken) {
//         throw new ApiError(
//           StatusCodes.UNAUTHORIZED,
//           "No Microsoft refresh token available. Please re-authenticate."
//         );
//       }
//       const response = await fetch(
//         "https://login.microsoftonline.com/common/oauth2/v2.0/token",
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/x-www-form-urlencoded" },
//           body: new URLSearchParams({
//             client_id: process.env.MICROSOFT_CLIENT_ID,
//             client_secret: process.env.MICROSOFT_CLIENT_SECRET,
//             refresh_token: this.user.microsoftRefreshToken,
//             grant_type: "refresh_token",
//             scope:
//               "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send",
//           }),
//         }
//       );
//       if (!response.ok) {
//         const errorData = await response.json();
//         console.error("Microsoft token refresh error:", errorData);
//         throw new ApiError(
//           StatusCodes.UNAUTHORIZED,
//           `Failed to refresh Microsoft token: ${
//             errorData.error_description || errorData.error
//           }`
//         );
//       }
//       const { access_token, refresh_token, expires_in } = await response.json();
//       this.user.microsoftAccessToken = access_token;
//       this.user.microsoftRefreshToken =
//         refresh_token || this.user.microsoftRefreshToken;
//       this.user.microsoftAccessTokenExpires = Date.now() + expires_in * 1000;
//       await this.user.save();
//       console.log("[DEBUG] Microsoft token refreshed");
//     }
//     if (
//       !this.user.microsoftAccessToken ||
//       !this.user.microsoftAccessToken.includes(".")
//     ) {
//       throw new ApiError(
//         StatusCodes.UNAUTHORIZED,
//         "Invalid Microsoft access token format."
//       );
//     }
//     return {
//       accessToken: this.user.microsoftAccessToken,
//       baseUrl: "https://graph.microsoft.com/v1.0/me",
//     };
//   }

//   async fetchEmails({
//     query,
//     maxResults = 5000,
//     pageToken,
//     filters = ["all", "sent", "archived", "important"],
//   }) {
//     const client = await this.getClient();
//     let allEmails = [];
//     let nextPageToken = null;

//     for (const filter of filters) {
//       let endpoint;
//       const baseParams = `?$top=${maxResults}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead`;
//       let filterQuery = "";
//       switch (filter.toLowerCase()) {
//         case "all":
//           endpoint = `${client.baseUrl}/messages${baseParams}`; // Inbox
//           break;
//         case "sent":
//           endpoint = `${client.baseUrl}/mailFolders/sentitems/messages${baseParams}`;
//           break;
//         case "archived":
//           endpoint = `${client.baseUrl}/mailFolders/archive/messages${baseParams}`;
//           break;
//         case "unread":
//           filterQuery = "&$filter=isRead eq false";
//           endpoint = `${client.baseUrl}/messages${baseParams}${filterQuery}`;
//           break;
//         case "starred": // Flagged in Outlook
//           filterQuery = "&$filter=flag/flagStatus eq 'flagged'";
//           endpoint = `${client.baseUrl}/messages${baseParams}${filterQuery}`;
//           break;
//         case "drafts":
//           endpoint = `${client.baseUrl}/mailFolders/drafts/messages${baseParams}`;
//           break;
//         case "important":
//           filterQuery = "&$filter=importance eq 'high'";
//           endpoint = `${client.baseUrl}/messages${baseParams}${filterQuery}`;
//           break;
//         case "trash":
//           endpoint = `${client.baseUrl}/mailFolders/deleteditems/messages${baseParams}`;
//           break;
//         default:
//           throw new ApiError(
//             StatusCodes.BAD_REQUEST,
//             `Unsupported filter: ${filter}`
//           );
//       }
//       if (pageToken) endpoint += `&$skiptoken=${pageToken}`;
//       if (query) endpoint += `&$search="${encodeURIComponent(query)}"`;

//       const response = await fetch(endpoint, {
//         headers: { Authorization: `Bearer ${client.accessToken}` },
//       });
//       if (!response.ok) {
//         const errorData = await response.json();
//         throw new ApiError(
//           StatusCodes.BAD_REQUEST,
//           `Microsoft API error: ${errorData.error.message}`
//         );
//       }
//       const data = await response.json();
//       allEmails = allEmails.concat(data.value.map(this.formatEmail.bind(this)));
//       nextPageToken = data["@odata.nextLink"]
//         ? data["@odata.nextLink"].split("skiptoken=")[1]
//         : null;
//     }

//     return { messages: allEmails, nextPageToken };
//   }

//   formatEmail(email) {
//     const bodyContent = email.body?.content || "";
//     const bodyText =
//       email.body?.contentType === "html" ? convert(bodyContent) : bodyContent;
//     return {
//       id: email.id,
//       subject: email.subject || "",
//       from: email.from?.emailAddress?.address || "",
//       to:
//         email.toRecipients?.map((r) => r.emailAddress.address).join(", ") || "",
//       date: email.receivedDateTime || "",
//       snippet: email.bodyPreview || "",
//       body: bodyText,
//       isRead: email.isRead || false,
//     };
//   }

//   async sendEmail({ to, subject, body, attachments = [] }) {
//     const client = await this.getClient();
//     const message = {
//       subject,
//       body: { contentType: "Text", content: body },
//       toRecipients: [{ emailAddress: { address: to } }],
//     };
//     if (attachments.length > 0) {
//       message.attachments = attachments.map((file) => ({
//         "@odata.type": "#microsoft.graph.fileAttachment",
//         name: file.filename,
//         contentBytes: fs.readFileSync(file.path, { encoding: "base64" }),
//         contentType: file.mimetype,
//       }));
//     }
//     const sendMailBody = { message, saveToSentItems: "true" };
//     const response = await fetch(`${client.baseUrl}/sendMail`, {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${client.accessToken}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(sendMailBody),
//     });
//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new ApiError(
//         StatusCodes.BAD_REQUEST,
//         `Failed to send Microsoft email: ${errorData.error.message}`
//       );
//     }
//   }

//   async getEmail(emailId) {
//     const client = await this.getClient();
//     const response = await fetch(`${client.baseUrl}/messages/${emailId}`, {
//       headers: { Authorization: `Bearer ${client.accessToken}` },
//     });
//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new ApiError(
//         StatusCodes.BAD_REQUEST,
//         `Microsoft API error: ${errorData.error.message}`
//       );
//     }
//     return this.formatEmail(await response.json());
//   }

//   async replyToEmail(emailId, { body, attachments = [] }) {
//     const client = await this.getClient();
//     const email = await this.getEmail(emailId);
//     const replyTo = email.from === this.user.email ? email.to : email.from;
//     const message = {
//       subject: `Re: ${email.subject}`,
//       body: { contentType: "Text", content: body },
//       toRecipients: [{ emailAddress: { address: replyTo } }],
//     };
//     if (attachments.length > 0) {
//       message.attachments = attachments.map((file) => ({
//         "@odata.type": "#microsoft.graph.fileAttachment",
//         name: file.filename,
//         contentBytes: fs.readFileSync(file.path, { encoding: "base64" }),
//         contentType: file.mimetype,
//       }));
//     }
//     const sendMailBody = { message, saveToSentItems: "true" };
//     const response = await fetch(`${client.baseUrl}/sendMail`, {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${client.accessToken}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(sendMailBody),
//     });
//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new ApiError(
//         StatusCodes.BAD_REQUEST,
//         `Failed to reply to Microsoft email: ${errorData.error.message}`
//       );
//     }
//   }

//   async trashEmail(emailId) {
//     const client = await this.getClient();
//     const response = await fetch(`${client.baseUrl}/messages/${emailId}/move`, {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${client.accessToken}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({ destinationId: "deleteditems" }),
//     });
//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new ApiError(
//         StatusCodes.BAD_REQUEST,
//         `Failed to trash Microsoft email: ${errorData.error.message}`
//       );
//     }
//   }

//   async markAsRead(emailId, read = true) {
//     const client = await this.getClient();
//     const response = await fetch(`${client.baseUrl}/messages/${emailId}`, {
//       method: "PATCH",
//       headers: {
//         Authorization: `Bearer ${client.accessToken}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({ isRead: read }),
//     });
//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new ApiError(
//         StatusCodes.BAD_REQUEST,
//         `Failed to mark Microsoft email as read: ${errorData.error.message}`
//       );
//     }
//   }

//   async draftEmail({ to, subject, body, attachments = [] }) {
//     const client = await this.getClient();
//     const message = {
//       subject,
//       body: { contentType: "Text", content: body },
//       toRecipients: [{ emailAddress: { address: to } }],
//       isDraft: true,
//     };
//     const createResponse = await fetch(`${client.baseUrl}/messages`, {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${client.accessToken}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(message),
//     });
//     if (!createResponse.ok) {
//       const errorData = await createResponse.json();
//       throw new ApiError(
//         StatusCodes.BAD_REQUEST,
//         `Failed to create draft: ${errorData.error.message}`
//       );
//     }
//     const draft = await createResponse.json();
//     const draftId = draft.id;

//     if (attachments.length > 0) {
//       for (const attachment of attachments) {
//         const attachmentData = {
//           "@odata.type": "#microsoft.graph.fileAttachment",
//           name: attachment.filename,
//           contentBytes: fs.readFileSync(attachment.path, {
//             encoding: "base64",
//           }),
//           contentType: attachment.mimetype,
//         };
//         const attachResponse = await fetch(
//           `${client.baseUrl}/messages/${draftId}/attachments`,
//           {
//             method: "POST",
//             headers: {
//               Authorization: `Bearer ${client.accessToken}`,
//               "Content-Type": "application/json",
//             },
//             body: JSON.stringify(attachmentData),
//           }
//         );
//         if (!attachResponse.ok) {
//           const errorData = await attachResponse.json();
//           throw new ApiError(
//             StatusCodes.BAD_REQUEST,
//             `Failed to attach file: ${errorData.error.message}`
//           );
//         }
//       }
//     }
//     return draftId;
//   }
// }

// export default OutlookService;
