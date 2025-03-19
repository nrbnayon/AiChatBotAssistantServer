import Groq from "groq-sdk";
import EmailDraft from "../models/EmailDraft.js";
import { getDefaultModel, getModelById } from "../routes/aiModelRoutes.js";
import { ApiError, logErrorWithStyle } from "../utils/errorHandler.js";

const SYSTEM_PROMPT = `
You are Grok, an AI email assistant powered by xAI. Your role is to assist users with their email tasks in a natural, conversational manner. You can perform actions like sending, drafting, reading, and managing emails, as well as provide summaries and insights from their email data.

### Guidelines:
- Always respond in a friendly, helpful tone.
- When performing actions, confirm what you're doing in a conversational way.
- If the user asks for information, present it clearly and suggest next steps.
- Use markdown for formatting, especially for tables or lists, to make data easy to read and exportable.
- If you need more information to complete a task, ask the user politely.

### Available Actions:
- draft-email: Draft an email (params: recipient, content, recipient_email)
- send-email: Send an email (params: recipient_id, subject, message)
- read-email: Read an email (params: email_id)
- trash-email: Trash an email (params: email_id)
- reply-to-email: Reply to an email (params: email_id, message)
- search-emails: Search emails (params: query)
- mark-email-as-read: Mark an email as read (params: email_id)
- summarize-email: Summarize an email (params: email_id)
- fetch-emails: Fetch emails with optional filter (params: filter)
- count-emails: Count emails with optional filter and analyze them (params: filter)

### Response Format:
Always respond with a JSON object:
- For actions: {"action": "<action_name>", "params": {<parameters>}, "message": "<conversational_response>"}
- For information or summaries: {"message": "<conversational_response>", "data": {<structured_data>}}
- For casual conversation: {"chat": "<your_response>"}

### Examples:
User: "What were the offers I've seen for cars in the last week?"
Response: {
  "message": "Here are the car offers from your emails in the last week:",
  "data": {
    "table": [
      {"Car Model": "Toyota Camry", "Year": 2020, "Price": "$20,000"},
      {"Car Model": "Honda Accord", "Year": 2019, "Price": "$18,000"}
    ]
  }
}

User: "Send an email to john@example.com about the meeting tomorrow."
Response: {
  "action": "send-email",
  "params": {
    "recipient_id": "john@example.com",
    "subject": "Meeting Tomorrow",
    "message": "Hi John,\n\nJust a reminder about our meeting tomorrow at 2 PM.\n\nBest,\n[Your Name]"
  },
  "message": "I’ve prepared an email to John about the meeting. Shall I send it now?"
}

User: "Hi"
Response: {"chat": "Hello! How can I assist you with your emails today?"}
`;

class ModelProvider {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.retryCount = 3;
    this.retryDelay = 1000;
  }

  async callWithFallbackChain(primaryModelId, options, fallbackChain = []) {
    const completeChain = [primaryModelId, ...fallbackChain];
    let lastError = null;

    for (const currentModelId of completeChain) {
      try {
        const model = getModelById(currentModelId);
        if (!model) {
          console.warn(`Model ${currentModelId} not found, skipping`);
          continue;
        }
        console.log(`Attempting to use model: ${model.name}`);
        const result = await this.callModelWithRetry(currentModelId, options);
        console.log(`Successfully used model: ${model.name}`);
        return {
          result,
          modelUsed: model,
          fallbackUsed: currentModelId !== primaryModelId,
        };
      } catch (error) {
        lastError = error;
        logErrorWithStyle(error);
        console.warn(
          `Model ${currentModelId} failed, trying next in fallback chain`
        );
      }
    }
    throw new ApiError(
      503,
      `All models in the fallback chain failed: ${
        lastError?.message || "Unknown error"
      }`
    );
  }

  async callModelWithRetry(modelId, options) {
    let attemptCount = 0;
    let lastError = null;
    let currentRetryDelay = this.retryDelay;

    while (attemptCount < this.retryCount) {
      try {
        const result = await this.groq.chat.completions.create({
          ...options,
          model: modelId,
        });
        return result;
      } catch (error) {
        lastError = error;
        attemptCount++;
        if (attemptCount < this.retryCount) {
          console.warn(
            `Attempt ${attemptCount} failed for model ${modelId}, retrying after ${currentRetryDelay}ms`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, currentRetryDelay)
          );
          currentRetryDelay *= 2;
        }
      }
    }
    throw new ApiError(
      503,
      `Model ${modelId} failed after ${this.retryCount} attempts: ${
        lastError?.message || "Unknown error"
      }`
    );
  }
}

class MCPServer {
  constructor(emailService) {
    this.emailService = emailService;
    this.modelProvider = new ModelProvider();
    this.pendingEmails = new Map();
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
        return [
          {
            type: "text",
            text: "I’ve sent the email for you!",
          },
        ];
      }
      case "fetch-emails": {
        const { filter, query } = args;
        const emails = await this.emailService.fetchEmails({ filter, query });
        const analyzedData = this.analyzeEmails(emails, query || filter || "");
        let text = analyzedData.table
          ? "Here’s a summary of the car offers from your emails in the last week:\n\n" +
            this.formatTable(analyzedData.table) +
            "\n\nWould you like to reply to any of these offers or export this table?"
          : `I found ${emails.messages.length} emails matching your request. Here are the first few:\n\n` +
            emails.messages
              .slice(0, 3)
              .map(
                (e, i) =>
                  `${i + 1}. From: ${e.from}, Subject: ${
                    e.subject || "No subject"
                  }`
              )
              .join("\n") +
            "\n\nWhat would you like to do with these?";
        return [
          {
            type: "text",
            text,
            artifact: { type: "json", data: analyzedData },
          },
        ];
      }
      case "count-emails": {
        const { filter } = args;
        if (!filter) throw new Error("Missing filter parameter");
        const emails = await this.emailService.fetchEmails({ filter });
        const totalEmails = emails.messages ? emails.messages.length : 0;
        let analysis = "";
        if (totalEmails > 0) {
          const recentEmails = emails.messages.slice(0, 10);
          const subjects = recentEmails
            .map((email) => email.subject || "No subject")
            .join(", ");
          analysis = `Here’s a peek at your ${recentEmails.length} most recent ${filter} emails: ${subjects}.`;
        } else {
          analysis = `Looks like you have no ${filter} emails right now.`;
        }
        return [
          {
            type: "text",
            text: `You’ve got ${totalEmails} ${filter} email${
              totalEmails === 1 ? "" : "s"
            }. ${analysis}\n\nAnything you’d like to do with these?`,
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
            text: "Here’s the email you asked for:",
            artifact: { type: "json", data: emailContent },
          },
        ];
      }
      case "trash-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        await this.emailService.trashEmail(email_id);
        return [
          {
            type: "text",
            text: "I’ve moved that email to the trash for you.",
          },
        ];
      }
      case "reply-to-email": {
        const { email_id, message, attachments = [] } = args;
        if (!email_id || !message)
          throw new Error("Missing required parameters");
        await this.emailService.replyToEmail(email_id, {
          body: message,
          attachments,
        });
        return [
          {
            type: "text",
            text: "Your reply is on its way!",
          },
        ];
      }
      case "search-emails": {
        const { query } = args;
        if (!query) throw new Error("Missing query parameter");
        const searchResults = await this.emailService.fetchEmails({ query });
        return [
          {
            type: "text",
            text: `Here’s what I found for "${query}":`,
            artifact: { type: "json", data: searchResults },
          },
        ];
      }
      case "mark-email-as-read": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        await this.emailService.markAsRead(email_id, true);
        return [
          {
            type: "text",
            text: "I’ve marked that email as read for you.",
          },
        ];
      }
      case "summarize-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        const emailContent = await this.emailService.getEmail(email_id);
        const summaryResponse = await this.modelProvider.callWithFallbackChain(
          getDefaultModel().id,
          {
            messages: [
              {
                role: "user",
                content: `Please summarize this email: ${emailContent.body}`,
              },
            ],
            temperature: 0.7,
          },
          ["mixtral-8x7b-32768", "llama-3-70b"]
        );
        const summary =
          summaryResponse.result.choices[0]?.message?.content ||
          "I couldn’t generate a summary for this one.";
        return [
          {
            type: "text",
            text: `Here’s a quick summary of that email: ${summary}`,
          },
        ];
      }
      case "draft-email": {
        const { recipient, content, recipient_email } = args;
        if (!recipient || !content)
          throw new Error("Missing required parameters");
        const draftResponse = await this.modelProvider.callWithFallbackChain(
          getDefaultModel().id,
          {
            messages: [
              {
                role: "user",
                content: `Draft an email to ${recipient} about ${content}. Include a subject line starting with 'Subject:'`,
              },
            ],
            temperature: 0.7,
          },
          ["mixtral-8x7b-32768", "llama-3-70b"]
        );
        const draftText =
          draftResponse.result.choices[0]?.message?.content ||
          "Draft not generated";
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
            text: `I’ve drafted an email for you:\n\n**To:** ${recipient}\n**Subject:** ${subject}\n\n${body}\n\nLet me know if you’d like to tweak it or send it off!`,
          },
        ];
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  analyzeEmails(emails, query) {
    if (query.toLowerCase().includes("car offers")) {
      const offers = emails.messages
        .map((email) => {
          const modelMatch = email.body.match(/Car Model: (\w+)/) || [
            "",
            "N/A",
          ];
          const yearMatch = email.body.match(/Year: (\d{4})/) || ["", "N/A"];
          const priceMatch = email.body.match(/Price: \$(\d+)/) || ["", "N/A"];
          return {
            "Car Model": modelMatch[1],
            Year: yearMatch[1],
            Price: priceMatch[1] === "N/A" ? "N/A" : `$${priceMatch[1]}`,
          };
        })
        .filter(
          (offer) =>
            offer["Car Model"] !== "N/A" ||
            offer["Year"] !== "N/A" ||
            offer["Price"] !== "N/A"
        );
      return { table: offers };
    }
    return {
      emails: emails.messages.map((email) => ({
        id: email.id,
        subject: email.subject,
        from: email.from,
      })),
    };
  }

  formatTable(data) {
    if (!data || data.length === 0) return "No data available.";
    const headers = Object.keys(data[0]);
    const rows = data.map((row) =>
      headers.map((header) => row[header] || "N/A").join(" | ")
    );
    return (
      `| ${headers.join(" | ")} |\n` +
      `| ${headers.map(() => "---").join(" | ")} |\n` +
      rows.map((row) => `| ${row} |`).join("\n")
    );
  }

  async chatWithBot(req, message, history = []) {
    const userId = req.user.id;

    if (message.toLowerCase().includes("confirm send")) {
      const pendingEmail = this.pendingEmails.get(userId);
      if (pendingEmail) {
        const toolResponse = await this.callTool(
          "send-email",
          pendingEmail,
          userId
        );
        this.pendingEmails.delete(userId);
        return toolResponse;
      } else {
        return [
          {
            type: "text",
            text: "There’s no email waiting to be sent. Shall we start a new one?",
          },
        ];
      }
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message },
    ];
    const primaryModelId = getDefaultModel().id;
    const fallbackChain = ["mixtral-8x7b-32768", "llama-3-70b"];
    const options = {
      messages,
      temperature: 0.7,
    };
    const { result } = await this.modelProvider.callWithFallbackChain(
      primaryModelId,
      options,
      fallbackChain
    );
    const responseContent = result.choices[0]?.message?.content || "{}";
    console.log("[DEBUG] Raw model response:", responseContent);
    let actionData;
    try {
      actionData = JSON.parse(responseContent);
      if (!actionData.action && !actionData.message && !actionData.chat) {
        console.log(
          "[DEBUG] Model response lacks action, message, or chat:",
          actionData
        );
        return [
          {
            type: "text",
            text: "I’m not sure what you meant there. Could you try again?",
          },
        ];
      }
    } catch (error) {
      console.error(
        "[ERROR] Failed to parse model response as JSON:",
        error.message,
        "Response:",
        responseContent
      );
      return [
        {
          type: "text",
          text: "Oops, something went wrong on my end. Could you please rephrase that?",
        },
      ];
    }

    if (actionData.action) {
      console.log(
        "[DEBUG] Action recognized:",
        actionData.action,
        "Params:",
        actionData.params
      );
      if (actionData.action === "send-email") {
        this.pendingEmails.set(userId, actionData.params);
        return [
          {
            type: "text",
            text: `Here’s the email I’ve prepared:\n\n**To:** ${actionData.params.recipient_id}\n**Subject:** ${actionData.params.subject}\n\n${actionData.params.message}\n\nJust say "confirm send" to send it, or let me know if you’d like to change anything!`,
          },
        ];
      }
      const toolResponse = await this.callTool(
        actionData.action,
        actionData.params,
        userId
      );
      return toolResponse;
    } else if (actionData.message && actionData.data) {
      let text = `${actionData.message}\n\n${this.formatTable(
        actionData.data.table
      )}\n\nWhat would you like to do next? Reply to one, export this table, or something else?`;
      return [{ type: "text", text }];
    } else if (actionData.chat) {
      return [{ type: "text", text: actionData.chat }];
    } else if (actionData.message) {
      return [{ type: "text", text: actionData.message }];
    } else {
      return [
        {
          type: "text",
          text: "I’m not quite sure what you’re asking. Could you give me a bit more detail?",
        },
      ];
    }
  }
}

export default MCPServer;
