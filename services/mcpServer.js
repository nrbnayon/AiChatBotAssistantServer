import Groq from "groq-sdk";
import EmailDraft from "../models/EmailDraft.js";
import { getDefaultModel, getModelById } from "../routes/aiModelRoutes.js";
import { ApiError, logErrorWithStyle } from "../utils/errorHandler.js";
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Updated SYSTEM_PROMPT to ensure JSON output with action or message
const SYSTEM_PROMPT = `
You are an AI email assistant powered by Grok from xAI. Your role is to interpret user commands and perform email actions such as sending, drafting, reading, or managing emails. Available actions:
- draft-email: Draft an email (params: recipient, content, recipient_email)
- send-email: Send an email (params: recipient_id, subject, message)
- read-email: Read an email (params: email_id)
- trash-email: Trash an email (params: email_id)
- reply-to-email: Reply to an email (params: email_id, message)
- search-emails: Search emails (params: query)
- mark-email-as-read: Mark an email as read (params: email_id)
- summarize-email: Summarize an email (params: email_id)
- fetch-emails: Fetch emails with optional filter (params: filter)

For every user command, you MUST respond with a valid JSON object. If the command matches an available action, return:
{
    "action": "<action_name>",
    "params": { <required_parameters> }
}

If the command does not match any action or you cannot understand it, return:
{
    "message": "I'm sorry, I couldn't understand your request. Please try again."
}

Examples:
- User: "Send an email to john@example.com with subject 'Meeting' and body 'Let's meet tomorrow.'"
  Response: {"action": "send-email", "params": {"recipient_id": "john@example.com", "subject": "Meeting", "message": "Let's meet tomorrow."}}
- User: "I need to send an email."
  Response: {"message": "Please provide the recipient, subject, and body of the email."}
- User: "What are my unread emails?"
  Response: {"action": "fetch-emails", "params": {"filter": "unread"}}

Always ensure your response is a valid JSON object. Do not include both "action" and "message" in the same response.
`;

// ModelProvider class for dynamic model selection with fallback
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
        const emails = await this.emailService.fetchEmails(args);
        return [
          {
            type: "text",
            text: "Emails retrieved successfully",
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
            text: "Email retrieved successfully",
            artifact: { type: "json", data: emailContent },
          },
        ];
      }
      case "trash-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        await this.emailService.trashEmail(email_id);
        return [{ type: "text", text: "Email trashed successfully" }];
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
            text: "Search results retrieved successfully",
            artifact: { type: "json", data: searchResults },
          },
        ];
      }
      case "mark-email-as-read": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        await this.emailService.markAsRead(email_id, true);
        return [{ type: "text", text: "Email marked as read successfully" }];
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
                content: `Summarize this email: ${emailContent.body}`,
              },
            ],
            temperature: 0.7,
          },
          ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "llama-3-70b"]
        );
        return [
          {
            type: "text",
            text:
              summaryResponse.result.choices[0]?.message?.content ||
              "Summary not generated",
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
            text: `Draft created successfully:\n${draftText}\nPlease review and provide the recipient's email if needed.`,
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
    console.log("[DEBUG] Raw model response:", responseContent); // Log the raw response for debugging
    let actionData;
    try {
      actionData = JSON.parse(responseContent);
      if (!actionData.action && !actionData.message) {
        console.log(
          "[DEBUG] Model response lacks action or message:",
          actionData
        );
        return [
          {
            type: "text",
            text: "I'm sorry, I couldn't understand your request. Please try again.",
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
          text: "I'm sorry, I couldn't understand your request. Please try again.",
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
      const toolResponse = await this.callTool(
        actionData.action,
        actionData.params,
        userId
      );
      return toolResponse;
    } else if (actionData.message) {
      return [{ type: "text", text: actionData.message }];
    } else {
      return [
        {
          type: "text",
          text: "I'm sorry, I couldn't understand your request. Please try again.",
        },
      ];
    }
  }
}

export default MCPServer;
