import Groq from "groq-sdk";
import EmailDraft from "../models/EmailDraft.js";
import { getDefaultModel, getModelById } from "../routes/aiModelRoutes.js";
import { ApiError, logErrorWithStyle } from "../utils/errorHandler.js";


const SYSTEM_PROMPT = `
You are an AI email assistant powered by Grok from xAI. Your primary role is to interpret user commands and perform email actions such as sending, drafting, reading, or managing emails. However, you can also engage in casual conversation if the user's message is not an email-related command.

### Available Email Actions:
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

### Response Rules:
For every user command, you MUST respond with a valid JSON object. Follow these rules:

1. **Email Action**: If the command matches an available email action, return:
   {
       "action": "<action_name>",
       "params": { <required_parameters> }
   }

2. **Casual Chat**: If the command is a casual message (e.g., greetings, questions about yourself, or general conversation), return:
   {
       "chat": "<your_response>"
   }

3. **Unrecognized Command**: If the command does not match any email action and is not suitable for casual chat, return:
   {
       "message": "I'm sorry, I couldn't understand your request. Please try again."
   }

### Email Formatting for "send-email" or "draft-email":
When handling "send-email" or "draft-email" actions, format the email body in a professional structure with:
- A greeting (e.g., "Dear [Recipient Name]" or "Hello [Recipient Name]")
- The main message content
- A closing (e.g., "Best regards," or "Sincerely,")
- A signature (e.g., the sender's name)

### Special Instructions for "count-emails":
When handling the "count-emails" action, the server will count the emails matching the filter and analyze them (e.g., list the subjects of the most recent emails). The response will be formatted as a conversational message.

### Examples:
- User: "Send an email to john@example.com with subject 'Meeting' and body 'Let's meet tomorrow.'"
  Response: {
    "action": "send-email",
    "params": {
        "recipient_id": "john@example.com",
        "subject": "Meeting",
        "message": "Dear John,\n\nLet's meet tomorrow.\n\nBest regards,\n[Your Name]"
    }
  }
- User: "Hi"
  Response: {"chat": "Hello! I'm Grok, your email assistant. How can I help you today?"}
- User: "Who are you?"
  Response: {"chat": "I'm Grok, an AI email assistant created by xAI. I can help you manage your emails or just chat if you'd like!"}
- User: "Who am I?"
  Response: {"chat": "You are the user I'm assisting! I don't have access to your personal details, but I'm here to help with your email tasks or answer any questions you have."}
- User: "What are my unread emails?"
  Response: {"action": "fetch-emails", "params": {"filter": "unread"}}
- User: "My total unread"
  Response: {"action": "count-emails", "params": {"filter": "unread"}}
- User: "I need to send an email."
  Response: {"message": "Please provide the recipient, subject, and body of the email."}

Always ensure your response is a valid JSON object. Do not include multiple response types (e.g., "action" and "chat") in the same response.
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
        return [{ type: "text", text: "Email sent successfully" }];
      }
      case "fetch-emails": {
        const { filter } = args;
        const emails = await this.emailService.fetchEmails(args);
        const totalEmails = emails.messages ? emails.messages.length : 0;

        if (totalEmails === 0) {
          return [
            {
              type: "text",
              text: `You have no ${filter || "emails"}.`,
            },
          ];
        }

        // Summarize the emails in a conversational format
        const emailSummaries = emails.messages
          .slice(0, 3)
          .map(
            (email, index) =>
              `${index + 1}. From: ${email.from}, Subject: ${
                email.subject || "No subject"
              }, Date: ${email.date}`
          )
          .join("\n");

        return [
          {
            type: "text",
            text: `You have ${totalEmails} ${filter || "email"}${
              totalEmails === 1 ? "" : "s"
            }. Here are the details of your ${
              emails.messages.length > 3 ? "3 most recent" : "recent"
            } emails:\n${emailSummaries}${
              totalEmails > 3 ? "\nLet me know if you'd like to see more!" : ""
            }`,
          },
        ];
      }
      case "count-emails": {
        const { filter } = args;
        if (!filter) throw new Error("Missing filter parameter");

        // Fetch the emails with the given filter
        const emails = await this.emailService.fetchEmails({ filter });

        // Count the total number of emails
        const totalEmails = emails.messages ? emails.messages.length : 0;

        // Analyze the emails: Get the subjects of the most recent 3 emails (if any)
        let analysis = "";
        if (totalEmails > 0) {
          const recentEmails = emails.messages.slice(0, 3); // Get up to 3 most recent emails
          const subjects = recentEmails
            .map((email) => email.subject || "No subject")
            .join(", ");
          analysis = `Here are the subjects of your ${recentEmails.length} most recent unread emails: ${subjects}.`;
        } else {
          analysis = "You have no unread emails.";
        }

        // Return the result in a conversational format
        return [
          {
            type: "text",
            text: `You have ${totalEmails} unread email${
              totalEmails === 1 ? "" : "s"
            }. ${analysis}`,
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
          ["mixtral-8x7b-32768", "llama-3-70b"]
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

    // Check if the user is confirming an email send
    if (message.toLowerCase().includes("confirm send")) {
      const pendingEmail = this.pendingEmails.get(userId);
      if (pendingEmail) {
        const toolResponse = await this.callTool(
          "send-email",
          pendingEmail,
          userId
        );
        this.pendingEmails.delete(userId); // Clear the pending email
        return toolResponse;
      } else {
        return [
          {
            type: "text",
            text: "No email pending for confirmation. Please start a new request.",
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
      if (actionData.action === "send-email") {
        // Store the email details for confirmation
        this.pendingEmails.set(userId, actionData.params);
        return [
          {
            type: "text",
            text: `Here’s the email I’ve prepared:\n\nTo: ${actionData.params.recipient_id}\nSubject: ${actionData.params.subject}\n\n${actionData.params.message}\n\nPlease confirm by saying "confirm send" to send the email, or provide changes if needed.`,
          },
        ];
      }
      const toolResponse = await this.callTool(
        actionData.action,
        actionData.params,
        userId
      );
      return toolResponse;
    } else if (actionData.chat) {
      return [{ type: "text", text: actionData.chat }];
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
