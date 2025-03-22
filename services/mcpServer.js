import Groq from "groq-sdk";
import EmailDraft from "../models/EmailDraft.js";
import { getDefaultModel, getModelById } from "../routes/aiModelRoutes.js";
import { ApiError, logErrorWithStyle } from "../utils/errorHandler.js";

const SYSTEM_PROMPT = `
You are Grok, an AI email assistant powered by xAI. Your purpose is to help users manage their emails in a natural, conversational way that feels like talking to a helpful friend.

### Conversational Style:
- Be warm, friendly, and personable - not robotic or formal
- Use natural language variations and occasional conversational elements like "hmm," "let's see," or "great question"
- Match the user's tone and energy level
- Use contractions (I'll, you're, we've) and occasional colloquialisms
- Vary your sentence structure and length for a more natural rhythm
- Express enthusiasm when appropriate ("I'd be happy to help with that!" or "Great question!")
- When presenting information, use a mix of sentence formats rather than always using lists

### Response Approach:
- Start with a direct answer to the user's question before providing details
- Acknowledge the user's needs or feelings when appropriate
- For complex tasks, briefly explain what you're doing ("I'm searching through your emails now...")
- Use casual transitions between topics ("By the way," "Also," "Speaking of that")
- End responses with a natural follow-up question or suggestion when appropriate

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
**Every response must be a valid JSON object.** Choose one of the following formats based on the context:
1. **For actions:** {"action": "<action_name>", "params": {<parameters>}, "message": "<conversational_response>"}
   - Use this when the user requests an action that requires parameters.
   - Example: {"action": "send-email", "params": {"recipient_id": "example@example.com", "subject": "Hello", "message": "Hi there!"}, "message": "I've prepared an email to example@example.com with the subject 'Hello' and message 'Hi there!'. Would you like me to send it?"}
2. **For information or summaries:** {"message": "<conversational_response>", "data": {<structured_data>}}
   - Use this when providing information or summaries that include structured data.
   - Example: {"message": "Here are the car offers I found in your emails:", "data": {"table": [{"Car Model": "Toyota Camry", "Year": "2022", "Price": "$25,000"}]}}
3. **For casual conversation or when no specific action or data is needed:** {"chat": "<your_response>"}
   - Use this for general conversation, greetings, or when no action or data is required.
   - Example: {"chat": "Hey there! How can I assist you today?"}

**Important:** Always ensure your response is a valid JSON object. Do not include any text outside of the JSON structure.

### Example Conversational Responses:
Instead of: "Here are the car offers from your emails in the last week:"
Say: "I've found several car offers in your inbox from the past week. Here's what I spotted:"

Instead of: "I've prepared an email to John about the meeting."
Say: "I've drafted a quick note to John about tomorrow's meeting. Here's what I came up with:"

Instead of: "You have 5 unread emails."
Say: "Looks like you have 5 unread messages waiting for you. Want me to give you a quick rundown?"

Always maintain your helpful capabilities while sounding more human and conversational.
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
        const confirmations = [
          "Your email has been sent!",
          "Message sent successfully.",
          "All done! Your email is on its way.",
          "Email sent. Anything else you need help with?",
          "That's taken care of - your email is on its way.",
        ];
        return [
          {
            type: "text",
            text: confirmations[
              Math.floor(Math.random() * confirmations.length)
            ],
          },
        ];
      }
      case "fetch-emails": {
        const { filter, query } = args;
        const emails = await this.emailService.fetchEmails({ filter, query });
        const analyzedData = this.analyzeEmails(emails, query || filter || "");

        let text = "";

        if (analyzedData.table) {
          const introTexts = [
            "Here's what I found in your emails:",
            "I've analyzed your emails and found these results:",
            "Based on your emails, here's what I discovered:",
            "Here's the information you requested:",
          ];

          const followUpTexts = [
            "Would you like to take any action with these results?",
            "Anything specific you'd like to know more about?",
            "Do you want me to help you respond to any of these?",
            "Is there anything else you'd like me to find?",
          ];

          const intro =
            introTexts[Math.floor(Math.random() * introTexts.length)];
          const followUp =
            followUpTexts[Math.floor(Math.random() * followUpTexts.length)];

          text = `${intro}\n\n${this.formatTable(
            analyzedData.table
          )}\n\n${followUp}`;
        } else {
          // For general email results
          const count = emails.messages.length;
          const previewCount = Math.min(count, 3);

          if (count === 0) {
            text =
              "I couldn't find any emails matching your criteria. Would you like to try a different search?";
          } else {
            text = `I found ${count} emails matching your request. Here are the most recent ${previewCount}:\n\n`;

            text += emails.messages
              .slice(0, previewCount)
              .map((e, i) => {
                const date = new Date(e.date).toLocaleDateString();
                return `**${i + 1}.** From: ${e.from}\nSubject: ${
                  e.subject || "No subject"
                }\nDate: ${date}\n${e.snippet || "No preview available"}\n`;
              })
              .join("\n");

            text += `\n\nWould you like me to open any of these emails, or search for something more specific?`;
          }
        }

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

        // More natural response about email count
        let text = "";
        if (totalEmails === 0) {
          text = `Looks like you don't have any ${filter} emails at the moment. Your inbox is all caught up!`;
        } else if (totalEmails === 1) {
          text = `You have just one ${filter} email.`;
        } else if (totalEmails < 5) {
          text = `You have ${totalEmails} ${filter} emails. That's not too many!`;
        } else if (totalEmails < 20) {
          text = `You have ${totalEmails} ${filter} emails waiting for you.`;
        } else {
          text = `Wow! You have ${totalEmails} ${filter} emails. Would you like me to help you manage them?`;
        }

        if (totalEmails > 0) {
          const recentEmails = emails.messages.slice(0, 3);
          const senders = [
            ...new Set(
              recentEmails.map((email) => email.from.split("<")[0].trim())
            ),
          ];

          if (senders.length === 1) {
            text += ` The most recent one is from ${senders[0]}.`;
          } else if (senders.length > 1) {
            text += ` Your most recent emails are from ${senders
              .slice(0, -1)
              .join(", ")} and ${senders[senders.length - 1]}.`;
          }

          text += ` Would you like me to summarize any of them for you?`;
        }

        return [
          {
            type: "text",
            text,
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
    // More flexible query matching
    const queryLower = query.toLowerCase();

    // Car offers analysis
    if (
      queryLower.includes("car") &&
      (queryLower.includes("offer") || queryLower.includes("deal"))
    ) {
      const offers = emails.messages
        .filter((email) => {
          const content = (email.subject + " " + email.body).toLowerCase();
          return (
            content.includes("car") &&
            (content.includes("offer") ||
              content.includes("deal") ||
              content.includes("sale") ||
              content.includes("price"))
          );
        })
        .map((email) => {
          // More advanced pattern matching
          const modelMatch = email.body.match(
            /(?:car|model|vehicle):?\s*(\w+\s*\w*)/i
          ) ||
            email.subject.match(/(\w+\s*\w*)\s*(?:car|model|vehicle)/i) || [
              "",
              "N/A",
            ];

          const yearMatch = email.body.match(
            /(?:year|model year):?\s*(\d{4})/i
          ) ||
            email.body.match(/(\d{4})\s*(?:car|model|vehicle)/i) || ["", "N/A"];

          const priceMatch = email.body.match(
            /(?:price|cost|value):?\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i
          ) ||
            email.body.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i) || [
              "",
              "N/A",
            ];

          return {
            "Car Model": modelMatch[1],
            Year: yearMatch[1],
            Price: priceMatch[1] === "N/A" ? "N/A" : `$${priceMatch[1]}`,
            From: email.from,
            Date: new Date(email.date).toLocaleDateString(),
            "Email ID": email.id,
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

    // Package delivery analysis
    else if (
      queryLower.includes("package") ||
      queryLower.includes("delivery") ||
      queryLower.includes("shipping")
    ) {
      const packages = emails.messages
        .filter((email) => {
          const content = (email.subject + " " + email.body).toLowerCase();
          return (
            content.includes("package") ||
            content.includes("delivery") ||
            content.includes("shipping") ||
            content.includes("tracking")
          );
        })
        .map((email) => {
          const trackingMatch = email.body.match(
            /(?:tracking|track):?\s*#?\s*([A-Z0-9]{8,})/i
          ) ||
            email.body.match(/([A-Z0-9]{8,})/i) || ["", "N/A"];

          const statusMatch = email.body.match(
            /(?:status|delivery status):?\s*(\w+\s*\w*)/i
          ) || ["", "N/A"];

          const dateMatch = email.body.match(
            /(?:delivery|arrival|expected):?\s*(?:date|by)?:?\s*(\w+\s*\d{1,2},?\s*\d{4})/i
          ) || ["", "N/A"];

          return {
            Sender: email.from,
            Subject: email.subject,
            "Tracking Number": trackingMatch[1],
            Status: statusMatch[1],
            "Delivery Date": dateMatch[1],
            "Email ID": email.id,
          };
        })
        .filter(
          (pkg) =>
            pkg["Tracking Number"] !== "N/A" ||
            pkg["Status"] !== "N/A" ||
            pkg["Delivery Date"] !== "N/A"
        );

      return { table: packages };
    }

    // Calendar events analysis
    else if (
      queryLower.includes("event") ||
      queryLower.includes("meeting") ||
      queryLower.includes("calendar")
    ) {
      const events = emails.messages
        .filter((email) => {
          const content = (email.subject + " " + email.body).toLowerCase();
          return (
            content.includes("event") ||
            content.includes("meeting") ||
            content.includes("calendar") ||
            content.includes("appointment")
          );
        })
        .map((email) => {
          const titleMatch = email.subject.match(/(.+)/) || ["", "N/A"];

          const dateMatch = email.body.match(
            /(?:date|scheduled|when):?\s*(\w+\s*\d{1,2},?\s*\d{4})/i
          ) || ["", "N/A"];

          const timeMatch = email.body.match(
            /(?:time|at):?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
          ) || ["", "N/A"];

          const locationMatch = email.body.match(
            /(?:location|place|venue):?\s*(.+?)(?:\.|,|\n|$)/i
          ) || ["", "N/A"];

          return {
            Event: titleMatch[1],
            Date: dateMatch[1],
            Time: timeMatch[1],
            Location: locationMatch[1],
            Organizer: email.from,
            "Email ID": email.id,
          };
        })
        .filter((event) => event["Date"] !== "N/A" || event["Time"] !== "N/A");

      return { table: events };
    }

    // General email analysis
    return {
      emails: emails.messages.map((email) => ({
        id: email.id,
        subject: email.subject || "No subject",
        from: email.from,
        date: new Date(email.date).toLocaleDateString(),
        snippet: email.snippet || "No preview available",
      })),
      summary: {
        totalCount: emails.messages.length,
        unreadCount: emails.messages.filter((e) => e.unread).length,
        senderBreakdown: this.getSenderBreakdown(emails.messages),
        timeDistribution: this.getTimeDistribution(emails.messages),
      },
    };
  }

  getSenderBreakdown(emails) {
    const senderCounts = {};
    emails.forEach((email) => {
      const sender = email.from;
      senderCounts[sender] = (senderCounts[sender] || 0) + 1;
    });

    return Object.entries(senderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sender, count]) => ({ sender, count }));
  }

  getTimeDistribution(emails) {
    const today = new Date();
    const oneDayAgo = new Date(today);
    oneDayAgo.setDate(today.getDate() - 1);

    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(today.getDate() - 7);

    const oneMonthAgo = new Date(today);
    oneMonthAgo.setMonth(today.getMonth() - 1);

    return {
      today: emails.filter((e) => new Date(e.date) >= oneDayAgo).length,
      thisWeek: emails.filter((e) => new Date(e.date) >= oneWeekAgo).length,
      thisMonth: emails.filter((e) => new Date(e.date) >= oneMonthAgo).length,
      older: emails.filter((e) => new Date(e.date) < oneMonthAgo).length,
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

  if (
        message.toLowerCase().includes("confirm") &&
        message.toLowerCase().includes("send")
    ) {
      // Find the last assistant message in history
      const lastAssistantMessage = history
        .slice()
        .reverse()
        .find((msg) => msg.role === "assistant")?.content;

      if (
        lastAssistantMessage &&
        lastAssistantMessage.includes("I've put together an email")
      ) {
        // Extract email details from the message
        const toMatch = lastAssistantMessage.match(/\*\*To:\*\* (.+?)\n/);
        const subjectMatch = lastAssistantMessage.match(
          /\*\*Subject:\*\* (.+?)\n/
        );
        const messageMatch = lastAssistantMessage.match(
          /\n\n(.+?)\n\nDoes this look good/
        );

        if (toMatch && subjectMatch && messageMatch) {
          const to = toMatch[1].trim();
          const subject = subjectMatch[1].trim();
          const emailMessage = messageMatch[1].trim();

          // Send the email using the extracted details
          const toolResponse = await this.callTool(
            "send-email",
            { recipient_id: to, subject, message: emailMessage },
            userId
          );
          return toolResponse;
        }
      }
      return [
        {
          type: "text",
          text: "Hmm, I don't see any draft emails ready to send. Would you like to start a new email instead?",
        },
      ];
    }

    // Context-aware message preparation
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message },
    ];

    // Add time-of-day context for more natural responses
    const hour = new Date().getHours();
    let timeContext = "";
    if (hour >= 5 && hour < 12) {
      timeContext = "It's morning, ";
    } else if (hour >= 12 && hour < 18) {
      timeContext = "It's afternoon, ";
    } else {
      timeContext = "It's evening, ";
    }

    messages.push({
      role: "system",
      content: `${timeContext}the user might appreciate a response that acknowledges their busy schedule.`,
    });

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
            text: "I'm not quite catching what you mean. Could you rephrase that for me?",
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
          text: "Sorry about that! I had a little hiccup processing your request. Mind trying again?",
        },
      ];
    }

    // Handle different response types more naturally
    if (actionData.action) {
      console.log(
        "[DEBUG] Action recognized:",
        actionData.action,
        "Params:",
        actionData.params
      );

      if (actionData.action === "send-email") {
        this.pendingEmails.set(userId, actionData.params);
        const recipientName = actionData.params.recipient_id.split("@")[0];
        return [
          {
            type: "text",
            text: `I've put together an email for ${recipientName}:\n\n**To:** ${actionData.params.recipient_id}\n**Subject:** ${actionData.params.subject}\n\n${actionData.params.message}\n\nDoes this look good? Just say "confirm send" when you're ready to send it, or let me know what you'd like to change.`,
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
      // Format structured data in a more conversational way
      const formattedTable = actionData.data.table
        ? this.formatTable(actionData.data.table)
        : "";

      // Add a variety of follow-up prompts
      const followUps = [
        "What would you like to do with this information?",
        "Anything specific you'd like to know more about?",
        "Does this help with what you were looking for?",
        "Is there anything else you'd like me to explain?",
      ];

      const randomFollowUp =
        followUps[Math.floor(Math.random() * followUps.length)];

      let text = `${actionData.message}\n\n${formattedTable}\n\n${randomFollowUp}`;
      return [{ type: "text", text }];
    } else if (actionData.chat) {
      return [{ type: "text", text: actionData.chat }];
    } else if (actionData.message) {
      return [{ type: "text", text: actionData.message }];
    } else {
      return [
        {
          type: "text",
          text: "I'm not quite sure what you're asking for. Could you give me a bit more context?",
        },
      ];
    }
  }
}

export default MCPServer;
