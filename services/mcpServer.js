import Groq from "groq-sdk";
import { StatusCodes } from "http-status-codes";
import EmailDraft from "../models/EmailDraft.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

const EMAIL_ADMIN_PROMPTS = `You are an email administrator powered by Grok from xAI. 
You can draft, edit, read, trash, reply to, search, and send emails.
You've been given access to a specific email account. 
You have the following tools available:
- Send an email (send-email)
- Retrieve emails (fetch-emails)
- Read email content (read-email)
- Trash email (trash-email)
- Reply to email (reply-to-email)
- Search emails (search-emails)
Never send an email draft or trash an email unless the user confirms first. 
Always ask for approval if not already given. Use Grok's AI capabilities to assist with drafting and editing emails when requested.`;

const PROMPTS = {
  "manage-email": {
    name: "manage-email",
    description: "Act like an email administrator with AI assistance",
    arguments: null,
  },
  "draft-email": {
    name: "draft-email",
    description: "Draft an email with AI assistance from Grok",
    arguments: [
      {
        name: "content",
        description: "What the email is about",
        required: true,
      },
      {
        name: "recipient",
        description: "Who should the email be addressed to",
        required: true,
      },
      {
        name: "recipient_email",
        description: "Recipient's email address",
        required: true,
      },
    ],
  },
  "edit-draft": {
    name: "edit-draft",
    description: "Edit an existing email draft with AI assistance from Grok",
    arguments: [
      {
        name: "changes",
        description: "What changes should be made to the draft",
        required: true,
      },
      {
        name: "current_draft",
        description: "The current draft to edit",
        required: true,
      },
    ],
  },
};

const TOOLS = [
  {
    name: "send-email",
    description:
      "Sends email to recipient. Do not use if user only asked to draft email.",
    inputSchema: {
      type: "object",
      properties: {
        recipient_id: {
          type: "string",
          description: "Recipient email address",
        },
        subject: { type: "string", description: "Email subject" },
        message: { type: "string", description: "Email content text" },
        attachments: { type: "array", description: "List of attachments" },
      },
      required: ["recipient_id", "subject", "message"],
    },
  },
  {
    name: "fetch-emails",
    description: "Retrieve emails",
    inputSchema: { type: "object", properties: {}, required: null },
  },
  {
    name: "read-email",
    description: "Retrieves given email content",
    inputSchema: {
      type: "object",
      properties: { email_id: { type: "string", description: "Email ID" } },
      required: ["email_id"],
    },
  },
  {
    name: "trash-email",
    description: "Moves email to trash. Confirm before moving email to trash.",
    inputSchema: {
      type: "object",
      properties: { email_id: { type: "string", description: "Email ID" } },
      required: ["email_id"],
    },
  },
  {
    name: "reply-to-email",
    description: "Replies to an existing email.",
    inputSchema: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "Email ID to reply to" },
        message: { type: "string", description: "Reply content" },
        attachments: { type: "array", description: "List of attachments" },
      },
      required: ["email_id", "message"],
    },
  },
  {
    name: "search-emails",
    description: "Searches emails based on a query",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "mark-email-as-read",
    description: "Marks given email as read",
    inputSchema: {
      type: "object",
      properties: { email_id: { type: "string", description: "Email ID" } },
      required: ["email_id"],
    },
  },
  {
    name: "summarize-email",
    description: "Summarizes given email content",
    inputSchema: {
      type: "object",
      properties: { email_id: { type: "string", description: "Email ID" } },
      required: ["email_id"],
    },
  },
];

const groqResponse = async (input, model = "llama3-70b-8192") => {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are an AI assistant built by xAI, designed to help with email tasks efficiently.",
        },
        { role: "user", content: input },
      ],
      model,
      max_tokens: 32768,
      temperature: 0.7,
    });
    return (
      chatCompletion.choices[0]?.message?.content || "No response generated."
    );
  } catch (error) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Groq API error: ${error.message}`
    );
  }
};

class MCPServer {
  constructor(emailService) {
    this.emailService = emailService;
  }

  async listPrompts() {
    return Object.values(PROMPTS);
  }

  async getPrompt(name, args) {
    if (!PROMPTS[name]) throw new Error(`Prompt not found: ${name}`);

    if (name === "manage-email") {
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: EMAIL_ADMIN_PROMPTS },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: await groqResponse(
                "Welcome to email management with Grok!"
              ),
            },
          },
        ],
      };
    } else if (name === "draft-email") {
      const content = args?.content || "";
      const recipient = args?.recipient || "";
      const recipientEmail = args?.recipient_email || "";
      const aiDraft = await groqResponse(
        `Draft an email about ${content} for ${recipient} (${recipientEmail}). Include a subject line starting with 'Subject:' on the first line. Do not send the email yet, just draft it and ask the user for their thoughts.`
      );
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please draft an email about ${content} for ${recipient} (${recipientEmail}).`,
            },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: `${aiDraft}\n\nWhat do you think of this draft?`,
            },
          },
        ],
      };
    } else if (name === "edit-draft") {
      const changes = args?.changes || "";
      const currentDraft = args?.current_draft || "";
      const aiEdit = await groqResponse(
        `Edit this draft: ${currentDraft} with changes: ${changes}`
      );
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please revise the current email draft:\n${currentDraft}\n\nRequested changes:\n${changes}`,
            },
          },
          { role: "assistant", content: { type: "text", text: aiEdit } },
        ],
      };
    }
    throw new Error("Prompt implementation not found");
  }

  async listTools() {
    return TOOLS;
  }

  async callTool(name, args, userId) {
    switch (name) {
      case "send-email": {
        const { recipient_id, subject, message, attachments = [] } = args;
        if (!recipient_id || !subject || !message)
          throw new Error("Missing required parameters");
        const sendResponse = await this.emailService.sendEmail({
          to: recipient_id,
          subject,
          body: message,
          attachments,
          isHtml: false,
        });
        return [{ type: "text", text: "Email sent successfully" }];
      }
      case "fetch-emails": {
        const emails = await this.emailService.fetchEmails();
        return [
          {
            type: "text",
            text: JSON.stringify(emails),
            artifact: { type: "json", data: emails },
          },
        ];
      }
      case "read-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        const emailContent = await this.emailService.getEmail(email_id);
        return [
          {
            type: "text",
            text: JSON.stringify(emailContent),
            artifact: { type: "dictionary", data: emailContent },
          },
        ];
      }
      case "trash-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        await this.emailService.trashEmail(email_id);
        return [{ type: "text", text: "Email moved to trash" }];
      }
      case "reply-to-email": {
        const { email_id, message, attachments = [] } = args;
        if (!email_id || !message)
          throw new Error("Missing required parameters");
        const replyResponse = await this.emailService.replyToEmail(email_id, {
          body: message,
          attachments,
          isHtml: false,
        });
        return [{ type: "text", text: "Reply sent successfully" }];
      }
      case "search-emails": {
        const { query } = args;
        if (!query) throw new Error("Missing query parameter");
        const searchResults = await this.emailService.fetchEmails({ query });
        return [
          {
            type: "text",
            text: JSON.stringify(searchResults),
            artifact: { type: "json", data: searchResults },
          },
        ];
      }
      case "mark-email-as-read": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        await this.emailService.markAsRead(email_id, true);
        return [{ type: "text", text: "Email marked as read" }];
      }
      case "summarize-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        const emailContent = await this.emailService.getEmail(email_id);
        const summary = await groqResponse(
          `Summarize this email content: ${emailContent.body}`
        );
        return [{ type: "text", text: summary }];
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async chatWithBot(req, message) {
    const userId = req.user.id;
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("draft an email")) {
      const match = message.match(/to\s+([^ ]+)\s+about\s+(.+)/i);
      if (match) {
        const [, recipient, content] = match;
        const recipientEmail = `${recipient}@example.com`; // Adjust as needed
        const draft = await this.getPrompt("draft-email", {
          recipient,
          content,
          recipient_email: recipientEmail,
        });

        const draftContent = draft.messages[1].content.text;
        const subject = draftContent.split("\n")[0].replace("Subject: ", "");
        const body = draftContent.split("\n\n")[1];

        await EmailDraft.create({
          userId,
          recipientId: recipientEmail,
          subject,
          message: body,
        });

        return draft.messages.map((msg) => msg.content);
      }
    }

    if (
      lowerMessage.includes("send the email") ||
      lowerMessage.includes("yes, send it")
    ) {
      const lastDraft = await EmailDraft.findOne({ userId }).sort({
        createdAt: -1,
      });
      if (lastDraft) {
        const sendResponse = await this.callTool(
          "send-email",
          {
            recipient_id: lastDraft.recipientId,
            subject: lastDraft.subject,
            message: lastDraft.message,
          },
          userId
        );
        await EmailDraft.deleteOne({ _id: lastDraft._id });
        return sendResponse;
      }
      return [
        {
          type: "text",
          text: "No draft found to send. Please draft an email first.",
        },
      ];
    }

    if (lowerMessage.includes("summarize") && lowerMessage.includes("email")) {
      const emailsResponse = await this.callTool("fetch-emails", {}, userId);
      const emails = emailsResponse[0].artifact?.data;
      if (Array.isArray(emails.messages) && emails.messages.length > 0) {
        const latestEmailId = emails.messages[0].id;
        const summary = await this.callTool(
          "summarize-email",
          { email_id: latestEmailId },
          userId
        );
        return summary;
      }
      return [{ type: "text", text: "No emails found to summarize." }];
    }

    if (lowerMessage.includes("read") && lowerMessage.includes("email")) {
      const emailsResponse = await this.callTool("fetch-emails", {}, userId);
      const emails = emailsResponse[0].artifact?.data;
      if (Array.isArray(emails.messages) && emails.messages.length > 0) {
        const latestEmailId = emails.messages[0].id;
        const emailContent = await this.callTool(
          "read-email",
          { email_id: latestEmailId },
          userId
        );
        return emailContent;
      }
      return [{ type: "text", text: "No emails found to read." }];
    }

    if (lowerMessage.includes("trash") && lowerMessage.includes("email")) {
      const match = message.match(/email\s+(\d+)/i);
      const emailId = match ? match[1] : null;
      if (emailId) {
        const trashResponse = await this.callTool(
          "trash-email",
          { email_id: emailId },
          userId
        );
        return trashResponse;
      }
      return [
        {
          type: "text",
          text: 'Please specify an email ID to trash (e.g., "trash email 123").',
        },
      ];
    }

    const response = await groqResponse(
      `User asked: "${message}". Respond helpfully and naturally, using your capabilities as an email assistant powered by Grok from xAI.`
    );
    return [{ type: "text", text: response }];
  }
}

export default MCPServer;
