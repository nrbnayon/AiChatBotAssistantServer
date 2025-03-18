import Groq from "groq-sdk";
import EmailDraft from "../models/EmailDraft.js";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `
You are an AI email assistant powered by Grok from xAI. Your role is to interpret user commands and perform email actions for Gmail, Outlook, and Yahoo accounts. Available actions:
- draft-email: Draft an email (params: recipient, content, recipient_email)
- send-email: Send an email (params: recipient_id, subject, message)
- read-email: Read an email (params: email_id)
- trash-email: Trash an email (params: email_id)
- reply-to-email: Reply to an email (params: email_id, message)
- search-emails: Search emails (params: query)
- mark-email-as-read: Mark an email as read (params: email_id)
- summarize-email: Summarize an email (params: email_id)
- list-emails: List recent emails (no params required)

Rules:
1. For actions requiring confirmation (send-email, trash-email), ask for user confirmation unless explicitly confirmed in the command (e.g., "send it now").
2. Maintain conversation context using the provided history.
3. Extract parameters from the user's command naturally (e.g., "email John about the meeting" → recipient: "John", content: "the meeting").
4. If parameters are missing or unclear, ask for clarification.
5. Respond with a JSON object:
   - "action": the action to perform (null if no action or waiting for confirmation)
   - "params": parameters for the action
   - "message": user-friendly response

Examples:
- User: "Draft an email to John about the meeting"
  Response: {"action": "draft-email", "params": {"recipient": "John", "content": "the meeting", "recipient_email": null}, "message": "I've drafted an email to John about the meeting. Please provide John's email address."}
- User: "Trash email 123"
  Response: {"action": null, "params": {}, "message": "Are you sure you want to trash email 123? Please confirm."}
- User: "Yes"
  Response: {"action": "trash-email", "params": {"email_id": "123"}, "message": "Email 123 has been moved to trash."}
`;

const TOOLS = [
  {
    name: "send-email",
    description: "Sends email to recipient",
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
    description: "Moves email to trash",
    inputSchema: {
      type: "object",
      properties: { email_id: { type: "string", description: "Email ID" } },
      required: ["email_id"],
    },
  },
  {
    name: "reply-to-email",
    description: "Replies to an existing email",
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
  {
    name: "draft-email",
    description: "Drafts an email without sending",
    inputSchema: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "Recipient name" },
        content: { type: "string", description: "Email content" },
        recipient_email: {
          type: "string",
          description: "Recipient email address",
        },
      },
      required: ["recipient", "content"],
    },
  },
];

class MCPServer {
  constructor(emailService) {
    this.emailService = emailService;
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
        await this.emailService.sendEmail({
          to: recipient_id,
          subject,
          body: message,
          attachments,
        });
        return [{ type: "text", text: "Email sent successfully" }];
      }
      case "fetch-emails": {
        const emails = await this.emailService.fetchEmails();
        return [
          {
            type: "text",
            text: "Emails retrieved",
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
            text: "Email content retrieved",
            artifact: { type: "json", data: emailContent },
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
        await this.emailService.replyToEmail(email_id, {
          body: message,
          attachments,
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
            text: "Search results retrieved",
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
        const summary = await groq.chat.completions.create({
          messages: [
            {
              role: "user",
              content: `Summarize this email: ${emailContent.body}`,
            },
          ],
          model: "llama3-70b-8192",
          temperature: 0.7,
        });
        return [
          {
            type: "text",
            text:
              summary.choices[0]?.message?.content || "Summary not generated",
          },
        ];
      }
      case "draft-email": {
        const { recipient, content, recipient_email } = args;
        if (!recipient || !content)
          throw new Error("Missing required parameters");
        const draftResponse = await groq.chat.completions.create({
          messages: [
            {
              role: "user",
              content: `Draft an email to ${recipient} about ${content}. Include a subject line starting with 'Subject:'`,
            },
          ],
          model: "llama3-70b-8192",
          temperature: 0.7,
        });
        const draftText =
          draftResponse.choices[0]?.message?.content || "Draft not generated";
        const subject = draftText.split("\n")[0].replace("Subject: ", "");
        const body = draftText.split("\n").slice(1).join("\n");
        await EmailDraft.create({
          userId,
          recipientId: recipient_email || recipient,
          subject,
          message: body,
        });
        return [
          {
            type: "text",
            text: `Draft created:\n${draftText}\nPlease review and provide the recipient's email if needed.`,
          },
        ];
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async chatWithBot(req, message, history = []) {
    const userId = req.user.id;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message },
    ];

    const groqResponse = await groq.chat.completions.create({
      messages,
      model: "llama3-70b-8192",
      temperature: 0.7,
    });

    const responseContent = groqResponse.choices[0]?.message?.content || "{}";
    let actionData;
    try {
      actionData = JSON.parse(responseContent);
    } catch (error) {
      return [
        {
          type: "text",
          text: "I'm sorry, I couldn't understand your request. Please try again.",
        },
      ];
    }

    const { action, params, message: responseMessage } = actionData;

    if (action) {
      const toolResponse = await this.callTool(action, params, userId);
      return [{ type: "text", text: responseMessage }, ...toolResponse];
    }
    return [{ type: "text", text: responseMessage }];
  }
}

export default MCPServer;
