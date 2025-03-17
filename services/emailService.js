import { google } from "googleapis";
import fetch from "node-fetch";
import Groq from "groq-sdk";
import User from "../models/User.js";

class EmailService {
  constructor(user) {
    this.user = user;
    this.grok = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async getEmailClient() {
    switch (this.user.authProvider) {
      case "google":
        return await this.getGmailClient();
      case "microsoft":
        return await this.getMicrosoftClient();
      case "yahoo":
        return await this.getYahooClient();
      default:
        throw new Error("Unsupported email provider");
    }
  }

  async getGmailClient() {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: this.user.googleAccessToken,
      refresh_token: this.user.googleRefreshToken,
    });

    const tokenExpiry = this.user.googleAccessTokenExpires || 0;
    if (tokenExpiry < Date.now()) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      this.user.googleAccessToken = credentials.access_token;
      this.user.googleRefreshToken =
        credentials.refresh_token || this.user.googleRefreshToken;
      this.user.googleAccessTokenExpires = credentials.expiry_date;
      await this.user.save();
    }
    return google.gmail({ version: "v1", auth: oauth2Client });
  }

  async getMicrosoftClient() {
    const tokenExpiry = this.user.microsoftAccessTokenExpires || 0;
    if (tokenExpiry < Date.now()) {
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
      if (!response.ok) throw new Error("Failed to refresh Microsoft token");
      const { access_token, refresh_token, expires_in } = await response.json();
      this.user.microsoftAccessToken = access_token;
      this.user.microsoftRefreshToken =
        refresh_token || this.user.microsoftRefreshToken;
      this.user.microsoftAccessTokenExpires = Date.now() + expires_in * 1000;
      await this.user.save();
    }
    return {
      accessToken: this.user.microsoftAccessToken,
      baseUrl: "https://graph.microsoft.com/v1.0/me",
    };
  }

  async getYahooClient() {
    const tokenExpiry = this.user.yahooAccessTokenExpires || 0;
    if (tokenExpiry < Date.now()) {
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
      if (!response.ok) throw new Error("Failed to refresh Yahoo token");
      const { access_token, refresh_token, expires_in } = await response.json();
      this.user.yahooAccessToken = access_token;
      this.user.yahooRefreshToken =
        refresh_token || this.user.yahooRefreshToken;
      this.user.yahooAccessTokenExpires = Date.now() + expires_in * 1000;
      await this.user.save();
    }
    return {
      accessToken: this.user.yahooAccessToken,
      baseUrl: "https://api.mail.yahoo.com",
    };
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
        throw new Error("Unsupported provider for fetching emails");
    }
  }

  async fetchGmailEmails(client, { query, maxResults, pageToken, filter }) {
    const params = { userId: "me", maxResults, q: query, pageToken };
    switch (filter) {
      case "read":
        params.q += " -unread";
        break;
      case "unread":
        params.labelIds = ["UNREAD"];
        break;
      case "archived":
        params.q += " -in:inbox";
        break;
    }
    const response = await client.users.messages.list(params);
    if (!response.data.messages) return { messages: [], nextPageToken: null };

    const emails = await Promise.all(
      response.data.messages.map(async (msg) => {
        const email = await client.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });
        return this.formatGmailEmail(email.data);
      })
    );
    return { messages: emails, nextPageToken: response.data.nextPageToken };
  }

  async fetchMicrosoftEmails(client, { query, maxResults, pageToken, filter }) {
    let endpoint = `${client.baseUrl}/messages?$top=${maxResults}&$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,bodyPreview,body,isRead,parentFolderId,hasAttachments`;
    if (pageToken) endpoint += `&$skiptoken=${pageToken}`;
    if (query) endpoint += `&$search="${query}"`;
    switch (filter) {
      case "read":
        endpoint += "&$filter=isRead eq true";
        break;
      case "unread":
        endpoint += "&$filter=isRead eq false";
        break;
      case "archived":
        const archiveFolderId = await this.getMicrosoftArchiveFolderId(client);
        endpoint += `&$filter=parentFolderId eq '${archiveFolderId}'`;
        break;
    }
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    if (!response.ok) throw new Error("Failed to fetch Microsoft emails");
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
    if (query) endpoint += `&query=${encodeURIComponent(query)}`;
    if (pageToken) endpoint += `&start=${pageToken}`;
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    if (!response.ok) throw new Error("Failed to fetch Yahoo emails");
    const data = await response.json();
    let messages = data.messages?.map(this.formatYahooEmail) || [];
    if (filter === "read") messages = messages.filter((m) => m.isRead);
    if (filter === "unread") messages = messages.filter((m) => !m.isRead);
    if (filter === "archived")
      messages = messages.filter((m) => m.folder === "Archive");
    return { messages, nextPageToken: data.nextPageToken || null };
  }

  async getMicrosoftArchiveFolderId(client) {
    const response = await fetch(`${client.baseUrl}/mailFolders/archive`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    if (!response.ok) throw new Error("Failed to get archive folder");
    const folder = await response.json();
    return folder.id;
  }

  async getEmail(id) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        const gmailEmail = await client.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        return this.formatGmailEmail(gmailEmail.data);
      case "microsoft":
        const msResponse = await fetch(`${client.baseUrl}/messages/${id}`, {
          headers: { Authorization: `Bearer ${client.accessToken}` },
        });
        if (!msResponse.ok) throw new Error("Failed to fetch Microsoft email");
        return this.formatMicrosoftEmail(await msResponse.json());
      case "yahoo":
        const yahooResponse = await fetch(
          `${client.baseUrl}/v1/message/${id}`,
          {
            headers: { Authorization: `Bearer ${client.accessToken}` },
          }
        );
        if (!yahooResponse.ok) throw new Error("Failed to fetch Yahoo email");
        return this.formatYahooEmail(await yahooResponse.json());
      default:
        throw new Error("Unsupported provider for fetching single email");
    }
  }

  async getThread(id) {
    const client = await this.getEmailClient();
    if (this.user.authProvider === "google") {
      const thread = await client.users.threads.get({
        userId: "me",
        id,
        format: "full",
      });
      return {
        id: thread.data.id,
        messages: thread.data.messages.map(this.formatGmailEmail),
      };
    }
    throw new Error("Thread fetching only supported for Gmail");
  }

  formatGmailEmail(email) {
    const headers = email.payload?.headers || [];
    return {
      id: email.id,
      threadId: email.threadId,
      subject: headers.find((h) => h.name === "Subject")?.value || "",
      from: headers.find((h) => h.name === "From")?.value || "",
      to: headers.find((h) => h.name === "To")?.value || "",
      cc: headers.find((h) => h.name === "Cc")?.value || "",
      bcc: headers.find((h) => h.name === "Bcc")?.value || "",
      date: email.internalDate
        ? new Date(parseInt(email.internalDate)).toISOString()
        : "",
      snippet: email.snippet,
      body: this.getGmailBody(email.payload),
      isRead: !email.labelIds?.includes("UNREAD"),
      isArchived: !email.labelIds?.includes("INBOX"),
      labels: email.labelIds || [],
      attachments: this.getGmailAttachments(email.payload),
    };
  }

  formatMicrosoftEmail(email) {
    return {
      id: email.id,
      threadId: email.conversationId,
      subject: email.subject || "",
      from: email.from?.emailAddress?.address || "",
      to:
        email.toRecipients?.map((r) => r.emailAddress.address).join(", ") || "",
      cc:
        email.ccRecipients?.map((r) => r.emailAddress.address).join(", ") || "",
      bcc:
        email.bccRecipients?.map((r) => r.emailAddress.address).join(", ") ||
        "",
      date: email.receivedDateTime || "",
      snippet: email.bodyPreview || "",
      body: email.body?.content || "",
      isRead: email.isRead || false,
      isArchived: false, // Determined dynamically in fetchMicrosoftEmails
      labels: [],
      attachments: email.hasAttachments ? email.attachments || [] : [],
    };
  }

  formatYahooEmail(email) {
    return {
      id: email.id,
      threadId: email.threadId,
      subject: email.subject || "",
      from: email.from?.email || "",
      to: email.to?.map((t) => t.email).join(", ") || "",
      cc: email.cc?.map((c) => c.email).join(", ") || "",
      bcc: email.bcc?.map((b) => b.email).join(", ") || "",
      date: email.receivedDate || "",
      snippet: email.snippet || "",
      body: email.body || "",
      isRead: email.isRead || false,
      isArchived: email.folder === "Archive",
      labels: [],
      attachments: email.attachments || [],
    };
  }

  getGmailBody(payload) {
    if (!payload) return "";
    if (payload.body?.data)
      return Buffer.from(payload.body.data, "base64").toString("utf8");
    const htmlPart = payload.parts?.find((p) => p.mimeType === "text/html");
    const textPart = payload.parts?.find((p) => p.mimeType === "text/plain");
    return htmlPart?.body?.data
      ? Buffer.from(htmlPart.body.data, "base64").toString("utf8")
      : textPart?.body?.data
      ? Buffer.from(textPart.body.data, "base64").toString("utf8")
      : "";
  }

  getGmailAttachments(payload) {
    if (!payload?.parts) return [];
    return payload.parts
      .filter((part) => part.filename && part.body?.attachmentId)
      .map((part) => ({
        id: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size,
      }));
  }

  async sendEmail({ to, cc, bcc, subject, body, attachments, isHtml }) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        return await this.sendGmailEmail(client, {
          to,
          cc,
          bcc,
          subject,
          body,
          attachments,
          isHtml,
        });
      case "microsoft":
        return await this.sendMicrosoftEmail(client, {
          to,
          cc,
          bcc,
          subject,
          body,
          attachments,
          isHtml,
        });
      case "yahoo":
        return await this.sendYahooEmail(client, {
          to,
          cc,
          bcc,
          subject,
          body,
          attachments,
          isHtml,
        });
      default:
        throw new Error("Unsupported provider for sending email");
    }
  }

  async sendGmailEmail(
    client,
    { to, cc, bcc, subject, body, attachments, isHtml }
  ) {
    const boundary = `boundary_${Date.now()}`;
    const messageParts = [
      `From: ${this.user.email}`,
      `To: ${to}`,
      cc ? `Cc: ${cc}` : "",
      bcc ? `Bcc: ${bcc}` : "",
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary=${boundary}`,
      "",
      `--${boundary}`,
      isHtml
        ? "Content-Type: text/html; charset=UTF-8"
        : "Content-Type: text/plain; charset=UTF-8",
      "",
      body,
    ];

    if (attachments) {
      attachments.forEach((att) => {
        messageParts.push(
          `--${boundary}`,
          `Content-Type: ${att.mimetype}`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${att.originalname}"`,
          "",
          att.content.toString("base64")
        );
      });
    }
    messageParts.push(`--${boundary}--`);

    const raw = Buffer.from(messageParts.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const response = await client.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return response.data;
  }

  async sendMicrosoftEmail(
    client,
    { to, cc, bcc, subject, body, attachments, isHtml }
  ) {
    const email = {
      message: {
        subject,
        body: { contentType: isHtml ? "HTML" : "Text", content: body },
        toRecipients: to
          .split(",")
          .map((email) => ({ emailAddress: { address: email.trim() } })),
        ccRecipients: cc
          ? cc
              .split(",")
              .map((email) => ({ emailAddress: { address: email.trim() } }))
          : [],
        bccRecipients: bcc
          ? bcc
              .split(",")
              .map((email) => ({ emailAddress: { address: email.trim() } }))
          : [],
        attachments:
          attachments?.map((att) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: att.originalname,
            contentType: att.mimetype,
            contentBytes: att.content.toString("base64"),
          })) || [],
      },
    };
    const response = await fetch(`${client.baseUrl}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(email),
    });
    if (!response.ok) throw new Error("Failed to send Microsoft email");
    return { status: "success" };
  }

  async sendYahooEmail(
    client,
    { to, cc, bcc, subject, body, attachments, isHtml }
  ) {
    const email = {
      subject,
      body: isHtml ? { html: body } : { text: body },
      to: to.split(",").map((email) => ({ email: email.trim() })),
      cc: cc ? cc.split(",").map((email) => ({ email: email.trim() })) : [],
      bcc: bcc ? bcc.split(",").map((email) => ({ email: email.trim() })) : [],
      attachments:
        attachments?.map((att) => ({
          name: att.originalname,
          contentType: att.mimetype,
          data: att.content.toString("base64"),
        })) || [],
    };
    const response = await fetch(`${client.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(email),
    });
    if (!response.ok) throw new Error("Failed to send Yahoo email");
    return await response.json();
  }

  async replyToEmail(id, { body, attachments, isHtml }) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        const originalGmail = await client.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        const gmailHeaders = originalGmail.data.payload.headers;
        const gmailSubject =
          gmailHeaders.find((h) => h.name === "Subject")?.value || "";
        const gmailFrom =
          gmailHeaders.find((h) => h.name === "From")?.value || "";
        const gmailMessageId =
          gmailHeaders.find((h) => h.name === "Message-ID")?.value || "";
        const gmailBoundary = `boundary_${Date.now()}`;
        const gmailParts = [
          `From: ${this.user.email}`,
          `To: ${gmailFrom}`,
          `Subject: Re: ${gmailSubject.replace(/^Re: /i, "")}`,
          `In-Reply-To: ${gmailMessageId}`,
          `References: ${gmailMessageId}`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/mixed; boundary=${gmailBoundary}`,
          "",
          `--${gmailBoundary}`,
          isHtml
            ? "Content-Type: text/html; charset=UTF-8"
            : "Content-Type: text/plain; charset=UTF-8",
          "",
          body,
        ];
        if (attachments) {
          attachments.forEach((att) => {
            gmailParts.push(
              `--${gmailBoundary}`,
              `Content-Type: ${att.mimetype}`,
              "Content-Transfer-Encoding: base64",
              `Content-Disposition: attachment; filename="${att.originalname}"`,
              "",
              att.content.toString("base64")
            );
          });
        }
        gmailParts.push(`--${gmailBoundary}--`);
        const gmailRaw = Buffer.from(gmailParts.join("\r\n"))
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
        const gmailResponse = await client.users.messages.send({
          userId: "me",
          requestBody: { raw, threadId: originalGmail.data.threadId },
        });
        return gmailResponse.data;
      case "microsoft":
        const msOriginal = await this.getEmail(id);
        const msEmail = {
          message: {
            subject: `Re: ${msOriginal.subject}`,
            body: { contentType: isHtml ? "HTML" : "Text", content: body },
            toRecipients: [{ emailAddress: { address: msOriginal.from } }],
            inReplyTo: msOriginal.id,
            attachments:
              attachments?.map((att) => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: att.originalname,
                contentType: att.mimetype,
                contentBytes: att.content.toString("base64"),
              })) || [],
          },
        };
        const msResponse = await fetch(`${client.baseUrl}/sendMail`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(msEmail),
        });
        if (!msResponse.ok)
          throw new Error("Failed to reply to Microsoft email");
        return { status: "success" };
      case "yahoo":
        const yahooOriginal = await this.getEmail(id);
        const yahooEmail = {
          subject: `Re: ${yahooOriginal.subject}`,
          body: isHtml ? { html: body } : { text: body },
          to: [{ email: yahooOriginal.from }],
          inReplyTo: yahooOriginal.id,
          attachments:
            attachments?.map((att) => ({
              name: att.originalname,
              contentType: att.mimetype,
              data: att.content.toString("base64"),
            })) || [],
        };
        const yahooResponse = await fetch(`${client.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(yahooEmail),
        });
        if (!yahooResponse.ok)
          throw new Error("Failed to reply to Yahoo email");
        return await yahooResponse.json();
      default:
        throw new Error("Unsupported provider for replying to email");
    }
  }

  async forwardEmail(
    id,
    { to, cc, bcc, additionalMessage, attachments, isHtml }
  ) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        const originalGmail = await client.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        const gmailHeaders = originalGmail.data.payload.headers;
        const gmailSubject =
          gmailHeaders.find((h) => h.name === "Subject")?.value || "";
        const gmailBoundary = `boundary_${Date.now()}`;
        const gmailParts = [
          `From: ${this.user.email}`,
          `To: ${to}`,
          cc ? `Cc: ${cc}` : "",
          bcc ? `Bcc: ${bcc}` : "",
          `Subject: Fwd: ${gmailSubject.replace(/^Fwd: /i, "")}`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/mixed; boundary=${gmailBoundary}`,
          "",
        ];
        if (additionalMessage) {
          gmailParts.push(
            `--${gmailBoundary}`,
            isHtml
              ? "Content-Type: text/html; charset=UTF-8"
              : "Content-Type: text/plain; charset=UTF-8",
            "",
            additionalMessage
          );
        }
        gmailParts.push(
          `--${gmailBoundary}`,
          "Content-Type: message/rfc822",
          "",
          ...gmailHeaders.map((h) => `${h.name}: ${h.value}`),
          "",
          this.getGmailBody(originalGmail.data.payload)
        );
        const gmailAttachments = await this.getGmailAttachmentsFull(
          originalGmail.data.payload,
          id,
          client
        );
        gmailAttachments.forEach((att) => {
          gmailParts.push(
            `--${gmailBoundary}`,
            `Content-Type: ${att.mimeType}`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="${att.filename}"`,
            "",
            att.data
          );
        });
        if (attachments) {
          attachments.forEach((att) => {
            gmailParts.push(
              `--${gmailBoundary}`,
              `Content-Type: ${att.mimetype}`,
              "Content-Transfer-Encoding: base64",
              `Content-Disposition: attachment; filename="${att.originalname}"`,
              "",
              att.content.toString("base64")
            );
          });
        }
        gmailParts.push(`--${gmailBoundary}--`);
        const gmailRaw = Buffer.from(gmailParts.join("\r\n"))
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
        const gmailResponse = await client.users.messages.send({
          userId: "me",
          requestBody: { raw },
        });
        return gmailResponse.data;
      case "microsoft":
        const msOriginal = await this.getEmail(id);
        const msEmail = {
          message: {
            subject: `Fwd: ${msOriginal.subject}`,
            body: {
              contentType: isHtml ? "HTML" : "Text",
              content: additionalMessage
                ? `${additionalMessage}\n\n--- Forwarded Message ---\n${msOriginal.body}`
                : msOriginal.body,
            },
            toRecipients: to
              .split(",")
              .map((email) => ({ emailAddress: { address: email.trim() } })),
            ccRecipients: cc
              ? cc
                  .split(",")
                  .map((email) => ({ emailAddress: { address: email.trim() } }))
              : [],
            bccRecipients: bcc
              ? bcc
                  .split(",")
                  .map((email) => ({ emailAddress: { address: email.trim() } }))
              : [],
            attachments: [
              ...(msOriginal.attachments || []),
              ...(attachments?.map((att) => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: att.originalname,
                contentType: att.mimetype,
                contentBytes: att.content.toString("base64"),
              })) || []),
            ],
          },
        };
        const msResponse = await fetch(`${client.baseUrl}/sendMail`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(msEmail),
        });
        if (!msResponse.ok)
          throw new Error("Failed to forward Microsoft email");
        return { status: "success" };
      case "yahoo":
        const yahooOriginal = await this.getEmail(id);
        const yahooEmail = {
          subject: `Fwd: ${yahooOriginal.subject}`,
          body: isHtml
            ? {
                html: additionalMessage
                  ? `${additionalMessage}<br><br>--- Forwarded Message ---<br>${yahooOriginal.body}`
                  : yahooOriginal.body,
              }
            : {
                text: additionalMessage
                  ? `${additionalMessage}\n\n--- Forwarded Message ---\n${yahooOriginal.body}`
                  : yahooOriginal.body,
              },
          to: to.split(",").map((email) => ({ email: email.trim() })),
          cc: cc ? cc.split(",").map((email) => ({ email: email.trim() })) : [],
          bcc: bcc
            ? bcc.split(",").map((email) => ({ email: email.trim() }))
            : [],
          attachments: [
            ...(yahooOriginal.attachments || []),
            ...(attachments?.map((att) => ({
              name: att.originalname,
              contentType: att.mimetype,
              data: att.content.toString("base64"),
            })) || []),
          ],
        };
        const yahooResponse = await fetch(`${client.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(yahooEmail),
        });
        if (!yahooResponse.ok) throw new Error("Failed to forward Yahoo email");
        return await yahooResponse.json();
      default:
        throw new Error("Unsupported provider for forwarding email");
    }
  }

  async getGmailAttachmentsFull(payload, messageId, client) {
    const parts = payload?.parts || [];
    const attachments = [];
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        const attachment = await client.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: part.body.attachmentId,
        });
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          data: attachment.data.data.replace(/-/g, "+").replace(/_/g, "/"),
        });
      }
    }
    return attachments;
  }

  async getAttachment(messageId, attachmentId) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        const attachment = await client.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: attachmentId,
        });
        return {
          data: Buffer.from(
            attachment.data.data.replace(/-/g, "+").replace(/_/g, "/"),
            "base64"
          ),
          mimeType: attachment.data.mimeType,
          filename: attachment.data.filename,
        };
      case "microsoft":
        const response = await fetch(
          `${client.baseUrl}/messages/${messageId}/attachments/${attachmentId}`,
          {
            headers: { Authorization: `Bearer ${client.accessToken}` },
          }
        );
        if (!response.ok)
          throw new Error("Failed to fetch Microsoft attachment");
        const data = await response.json();
        return {
          data: Buffer.from(data.contentBytes, "base64"),
          mimeType: data.contentType,
          filename: data.name,
        };
      case "yahoo":
        throw new Error("Yahoo attachment download not fully supported");
      default:
        throw new Error("Unsupported provider for attachment download");
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
        throw new Error("Unsupported provider for marking as read");
    }
  }

  async archiveEmail(emailId) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        await client.users.messages.modify({
          userId: "me",
          id: emailId,
          requestBody: { removeLabelIds: ["INBOX"] },
        });
        break;
      case "microsoft":
        const archiveFolderId = await this.getMicrosoftArchiveFolderId(client);
        await fetch(`${client.baseUrl}/messages/${emailId}/move`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destinationId: archiveFolderId }),
        });
        break;
      case "yahoo":
        await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ folder: "Archive" }),
        });
        break;
      default:
        throw new Error("Unsupported provider for archiving email");
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
        throw new Error("Unsupported provider for trashing email");
    }
  }

  async untrashEmail(emailId) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        await client.users.messages.untrash({ userId: "me", id: emailId });
        break;
      case "microsoft":
        await fetch(`${client.baseUrl}/messages/${emailId}/move`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destinationId: "inbox" }),
        });
        break;
      case "yahoo":
        await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ folder: "Inbox" }),
        });
        break;
      default:
        throw new Error("Unsupported provider for untrashing email");
    }
  }

  async deleteEmail(emailId) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        await client.users.messages.delete({ userId: "me", id: emailId });
        break;
      case "microsoft":
        await fetch(`${client.baseUrl}/messages/${emailId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${client.accessToken}` },
        });
        break;
      case "yahoo":
        await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${client.accessToken}` },
        });
        break;
      default:
        throw new Error("Unsupported provider for deleting email");
    }
  }

  async modifyLabels(emailId, { addLabelIds, removeLabelIds }) {
    const client = await this.getEmailClient();
    if (this.user.authProvider === "google") {
      const response = await client.users.messages.modify({
        userId: "me",
        id: emailId,
        requestBody: { addLabelIds, removeLabelIds },
      });
      return response.data.labelIds;
    }
    throw new Error("Label modification only supported for Gmail");
  }

  async batchModify({ ids, addLabelIds, removeLabelIds }) {
    const client = await this.getEmailClient();
    if (this.user.authProvider === "google") {
      await client.users.messages.batchModify({
        userId: "me",
        requestBody: { ids, addLabelIds, removeLabelIds },
      });
    } else {
      throw new Error("Batch modification only supported for Gmail");
    }
  }

  async getLabels() {
    const client = await this.getEmailClient();
    if (this.user.authProvider === "google") {
      const response = await client.users.labels.list({ userId: "me" });
      return response.data.labels;
    }
    return [];
  }

  async createLabel({ name, labelListVisibility, messageListVisibility }) {
    const client = await this.getEmailClient();
    if (this.user.authProvider === "google") {
      const response = await client.users.labels.create({
        userId: "me",
        requestBody: { name, labelListVisibility, messageListVisibility },
      });
      return response.data;
    }
    throw new Error("Label creation only supported for Gmail");
  }

  async updateLabel(id, { name, labelListVisibility, messageListVisibility }) {
    const client = await this.getEmailClient();
    if (this.user.authProvider === "google") {
      const response = await client.users.labels.update({
        userId: "me",
        id,
        requestBody: { name, labelListVisibility, messageListVisibility },
      });
      return response.data;
    }
    throw new Error("Label update only supported for Gmail");
  }

  async deleteLabel(id) {
    const client = await this.getEmailClient();
    if (this.user.authProvider === "google") {
      await client.users.labels.delete({ userId: "me", id });
    } else {
      throw new Error("Label deletion only supported for Gmail");
    }
  }

  async moveEmailToFolder(emailId, folderName) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        await client.users.messages.modify({
          userId: "me",
          id: emailId,
          requestBody: {
            addLabelIds: [folderName],
            removeLabelIds: ["INBOX"],
          },
        });
        break;
      case "microsoft":
        await fetch(`${client.baseUrl}/messages/${emailId}/move`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destinationId: folderName }),
        });
        break;
      case "yahoo":
        await fetch(`${client.baseUrl}/v1/message/${emailId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ folder: folderName }),
        });
        break;
      default:
        throw new Error("Unsupported provider for moving email to folder");
    }
  }

  async createFolder(folderName) {
    const client = await this.getEmailClient();
    switch (this.user.authProvider) {
      case "google":
        await client.users.labels.create({
          userId: "me",
          requestBody: {
            name: folderName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          },
        });
        break;
      case "microsoft":
        await fetch(`${client.baseUrl}/mailFolders`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName: folderName }),
        });
        break;
      case "yahoo":
        await fetch(`${client.baseUrl}/v1/mailboxes`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: folderName }),
        });
        break;
      default:
        throw new Error("Unsupported provider for creating folder");
    }
  }

  async filterImportantEmails(
    emails,
    keywords = [
      "urgent",
      "important",
      "priority",
      "deadline",
      "action required",
    ],
    timeRange = "weekly"
  ) {
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

  async processEmailCommand(prompt) {
    const emails = (await this.fetchEmails({ maxResults: 50 })).messages;
    const emailContext = emails.map((e) => ({
      id: e.id,
      subject: e.subject,
      from: e.from,
      to: e.to,
      snippet: e.snippet,
      body: e.body,
    }));

    const fullPrompt = `
      You are Grok, my email assistant and administrator with agentic capabilities. Based on the following email context and my command, perform the requested email action or provide a response.
      Email Context: ${JSON.stringify(emailContext, null, 2)}
      Command: "${prompt}"
      Available actions: send, reply, forward, markAsRead, markAsUnread, archive, trash, untrash, delete, modifyLabels, batchModify, getLabels, createLabel, updateLabel, deleteLabel, listEmails, getImportantEmails, moveToFolder, createFolder.
      Return a JSON object with the action to take, relevant parameters, and a message to display to the user.
      If the command involves sending an email (e.g., "tell X to send me a draft"), extract the recipient and craft the email content accordingly with a professional tone.
    `;
    const response = await this.grok.chat.completions.create({
      messages: [{ role: "user", content: fullPrompt }],
      model: "llama3-70b-8192",
      temperature: 0.7,
    });
    const result = JSON.parse(
      response.choices[0]?.message?.content ||
        '{"action": "unknown", "params": {}, "message": "Unknown command"}'
    );
    return await this.executeEmailAction(result);
  }

  async executeEmailAction({ action, params, message }) {
    switch (action) {
      case "send":
        return { result: await this.sendEmail(params), message };
      case "reply":
        return { result: await this.replyToEmail(params.id, params), message };
      case "forward":
        return { result: await this.forwardEmail(params.id, params), message };
      case "markAsRead":
        await this.markAsRead(params.id, true);
        return { result: null, message };
      case "markAsUnread":
        await this.markAsRead(params.id, false);
        return { result: null, message };
      case "archive":
        await this.archiveEmail(params.id);
        return { result: null, message };
      case "trash":
        await this.trashEmail(params.id);
        return { result: null, message };
      case "untrash":
        await this.untrashEmail(params.id);
        return { result: null, message };
      case "delete":
        await this.deleteEmail(params.id);
        return { result: null, message };
      case "modifyLabels":
        return { result: await this.modifyLabels(params.id, params), message };
      case "batchModify":
        await this.batchModify(params);
        return { result: null, message };
      case "getLabels":
        return { result: await this.getLabels(), message };
      case "createLabel":
        return { result: await this.createLabel(params), message };
      case "updateLabel":
        return { result: await this.updateLabel(params.id, params), message };
      case "deleteLabel":
        await this.deleteLabel(params.id);
        return { result: null, message };
      case "listEmails":
        return { result: await this.fetchEmails(params), message };
      case "getImportantEmails":
        const emails = (await this.fetchEmails(params)).messages;
        return {
          result: await this.filterImportantEmails(
            emails,
            params.keywords,
            params.timeRange
          ),
          message,
        };
      case "moveToFolder":
        await this.moveEmailToFolder(params.id, params.folderName);
        return { result: null, message };
      case "createFolder":
        await this.createFolder(params.folderName);
        return { result: null, message };
      default:
        return {
          result: null,
          message: "Unknown command or action not supported",
        };
    }
  }
}

export const createEmailService = async (req) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new Error("User not found");
  return new EmailService(user);
};
