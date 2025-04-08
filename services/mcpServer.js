// services\mcpServer.js
import Groq from "groq-sdk";
import OpenAI from "openai";
import EmailDraft from "../models/EmailDraft.js";
import { getDefaultModel, getModelById } from "../routes/aiModelRoutes.js";
import { ApiError, logErrorWithStyle } from "../utils/errorHandler.js";
import { convert } from "html-to-text";
import { SYSTEM_PROMPT } from "../helper/aiTraining.js";
import SystemMessage from "../models/SystemMessage.js";

class ModelProvider {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.retryCount = 3;
    this.retryDelay = 500;
    this.maxRetryDelay = 1000;
  }

  async callWithFallbackChain(primaryModelId, options, fallbackChain = []) {
    if (!options || !options.messages) {
      throw new ApiError(500, "Invalid options for model call");
    }
    const completeChain = [primaryModelId, ...fallbackChain];
    let lastError = null;

    for (const currentModelId of completeChain) {
      try {
        const model = await getModelById(currentModelId);
        if (!model) {
          console.warn(`Model ${currentModelId} not found, skipping`);
          continue;
        }
        console.log(`Attempting to use model: ${model.name}`);
        const { result, tokenCount } = await this.callModelWithRetry(
          model,
          options
        );
        console.log(`Successfully used model: ${model.name}`);
        return {
          result,
          tokenCount,
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

  async callModelWithRetry(model, options) {
    if (!options || !options.messages) {
      throw new ApiError(500, "Invalid options for model retry");
    }
    const requestOptions = {
      ...options,
      model: model.id,
    };

    let attemptCount = 0;
    let lastError = null;
    let currentRetryDelay = this.retryDelay;

    while (attemptCount < this.retryCount) {
      try {
        let result;
        if (model.provider === "groq") {
          result = await this.groq.chat.completions.create(requestOptions);
        } else if (model.provider === "openai") {
          result = await this.openai.chat.completions.create(requestOptions);
        } else {
          throw new ApiError(400, `Unsupported provider: ${model.provider}`);
        }
        // Extract token usage (specific to provider response structure)
        const tokenCount =
          model.provider === "groq"
            ? result.usage?.total_tokens || 0 // Groq might differ; adjust based on actual response
            : result.usage?.total_tokens || 0; // OpenAI standard
        return { result, tokenCount };
      } catch (error) {
        lastError = error;
        attemptCount++;
        if (attemptCount < this.retryCount) {
          console.warn(
            `Attempt ${attemptCount} failed for model ${model.id}, retrying after ${currentRetryDelay}ms`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, currentRetryDelay)
          );
          currentRetryDelay = Math.min(
            currentRetryDelay * 2,
            this.maxRetryDelay
          );
        }
      }
    }
    throw new ApiError(
      503,
      `Model ${model.id} failed after ${this.retryCount} attempts: ${
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
    this.lastListedEmails = new Map();
  }

  async getDefaultSystemMessage() {
    const defaultMessage = await SystemMessage.findOne({ isDefault: true });
    if (!defaultMessage) {
      throw new ApiError(
        500,
        "No default system message found in the database"
      );
    }
    return defaultMessage.content || SYSTEM_PROMPT;
  }

  processQuery(query) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    query = query.replace(/today/g, `${year}/${month}/${day}`);

    if (query.toLowerCase().includes("this week")) {
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      const weekYear = startOfWeek.getFullYear();
      const weekMonth = String(startOfWeek.getMonth() + 1).padStart(2, "0");
      const weekDay = String(startOfWeek.getDate()).padStart(2, "0");
      query = query.replace(
        /this week/i,
        `${weekYear}/${weekMonth}/${weekDay}`
      );
    }

    if (query.toLowerCase().includes("this month")) {
      query = query.replace(/this month/i, `${year}/${month}/01`);
    }

    return query;
  }

  preprocessMessage(message, userId) {
    const lastListed = this.lastListedEmails.get(userId);
    if (!lastListed) return message;

    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes("the first email") ||
      lowerMessage.includes("email 1")
    ) {
      if (lastListed.length >= 1) {
        return message.replace(
          /the first email|email 1/i,
          `email ${lastListed[0].id}`
        );
      }
    } else if (lowerMessage.includes("email 2")) {
      if (lastListed.length >= 2) {
        return message.replace(/email 2/i, `email ${lastListed[1].id}`);
      }
    } else if (lowerMessage.includes("email 3")) {
      if (lastListed.length >= 3) {
        return message.replace(/email 3/i, `email ${lastListed[2].id}`);
      }
    }
    return message;
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
          "Your email’s been sent off!",
          "Message delivered successfully!",
          "All set! Your email’s on its way.",
          "Email sent! What else can I do for you?",
          "Done! Your email’s heading to **" + recipient_id + "** now.",
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
        const {
          filter = "all",
          query = "",
          maxResults = 500,
          summarize = false,
        } = args;
        let processedQuery = query ? this.processQuery(query) : "";
        const emails = await this.emailService.fetchEmails({
          filter,
          query: processedQuery,
          maxResults,
        });

        if (!emails || !Array.isArray(emails.messages)) {
          console.error("[ERROR] fetchEmails returned invalid data:", emails);
          return [
            {
              type: "text",
              text: "Sorry, I couldn’t fetch your emails right now. Want to try again?",
            },
          ];
        }

        const analyzedData = this.analyzeEmails(
          emails,
          processedQuery || filter || ""
        );

        let text = "";
        if (analyzedData.table) {
          const introTexts = [
            "Here’s what I dug up from your emails:",
            "I’ve sifted through your inbox and found this:",
            "Check out what I discovered in your emails:",
            "Here’s the scoop from your inbox:",
          ];
          const followUpTexts = [
            "What do you want to do with these?",
            "Anything catch your eye here?",
            "Need help with any of these?",
            "What’s next on your mind?",
          ];
          const intro =
            introTexts[Math.floor(Math.random() * introTexts.length)];
          const followUp =
            followUpTexts[Math.floor(Math.random() * followUpTexts.length)];
          text = `${intro}\n\n${this.formatTable(
            analyzedData.table
          )}\n\n${followUp}`;
        } else {
          const count = emails.messages.length;
          const previewCount = Math.min(count, 10);
          if (count === 0) {
            // Updated response messages
            const noEmailResponses = [
              "Your INBOX seems empty. Want to check Sent or Archived emails instead?",
              "No emails found in your INBOX. How about trying Sent, Drafts, or another folder?",
              "Looks like your INBOX is clear. Should I fetch from All Mail or another label?",
            ];
            text =
              noEmailResponses[
                Math.floor(Math.random() * noEmailResponses.length)
              ];
          } else {
            const foundEmailsTexts = [
              `Found **${count} emails** that match. Here’s a peek at the latest **${previewCount}**:`,
              `Got **${count} emails** for you. Here are the top **${previewCount}**:`,
              `I’ve tracked down **${count} emails**. Check out the most recent **${previewCount}**:`,
            ];
            text =
              foundEmailsTexts[
                Math.floor(Math.random() * foundEmailsTexts.length)
              ] + "\n\n";
            const previewEmails = emails.messages.slice(0, previewCount);

            if (summarize) {
              const summaryPromises = previewEmails.map(async (email) => {
                const summaryResponse = await this.callTool(
                  "summarize-email",
                  { email_id: email.id },
                  userId
                );
                const summaryText = summaryResponse[0].text;
                const parts = summaryText.split(": **");
                if (parts.length > 1) {
                  return parts[1].replace("**", "").trim();
                } else {
                  return "No summary available.";
                }
              });
              const summaries = await Promise.all(summaryPromises);
              text += previewEmails
                .map((e, i) => {
                  const date = new Date(e.date).toLocaleDateString();
                  return `**${i + 1}.** **From:** ${e.from}\n**Subject:** ${
                    e.subject || "No subject"
                  }\n**Date:** ${date}\n**ID:** ${e.id}\n**Summary:** ${
                    summaries[i]
                  }\n`;
                })
                .join("\n");
            } else {
              text += previewEmails
                .map((e, i) => {
                  const date = new Date(e.date).toLocaleDateString();
                  return `**${i + 1}.** **From:** ${e.from}\n**Subject:** ${
                    e.subject || "No subject"
                  }\n**Date:** ${date}\n**ID:** ${e.id}\n${
                    e.snippet || "No preview available"
                  }\n`;
                })
                .join("\n");
            }
            const followUps = [
              summarize
                ? "Anything else I can help with?"
                : "Want me to summarize any of these for you?",
              "Should I open one up or refine the search?",
              "Anything here you’d like to explore further?",
            ];
            text += `\n\n${
              followUps[Math.floor(Math.random() * followUps.length)]
            }`;
            this.lastListedEmails.set(userId, previewEmails);
          }
        }
        return [
          { type: "text", text, artifact: { type: "json", data: emails } },
        ];
      }

      case "count-emails": {
        const { filter } = args;
        if (!filter) throw new Error("Missing filter parameter");
        const emails = await this.emailService.fetchEmails({ filter });
        const totalEmails = emails.messages ? emails.messages.length : 0;

        let text = "";
        if (totalEmails === 0) {
          const noEmailResponses = [
            `No **${filter} emails** right now. You’re all caught up!`,
            `Your **${filter} emails** count is zero. Nice and clean!`,
            `Looks like there aren’t any **${filter} emails**. You’re good!`,
          ];
          text =
            noEmailResponses[
              Math.floor(Math.random() * noEmailResponses.length)
            ];
        } else if (totalEmails === 1) {
          const singleEmailResponses = [
            `Just **one ${filter} email** in your inbox.`,
            `You’ve got a single **${filter} email** waiting.`,
            `Only **one ${filter} email** to deal with.`,
          ];
          text =
            singleEmailResponses[
              Math.floor(Math.random() * singleEmailResponses.length)
            ];
        } else if (totalEmails < 5) {
          const fewEmailsResponses = [
            `You’ve got **${totalEmails} ${filter} emails**. Not too bad!`,
            `There are **${totalEmails} ${filter} emails**—a light load!`,
            `Just **${totalEmails} ${filter} emails**. Easy peasy!`,
          ];
          text =
            fewEmailsResponses[
              Math.floor(Math.random() * fewEmailsResponses.length)
            ];
        } else if (totalEmails < 20) {
          const someEmailsResponses = [
            `You’ve got **${totalEmails} ${filter} emails**. A bit to handle there!`,
            `There are **${totalEmails} ${filter} emails** waiting. Need a hand?`,
            `Looks like **${totalEmails} ${filter} emails** are piling up.`,
          ];
          text =
            someEmailsResponses[
              Math.floor(Math.random() * someEmailsResponses.length)
            ];
        } else {
          const manyEmailsResponses = [
            `Wow, you’ve got **${totalEmails} ${filter} emails**! That’s a lot—want help sorting them?`,
            `There’s a hefty **${totalEmails} ${filter} emails** in there. Let’s tackle them together?`,
            `You’re up to **${totalEmails} ${filter} emails**. How can I assist with this stack?`,
          ];
          text =
            manyEmailsResponses[
              Math.floor(Math.random() * manyEmailsResponses.length)
            ];
        }
        if (totalEmails > 0) {
          const recentEmails = emails.messages.slice(0, 3);
          const senders = [
            ...new Set(
              recentEmails.map((email) => email.from.split("<")[0].trim())
            ),
          ];
          if (senders.length === 1) {
            text += ` The latest is from **${senders[0]}**.`;
          } else if (senders.length > 1) {
            text += ` Recent ones are from **${senders
              .slice(0, -1)
              .join(", ")}** and **${senders[senders.length - 1]}**.`;
          }
          const followUps = [
            "Want a quick summary of any?",
            "Should I break down one for you?",
            "Need details on any of these?",
          ];
          text += ` ${followUps[Math.floor(Math.random() * followUps.length)]}`;
        }
        return [{ type: "text", text }];
      }
      case "read-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        const emailContent = await this.emailService.getEmail(email_id);
        const readIntros = [
          "Here’s that email you wanted:",
          "Pulled up the email for you:",
          "Got the email right here:",
        ];
        return [
          {
            type: "text",
            text: readIntros[Math.floor(Math.random() * readIntros.length)],
            artifact: { type: "json", data: emailContent },
          },
        ];
      }
      case "trash-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        await this.emailService.trashEmail(email_id);
        const trashConfirmations = [
          "Moved that email to the trash for you!",
          "Email’s trashed—gone for good!",
          "That one’s in the trash now. All set?",
        ];
        return [
          {
            type: "text",
            text: trashConfirmations[
              Math.floor(Math.random() * trashConfirmations.length)
            ],
          },
        ];
      }
      case "reply-to-email": {
        const { email_id, message, attachments = [] } = args;

        if (email_id === "latest" || email_id === "latest_meeting_mail") {
          try {
            const recentEmails = await this.emailService.fetchEmails({
              query: "meeting OR event OR calendar",
              limit: 10,
            });

            if (recentEmails.messages.length === 0) {
              const noMeetingResponses = [
                "Couldn’t find any recent meeting emails. Got more details to narrow it down?",
                "No meeting emails popped up. Want to try something else?",
                "Looks like there’s no recent meeting mail. What else can I check?",
              ];
              return [
                {
                  type: "text",
                  text: noMeetingResponses[
                    Math.floor(Math.random() * noMeetingResponses.length)
                  ],
                },
              ];
            }

            const latestMeetingEmail = recentEmails.messages[0];

            if (!message || message.trim() === "") {
              const emailDetailsResponses = [
                `Found a meeting email from **${latestMeetingEmail.from}** with the subject "**${latestMeetingEmail.subject}**". What’s your reply?`,
                `Here’s a recent one from **${latestMeetingEmail.from}**: "**${latestMeetingEmail.subject}**". How should I respond?`,
                `Got this meeting email from **${latestMeetingEmail.from}**—subject: "**${latestMeetingEmail.subject}**". What do you want to say?`,
              ];
              return [
                {
                  type: "text",
                  text: emailDetailsResponses[
                    Math.floor(Math.random() * emailDetailsResponses.length)
                  ],
                  artifact: { type: "json", data: latestMeetingEmail },
                },
              ];
            }

            await this.emailService.replyToEmail(latestMeetingEmail.id, {
              body: message,
              attachments,
            });

            const replySentResponses = [
              `Sent your reply to **${latestMeetingEmail.from}**’s meeting email!`,
              `Reply’s off to **${latestMeetingEmail.from}**—all done!`,
              `Your response to **${latestMeetingEmail.from}**’s meeting mail is on its way!`,
            ];
            return [
              {
                type: "text",
                text: replySentResponses[
                  Math.floor(Math.random() * replySentResponses.length)
                ],
              },
            ];
          } catch (error) {
            console.error("Error in latest email retrieval:", error);
            const errorResponses = [
              "Oops, hit a snag finding that latest meeting email. Can you give me more to work with?",
              "Something went wrong grabbing your latest meeting mail. More details, maybe?",
              "Couldn’t fetch that meeting email—sorry! What else can I try?",
            ];
            return [
              {
                type: "text",
                text: errorResponses[
                  Math.floor(Math.random() * errorResponses.length)
                ],
              },
            ];
          }
        }

        if (!email_id || !message)
          throw new Error("Missing required parameters");

        await this.emailService.replyToEmail(email_id, {
          body: message,
          attachments,
        });

        const replyConfirmations = [
          "Your reply’s on its way!",
          "Sent that response off for you!",
          "Reply delivered—anything else?",
        ];
        return [
          {
            type: "text",
            text: replyConfirmations[
              Math.floor(Math.random() * replyConfirmations.length)
            ],
          },
        ];
      }
      case "search-emails": {
        const { query } = args;
        if (!query) throw new Error("Missing query parameter");
        const processedQuery = this.processQuery(query);
        const searchResults = await this.emailService.fetchEmails({
          query: processedQuery,
        });
        const searchIntros = [
          `Here’s what I found for "**${query}**":`,
          `Search results for "**${query}**" are in!`,
          `Got these for "**${query}**":`,
        ];
        return [
          {
            type: "text",
            text: searchIntros[Math.floor(Math.random() * searchIntros.length)],
            artifact: { type: "json", data: searchResults },
          },
        ];
      }
      case "mark-email-as-read": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        await this.emailService.markAsRead(email_id, true);
        const markReadConfirmations = [
          "Marked that email as read for you!",
          "Email’s now **read**—all good!",
          "That one’s checked off as read!",
        ];
        return [
          {
            type: "text",
            text: markReadConfirmations[
              Math.floor(Math.random() * markReadConfirmations.length)
            ],
          },
        ];
      }
      case "summarize-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID");

        let emailContent;
        try {
          emailContent = await this.emailService.getEmail(email_id);

          if (!emailContent.body || emailContent.body.trim() === "") {
            console.warn(`[WARN] Email ${email_id} has no body content.`);
            return [
              {
                type: "text",
                text: "Snippet: **This email’s empty—nothing to summarize!**",
              },
            ];
          }

          const plainTextBody = emailContent.body.includes("<html")
            ? convert(emailContent.body, {
                wordwrap: false,
                ignoreHref: true,
                ignoreImage: true,
                preserveNewlines: true,
                formatters: {
                  block: (elem, walk, builder) => {
                    if (elem.name === "p" || elem.name === "div") {
                      builder.addBlock(
                        elem.children ? walk(elem.children) : elem.text
                      );
                    } else if (elem.name === "table") {
                      builder.addBlock(" [Table content] ");
                    } else {
                      builder.addInline(
                        elem.children ? walk(elem.children) : elem.text
                      );
                    }
                  },
                },
              })
            : emailContent.body;

          const cleanedText = plainTextBody.replace(/\n\s*\n/g, "\n").trim();

          const MAX_TEXT_LENGTH = 3000;
          let summaryText = cleanedText;
          if (cleanedText.length > MAX_TEXT_LENGTH) {
            summaryText =
              cleanedText.substring(0, MAX_TEXT_LENGTH) + "... (truncated)";
          }

          const aiOptions = {
            messages: [
              {
                role: "system",
                content:
                  "You are a helpful AI that summarizes emails in 1-2 concise sentences.",
              },
              {
                role: "user",
                content: `Summarize this email in 1-2 sentences: ${summaryText}`,
              },
            ],
            temperature: 1.0,
            max_tokens: 1000,
          };

          const defaultModel = await getDefaultModel();
          const summaryResponse =
            await this.modelProvider.callWithFallbackChain(
              defaultModel.id,
              aiOptions,
              ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
            );

          const summary =
            summaryResponse.result.choices[0]?.message?.content?.trim();

          if (!summary) {
            console.error(`[ERROR] No summary returned for email ${email_id}`);
            const fallbackSummary =
              emailContent.snippet ||
              emailContent.subject ||
              "No details available";
            return [
              {
                type: "text",
                text: `Snippet: **${fallbackSummary}**`,
              },
            ];
          }

          const summaryIntros = [
            `Here’s the gist: **${summary}**`,
            `Quick take: **${summary}**`,
            `In a nutshell: **${summary}**`,
          ];
          const randomIntro =
            summaryIntros[Math.floor(Math.random() * summaryIntros.length)];

          return [
            {
              type: "text",
              text: randomIntro,
            },
          ];
        } catch (error) {
          console.error(
            `[ERROR] Failed to summarize email ${email_id}:`,
            error.stack
          );
          const subject = emailContent?.subject || "No subject available";
          return [
            {
              type: "text",
              text: `Snippet: **Couldn’t summarize due to an error—here’s the subject: ${subject}**`,
            },
          ];
        }
      }
        
      case "draft-email": {
        const { recipient, content, recipient_email } = args;
        if (!recipient || !content)
          throw new Error("Missing required parameters");

        let draftText;
        const pendingDraft = this.pendingEmails.get(userId);

        // *** CHANGE START: Handle modifications while preserving format ***
        if (pendingDraft && message.toLowerCase().includes("change")) {
          // Use the existing draft as the base and apply modifications cleanly
          
          const defaultModel = await getDefaultModel();
          const modificationPrompt = `Modify the following email draft based on the user's request: "${message}". Keep the original structure intact, including line breaks and formatting, and only update the requested parts.\n\nOriginal Draft:\nTo: ${pendingDraft.recipient_id}\nSubject: ${pendingDraft.subject}\n\n${pendingDraft.message}\n\nProvide the updated draft in the same format with "To:", "Subject:", and the body separated by newlines.`;
          const modificationResponse =
            await this.modelProvider.callWithFallbackChain(
              defaultModel.id,
              {
                messages: [
                  {
                    role: "user",
                    content: modificationPrompt,
                  },
                ],
                temperature: 1.0,
                max_tokens: 3000,
              },
              ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
            );
          draftText =
            modificationResponse.result.choices[0]?.message?.content ||
            "Draft not generated";
          // Ensure the modified draft retains proper structure
          const lines = draftText.split("\n");
          const toIndex = lines.findIndex((line) => line.startsWith("To:"));
          const subjectIndex = lines.findIndex((line) =>
            line.startsWith("Subject:")
          );
          if (toIndex !== -1 && subjectIndex !== -1 && subjectIndex > toIndex) {
            const subject = lines[subjectIndex].replace("Subject:", "").trim();
            const body = lines
              .slice(subjectIndex + 1)
              .join("\n")
              .trim();
            draftText = `To: ${lines[toIndex]
              .replace("To:", "")
              .trim()}\nSubject: ${subject}\n\n${body}`;
          }
          // *** CHANGE END ***
        } else {
          // Create new draft (unchanged from original)
          const defaultModel = await getDefaultModel();
          const userName = this.emailService.user.name || "Your Name";
          const prompt = `Draft a polite and professional email from ${userName} to ${recipient} based on the following message: "${content}". Include a suitable subject line starting with 'Subject:'. If the message is brief, expand it into a complete email body with appropriate greetings, context, and a sign-off using the sender's name "${userName}". Ensure the email is clear, courteous, and professional.`;
          const draftResponse = await this.modelProvider.callWithFallbackChain(
            defaultModel.id,
            {
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
              temperature: 1.0,
              max_tokens: 3000,
            },
            ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
          );
          draftText =
            draftResponse.result.choices[0]?.message?.content ||
            "Draft not generated";
        }

        const subjectMatch = draftText.match(/Subject:\s*(.+?)(?=\n|$)/);
        const subject = subjectMatch ? subjectMatch[1].trim() : "No subject";
        const body = draftText.split("\n").slice(1).join("\n").trim();

        this.pendingEmails.set(userId, {
          recipient_id: recipient_email || recipient,
          subject,
          message: body,
        });

        await EmailDraft.create({
          userId,
          recipientId: recipient_email || recipient,
          subject,
          message: body,
          status: "draft",
        });

        const draftResponses = [
          `I've prepared an email for **${recipient}**:\n\n**To:** ${
            recipient_email || recipient
          }\n**Subject:** ${subject}\n\n${body}\n\nDoes this look good? Let me know if you'd like any changes before sending. Or do you want to send it now? just say **"confirm send"** it`,

          `Here's a draft email for **${recipient}**:\n\n**To:** ${
            recipient_email || recipient
          }\n**Subject:** ${subject}\n\n${body}\n\nWhat do you think? Is it ready to send or would you like to make adjustments?. Or do you want to send it now? just say **"confirm send"** it`,

          `I've drafted an email for **${recipient}**:\n\n**To:** ${
            recipient_email || recipient
          }\n**Subject:** ${subject}\n\n${body}\n\nPlease review and let me know if this works for you or if any changes are needed. Just confirm me when you're ready to send. write **"confirm send"** to send it`,
          `Here's a draft email for **${recipient}**:\n\n**To:** ${
            recipient_email || recipient
          }\n**Subject:** ${subject}\n\n${body}\n\nLet me know if you want to send it as is or if you need to tweak anything. Or do you want to send it now? just say **"confirm sent"** it`,
        ];
        return [
          {
            type: "text",
            text: draftResponses[
              Math.floor(Math.random() * draftResponses.length)
            ],
          },
        ];
      }
        
  //       case "draft-email": {
  //       const { recipient, content, recipient_email } = args;
  //       if (!recipient || !content)
  //         throw new Error("Missing required parameters");

  //       const userName = this.emailService.user.name || "Your Name"; // Fallback to "User" if name is missing
  //       const prompt = `Draft a polite and professional email from ${userName} to ${recipient} based on the following message: "${content}". Include a suitable subject line starting with 'Subject:'. If the message is brief, expand it into a complete email body with appropriate greetings, context, and a sign-off using the sender's name "${userName}". Ensure the email is clear, courteous, and professional.`;

  //       const defaultModel = await getDefaultModel();
  //       const draftResponse = await this.modelProvider.callWithFallbackChain(
  //         defaultModel.id,
  //         {
  //           messages: [
  //             {
  //               role: "user",
  //               content: prompt,
  //             },
  //           ],
  //           temperature: 1.0,
  //           max_tokens: 3000,
  //         },
  //         ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
  //       );

  //       const draftText =
  //         draftResponse.result.choices[0]?.message?.content ||
  //         "Draft not generated";

  //       const subjectMatch = draftText.match(/Subject:\s*(.+?)(?=\n|$)/);
  //       const subject = subjectMatch ? subjectMatch[1].trim() : "No subject";
  //       const body = draftText.split("\n").slice(1).join("\n").trim();

  //       this.pendingEmails.set(userId, {
  //         recipient_id: recipient_email || recipient,
  //         subject,
  //         message: body,
  //       });

  //       await EmailDraft.create({
  //         userId,
  //         recipientId: recipient_email || recipient,
  //         subject,
  //         message: body,
  //         status: "draft",
  //       });

  //       const draftResponses = [
  //         `I've prepared an email for **${recipient}**:\n\n**To:** ${
  //           recipient_email || recipient
  //         }\n**Subject:** ${subject}\n\n${body}\n\nDoes this look good? Let me know if you'd like any changes before sending. Or do you want to send it now? just say **"confirm send"** it`,

  //         `Here's a draft email for **${recipient}**:\n\n**To:** ${
  //           recipient_email || recipient
  //         }\n**Subject:** ${subject}\n\n${body}\n\nWhat do you think? Is it ready to send or would you like to make adjustments?. Or do you want to send it now? just say **"confirm send"** it`,

  //         `I've drafted an email for **${recipient}**:\n\n**To:** ${
  //           recipient_email || recipient
  //         }\n**Subject:** ${subject}\n\n${body}\n\nPlease review and let me know if this works for you or if any changes are needed. Just confirm me when you're ready to send. write **"confirm send"** to send it`,
  //         `Here's a draft email for **${recipient}**:\n\n**To:** ${
  //           recipient_email || recipient
  //         }\n**Subject:** ${subject}\n\n${body}\n\nLet me know if you want to send it as is or if you need to tweak anything. Or do you want to send it now? just say **"confirm sent"** it`,
  //       ];
  //       return [
  //         {
  //           type: "text",
  //           text: draftResponses[
  //             Math.floor(Math.random() * draftResponses.length)
  //           ],
  //         },
  //       ];
  //     }
  //     default:
  //       throw new Error(`Unknown tool: ${name}`);
  //   }
  // }
        
        
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

   

  analyzeEmails(emails, query) {
    // Defensive check for undefined or missing messages
    if (!emails || !emails.messages) {
      console.error(
        "[ERROR] analyzeEmails: emails or emails.messages is undefined",
        emails
      );
      return {
        emails: [],
        summary: {
          totalCount: 0,
          unreadCount: 0,
          senderBreakdown: [],
          timeDistribution: {},
        },
      };
    }

    const queryLower = query.toLowerCase();

    if (
      queryLower.includes("car") &&
      (queryLower.includes("offer") || queryLower.includes("deal"))
    ) {
      const offers = emails.messages
        .filter((email) => {
          const content = `${email?.subject || ""} ${
            email?.body || ""
          }`.toLowerCase();
          return (
            content.includes("car") &&
            (content.includes("offer") ||
              content.includes("deal") ||
              content.includes("sale") ||
              content.includes("price"))
          );
        })
        .map((email) => {
          const modelMatch = email?.body?.match(
            /(?:car|model|vehicle):?\s*(\w+\s*\w*)/i
          ) || ["", "N/A"];
          const yearMatch = email?.body?.match(
            /(?:year|model year):?\s*(\d{4})/i
          ) || ["", "N/A"];
          const priceMatch = email?.body?.match(
            /(?:price|cost|value):?\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i
          ) || ["", "N/A"];
          return {
            "Car Model": modelMatch[1],
            Year: yearMatch[1],
            Price: priceMatch[1] === "N/A" ? "N/A" : `$${priceMatch[1]}`,
            From: email?.from || "N/A",
            Date: email?.date
              ? new Date(email.date).toLocaleDateString()
              : "N/A",
            "Email ID": email?.id || "N/A",
          };
        });
      return { table: offers };
    } else if (
      queryLower.includes("package") ||
      queryLower.includes("delivery") ||
      queryLower.includes("shipping")
    ) {
      const packages = emails.messages
        .filter((email) => {
          const content = `${email?.subject || ""} ${
            email?.body || ""
          }`.toLowerCase();
          return (
            content.includes("package") ||
            content.includes("delivery") ||
            content.includes("shipping") ||
            content.includes("tracking")
          );
        })
        .map((email) => {
          const trackingMatch = email?.body?.match(
            /(?:tracking|track):?\s*#?\s*([A-Z0-9]{8,})/i
          ) || ["", "N/A"];
          const statusMatch = email?.body?.match(
            /(?:status|delivery status):?\s*(\w+\s*\w*)/i
          ) || ["", "N/A"];
          const dateMatch = email?.body?.match(
            /(?:delivery|arrival|expected):?\s*(?:date|by)?:?\s*(\w+\s*\d{1,2},?\s*\d{4})/i
          ) || ["", "N/A"];
          return {
            Sender: email?.from || "N/A",
            Subject: email?.subject || "N/A",
            "Tracking Number": trackingMatch[1],
            Status: statusMatch[1],
            "Delivery Date": dateMatch[1],
            "Email ID": email?.id || "N/A",
          };
        });
      return { table: packages };
    } else if (
      queryLower.includes("event") ||
      queryLower.includes("meeting") ||
      queryLower.includes("calendar")
    ) {
      const events = emails.messages
        .filter((email) => {
          const content = `${email?.subject || ""} ${
            email?.body || ""
          }`.toLowerCase();
          return (
            content.includes("event") ||
            content.includes("meeting") ||
            content.includes("calendar") ||
            content.includes("appointment")
          );
        })
        .map((email) => {
          const titleMatch = email?.subject?.match(/(.+)/) || ["", "N/A"];
          const dateMatch = email?.body?.match(
            /(?:date|scheduled|when):?\s*(\w+\s*\d{1,2},?\s*\d{4})/i
          ) || ["", "N/A"];
          const timeMatch = email?.body?.match(
            /(?:time|at):?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
          ) || ["", "N/A"];
          const locationMatch = email?.body?.match(
            /(?:location|place|venue):?\s*(.+?)(?:\.|,|\n|$)/i
          ) || ["", "N/A"];
          return {
            Event: titleMatch[1],
            Date: dateMatch[1],
            Time: timeMatch[1],
            Location: locationMatch[1],
            Organizer: email?.from || "N/A",
            "Email ID": email?.id || "N/A",
          };
        });
      return { table: events };
    } else {
      return {
        emails: emails.messages.map((email) => ({
          id: email?.id || "N/A",
          subject: email?.subject || "No subject",
          from: email?.from || "N/A",
          date: email?.date ? new Date(email.date).toLocaleDateString() : "N/A",
          snippet: email?.snippet || "No preview available",
        })),
        summary: {
          totalCount: emails.messages.length,
          unreadCount: emails.messages.filter((e) => e?.unread).length,
          senderBreakdown: this.getSenderBreakdown(emails.messages),
          timeDistribution: this.getTimeDistribution(emails.messages),
        },
      };
    }
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
    return `| ${headers.join(" | ")} |\n| ${headers
      .map(() => "---")
      .join(" | ")} |\n${rows.map((row) => `| ${row} |`).join("\n")}`;
  }

  async chatWithBot(req, message, history = [], context = {}, modelId = null) {
    const userId = req.user.id;
    const userName = req.user.name || "User";
    console.log("User name:", req.user);
    console.log("User ID:", userId);
    const userEmail = req.user.email;
    const { timeContext = "", emailCount = 0, unreadCount = 0 } = context;

    const systemPrompt = await this.getDefaultSystemMessage();

    const personalizedSystemPrompt =
      systemPrompt
        .replace(/{{USER_NAME}}/g, userName)
        .replace(/{{USER_EMAIL}}/g, userEmail)
        .replace(/{{TIME_CONTEXT}}/g, timeContext)
        .replace(/{{EMAIL_COUNT}}/g, emailCount.toString())
        .replace(/{{UNREAD_COUNT}}/g, unreadCount.toString()) +
      "\n\nWhen there's a pending email draft, interpret affirmative responses like 'confirm sent', 'yes', or 'send it' as a command to send the email, returning {\"action\": \"send-email\", \"params\": {...}}. If the user says  'send draft 1' or 'send draft 2' after a list of drafts, select the corresponding draft (1 for the most recent, 2 for the second most recent) and return the same action." +
      "\n\nWhen the user uploads a file, the file content is included in the message. Analyze it directly and provide responses based on its text. Do not attempt to fetch emails or use undefined tools unless explicitly requested.";

    if (
      (message.toLowerCase().includes("confirm") &&
        (message.toLowerCase().includes("send") ||
          message.toLowerCase().includes("sent"))) ||
      message.toLowerCase().includes("confirm") ||
      message.toLowerCase().includes("confirmed") ||
      message.toLowerCase().includes("yes send it") ||
      message.toLowerCase().includes("go ahead") ||
      message.toLowerCase().includes("proceed") ||
      message.toLowerCase().includes("send it now") ||
      message.toLowerCase().includes("send draft 1") ||
      message.toLowerCase().includes("send draft 2")
    ) {
      let pendingDraft = null;
      let recentDraft = null;

      // Step 1: Try to extract draft from history (first priority)
      const lastAssistantMessage = history
        .slice()
        .reverse()
        .find((msg) => msg.role === "assistant")?.content;
      if (
        lastAssistantMessage &&
        (lastAssistantMessage.includes("Drafted something for") ||
          lastAssistantMessage.includes("I've put together an email") ||
          lastAssistantMessage.includes("Here's a draft for"))
      ) {
        const lines = lastAssistantMessage.split("\n");
        let to = null;
        let subject = null;
        let messageStartIndex = -1;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("**To:**")) {
            to = lines[i].replace("**To:**", "").trim();
          } else if (lines[i].startsWith("**Subject:**")) {
            subject = lines[i].replace("**Subject:**", "").trim();
            messageStartIndex = i + 2;
          }
        }

        if (to && subject && messageStartIndex !== -1) {
          let messageLines = [];
          for (let i = messageStartIndex; i < lines.length; i++) {
            if (
              lines[i].includes("Looks good?") ||
              lines[i].includes("What do you think—") ||
              lines[i].includes("Happy with it?") ||
              lines[i].includes("Let me know if this works")
            ) {
              break;
            }
            messageLines.push(lines[i]);
          }
          const message = messageLines.join("\n").trim();
          if (message) {
            pendingDraft = {
              recipient_id: to,
              subject: subject,
              message: message,
            };
          }
        }
      }

      const drafts = await EmailDraft.find({ userId }).sort({ createdAt: -1 });
      if (drafts.length > 1 && !pendingDraft) {
        // If user said "send draft 1" or "send draft 2", select the draft
        if (message.toLowerCase().includes("send draft 1")) {
          pendingDraft = {
            recipient_id: drafts[0].recipientId,
            subject: drafts[0].subject,
            message: drafts[0].message,
          };
        } else if (message.toLowerCase().includes("send draft 2")) {
          pendingDraft = {
            recipient_id: drafts[1].recipientId,
            subject: drafts[1].subject,
            message: drafts[1].message,
          };
        } else {
          return {
            type: "text",
            text: `I found ${drafts.length} drafts:\n1. To: ${drafts[0].recipientId}, Subject: ${drafts[0].subject}\n2. To: ${drafts[1].recipientId}, Subject: ${drafts[1].subject}\nWhich one? Say **"send draft 1"** or **"send draft 2"**.`,
            modelUsed: "N/A",
            fallbackUsed: false,
          };
        }
      }

      // Step 2: Fallback to database if history didn't provide a draft
      if (!pendingDraft) {
        const recentDraft = await EmailDraft.findOne({ userId }).sort({
          createdAt: -1,
        });
        if (recentDraft) {
          pendingDraft = {
            recipient_id: recentDraft.recipientId,
            subject: recentDraft.subject,
            message: recentDraft.message,
          };
        }
      }

      const affirmativeResponses = [
        "yes",
        "ok",
        "sure",
        "confirm",
        "send",
        "sent",
        "go ahead",
        "proceed",
      ];
      if (
        pendingDraft &&
        affirmativeResponses.some((word) =>
          message.toLowerCase().includes(word)
        )
      ) {
        try {
          const toolResponse = await this.callTool(
            "send-email",
            pendingDraft,
            userId
          );
          await EmailDraft.deleteMany({ userId: userId });
          return {
            ...toolResponse[0],
            modelUsed: modelId ? (await getModelById(modelId)).name : "N/A",
            fallbackUsed: false,
          };
        } catch (error) {
          console.error("Failed to send email:", error);
          return {
            type: "text",
            text: "Oops, something went wrong while sending the email. Please try again later.",
            modelUsed: "N/A",
            fallbackUsed: false,
          };
        }
      } else {
        const noDraftResponses = [
          "Hmm, no draft email's ready to send yet. Want to start one?",
          "Looks like there's no email queued up. Shall we draft a new one?",
          "I don't see a draft to send. How about we create one now?",
        ];
        return {
          type: "text",
          text: noDraftResponses[
            Math.floor(Math.random() * noDraftResponses.length)
          ],
          modelUsed: "N/A",
          fallbackUsed: false,
        };
      }
    }

    // Rest of the function remains unchanged
    let processedMessage = this.preprocessMessage(message, userId);
    const messages = [
      { role: "system", content: personalizedSystemPrompt },
      ...history,
      { role: "user", content: processedMessage },
    ];

    const hour = new Date().getHours();
    let timeGreeting = "";
    if (hour >= 5 && hour < 12) timeGreeting = "It's morning, ";
    else if (hour >= 12 && hour < 18) timeGreeting = "It's afternoon, ";
    else timeGreeting = "It's evening, ";
    messages.push({
      role: "system",
      content: `${timeGreeting}the user might appreciate a response that acknowledges their busy schedule.`,
    });

    let primaryModelId;
    if (modelId) {
      const selectedModel = await getModelById(modelId);
      if (!selectedModel) {
        throw new ApiError(400, `Selected model ${modelId} not found`);
      }
      primaryModelId = selectedModel.id;
    } else {
      const defaultModel = await getDefaultModel();
      primaryModelId = defaultModel.id;
    }
    const fallbackChain = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    const options = {
      messages,
      temperature: 1.0,
      response_format: { type: "json_object" },
    };

    let result, modelUsed, fallbackUsed, tokenCount;
    try {
      const response = await this.modelProvider.callWithFallbackChain(
        primaryModelId,
        options,
        fallbackChain
      );
      result = response.result;
      modelUsed = response.modelUsed;
      fallbackUsed = response.fallbackUsed;
      tokenCount = response.tokenCount; // Capture token count
    } catch (error) {
      console.error("Model call failed completely:", error);
      return {
        type: "text",
        text: "I'm having trouble connecting right now. Could you try again in a moment?",
        modelUsed: "N/A",
        fallbackUsed: false,
        tokenCount: 0,
      };
    }

    const responseContent = result.choices[0]?.message?.content || "{}";

    let actionData;
    try {
      actionData = JSON.parse(responseContent);
      if (!actionData.action && !actionData.message && !actionData.chat) {
        const clarificationRequests = [
          "I'm not quite catching you—could you say that another way?",
          "Hmm, I'm a bit lost. Mind rephrasing that?",
          "Not sure I follow. Can you give me more to go on?",
        ];
        return {
          type: "text",
          text: clarificationRequests[
            Math.floor(Math.random() * clarificationRequests.length)
          ],
          modelUsed: modelUsed.name || "N/A",
          fallbackUsed: fallbackUsed,
        };
      }
    } catch (error) {
      console.error(
        "[ERROR] Failed to parse model response as JSON:",
        error.message,
        "Response:",
        responseContent
      );
      const errorResponses = [
        "Oops! Hit a snag there—mind trying that again?",
        "Something went wonky on my end. Could you repeat it?",
        "Sorry, I tripped up! Can you give it another shot?",
      ];
      return {
        type: "text",
        text: errorResponses[Math.floor(Math.random() * errorResponses.length)],
        modelUsed: modelUsed.name || "N/A",
        fallbackUsed: fallbackUsed,
      };
    }

    if (actionData.action) {
      if (actionData.action === "send-email") {
        this.pendingEmails.set(userId, actionData.params);
        const recipientName = actionData.params.recipient_id.split("@")[0];
        const draftResponses = [
          `I've put together an email for **${recipientName}**:\n\n**To:** ${actionData.params.recipient_id}\n**Subject:** ${actionData.params.subject}\n\n${actionData.params.message}\n\nLooks okay? Say **"confirm send"** to send it, or let me know what to tweak!`,
          `Here's an email draft for **${recipientName}**:\n\n**To:** ${actionData.params.recipient_id}\n**Subject:** ${actionData.params.subject}\n\n${actionData.params.message}\n\nGood to go? Just say **"confirm send"**, or tell me what's off!`,
          `Drafted something for **${recipientName}**:\n\n**To:** ${actionData.params.recipient_id}\n**Subject:** ${actionData.params.subject}\n\n${actionData.params.message}\n\nHappy with it? Say **"confirm send"** or suggest changes!`,
        ];
        return {
          type: "text",
          text: draftResponses[
            Math.floor(Math.random() * draftResponses.length)
          ],
          modelUsed: modelUsed.name || "N/A",
          fallbackUsed: fallbackUsed,
        };
      }
      try {
        const toolResponse = await this.callTool(
          actionData.action,
          actionData.params,
          userId
        );
        return {
          ...toolResponse[0],
          modelUsed: modelUsed.name || "N/A",
          fallbackUsed: fallbackUsed,
        };
      } catch (error) {
        // Handle unknown tool or other errors
        if (error.message && error.message.includes("Unknown tool")) {
          const summaryPrompt = `Please summarize the following text:\n\n${processedMessage}`;
          try {
            const summaryResponse =
              await this.modelProvider.callWithFallbackChain(
                primaryModelId,
                {
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are a helpful assistant that summarizes text.",
                    },
                    { role: "user", content: summaryPrompt },
                  ],
                  temperature: 1.0,
                  max_tokens: 1000,
                },
                fallbackChain
              );
            const summary =
              summaryResponse.result.choices[0]?.message?.content ||
              "Unable to summarize the content.";
            return {
              type: "text",
              text: `I couldn't use the specified tool, but here's a summary of the provided content: ${summary}`,
              modelUsed: modelUsed.name || "N/A",
              fallbackUsed: fallbackUsed,
            };
          } catch (summaryError) {
            console.error("Failed to generate summary:", summaryError);
            return {
              type: "text",
              text: "I couldn't use the requested tool and also had trouble summarizing the content. Can you try a different approach?",
              modelUsed: modelUsed.name || "N/A",
              fallbackUsed: fallbackUsed,
            };
          }
        } else {
          console.error("Tool call failed:", error);
          return {
            type: "text",
            text: "I encountered an error while trying to process your request. Can you try again?",
            modelUsed: modelUsed.name || "N/A",
            fallbackUsed: fallbackUsed,
          };
        }
      }
    } else if (actionData.message && actionData.data) {
      const formattedTable = actionData.data.table
        ? this.formatTable(actionData.data.table)
        : "";
      const followUps = [
        "What's your next step with this?",
        "Anything here you want to dive into?",
        "Does this cover what you needed?",
        "Need me to expand on anything?",
      ];
      const randomFollowUp =
        followUps[Math.floor(Math.random() * followUps.length)];
      let text = `${actionData.message}\n\n${formattedTable}\n\n${randomFollowUp}`;
      return {
        type: "text",
        text: fallbackUsed
          ? `⚠️ The selected model is unavailable due to quota limits. Using fallback instead.\n\n${text}`
          : text,
        modelUsed: modelUsed.name || "N/A",
        fallbackUsed: fallbackUsed,
        tokenCount: tokenCount || 0,
      };
    } else if (actionData.chat) {
      return {
        type: "text",
        text: fallbackUsed
          ? `⚠️ The selected model is unavailable due to quota limits. Using fallback instead.\n\n${actionData.chat}`
          : actionData.chat,
        modelUsed: modelUsed.name || "N/A",
        fallbackUsed: fallbackUsed,
        tokenCount: tokenCount || 0, // Include token count
      };
    } else if (actionData.message) {
      return {
        type: "text",
        text: fallbackUsed
          ? `⚠️ The selected model is unavailable due to quota limits. Using fallback instead.\n\n${actionData.message}`
          : actionData.message,
        modelUsed: modelUsed.name || "N/A",
        fallbackUsed: fallbackUsed,
        tokenCount: tokenCount || 0,
      };
    } else {
      // Default fallback if no recognized response format
      const clarificationRequests = [
        "Not sure what you're after—can you fill me in more?",
        "I'm a tad confused—could you clarify that?",
        "Hmm, what do you mean? Give me a nudge!",
      ];
      return {
        type: "text",
        text: clarificationRequests[
          Math.floor(Math.random() * clarificationRequests.length)
        ],
        modelUsed: modelUsed.name || "N/A",
        fallbackUsed: fallbackUsed,
      };
    }
  }
}

export default MCPServer;
