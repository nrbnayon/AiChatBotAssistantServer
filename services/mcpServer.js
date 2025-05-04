// services\mcpServer.js
import Groq from "groq-sdk";
import OpenAI from "openai";
import EmailDraft from "../models/EmailDraft.js";
import { getDefaultModel, getModelById } from "../routes/aiModelRoutes.js";
import { ApiError, logErrorWithStyle } from "../utils/errorHandler.js";
import { convert } from "html-to-text";
import { SYSTEM_PROMPT } from "../helper/aiTraining.js";
import SystemMessage from "../models/SystemMessage.js";

const STANDARD_FALLBACK_CHAIN = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gpt-4o",
  "gemma2-9b-it",
  "llama3-70b-8192",
  "gpt-4o-mini",
];

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
class ModelProvider {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.retryCount = 1;
    this.retryDelay = 200;
    this.maxRetryDelay = 500;
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
        const tokenCount =
          model.provider === "groq"
            ? result.usage?.total_tokens || 0
            : result.usage?.total_tokens || 0;
        return { result, tokenCount };
      } catch (error) {
        lastError = error;
        if (
          error.message?.includes("429") ||
          error.message?.includes("rate_limit_exceeded")
        ) {
          throw error;
        }
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

  async callWithFallbackChain(primaryModelId, options, fallbackChain = []) {
    if (!options || !options.messages) {
      throw new ApiError(500, "Invalid options for model call");
    }
    const completeChain = [
      primaryModelId,
      ...fallbackChain.filter((id) => id !== primaryModelId),
    ];
    let lastError = null;

    const primaryModel = await getModelById(primaryModelId);
    if (primaryModel) {
      // console.log(`Attempting to use primary model: ${primaryModel.name}`);
      let attemptCount = 0;
      let currentRetryDelay = this.retryDelay;
      while (attemptCount < this.retryCount) {
        try {
          const { result, tokenCount } = await this.callModelWithRetry(
            primaryModel,
            options
          );
          // console.log(`Successfully used primary model: ${primaryModel.name}`);
          return {
            result,
            tokenCount,
            modelUsed: primaryModel,
            fallbackUsed: false,
          };
        } catch (error) {
          lastError = error;
          if (
            error.message?.includes("429") ||
            error.message?.includes("rate_limit_exceeded")
          ) {
            // console.log(
            //   "Rate limit error detected, stopping retries for primary model"
            // );
            break;
          }
          attemptCount++;
          if (attemptCount < this.retryCount) {
            console.warn(
              `Attempt ${attemptCount} failed for model ${primaryModel.id}, retrying after ${currentRetryDelay}ms`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, currentRetryDelay)
            );
            currentRetryDelay *= 2;
          }
        }
      }
    }

    // Fallback chain if primary model fails
    for (const currentModelId of completeChain.slice(1)) {
      try {
        const model = await getModelById(currentModelId);
        if (!model) {
          console.warn(`Model ${currentModelId} not found, skipping`);
          continue;
        }
        // console.log(`Attempting to use fallback model: ${model.name}`);
        const { result, tokenCount } = await this.callModelWithRetry(
          model,
          options
        );
        // console.log(`Successfully used fallback model: ${model.name}`);
        return {
          result,
          tokenCount,
          modelUsed: model,
          fallbackUsed: true,
        };
      } catch (error) {
        lastError = error;
        logErrorWithStyle(error);
        console.warn(`Fallback model ${currentModelId} failed, trying next`);
      }
    }
    throw new ApiError(
      503,
      `All models in the fallback chain failed: ${
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
    this.lastEmailId = null;
    this.callTool = this.callTool.bind(this);
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
    if (lowerMessage.includes("this emails")) {
      // Replace "this emails" with comma-separated IDs of last listed emails
      const emailIds = lastListed.map((e) => e.id).join(", ");
      return message.replace(/this\s+emails?/i, `emails ${emailIds}`);
    } else if (
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

  async callTool(name, args, userId, modelId = null) {
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
          maxResults,
          pageToken,
          timeFilter,
          summarize = false,
        } = args;

        let processedQuery = query ? this.processQuery(query) : "";
        // Enhanced search to handle sender variations
        if (processedQuery.toLowerCase().includes("from:")) {
          processedQuery = processedQuery.replace(/from:/i, "").trim();
        }

        const emails = await this.emailService.fetchEmails({
          filter,
          query: processedQuery,
          maxResults,
          pageToken,
          timeFilter,
        });

        if (!emails || !Array.isArray(emails.messages)) {
          console.error("[ERROR] fetchEmails returned invalid data:", emails);
          return [
            {
              type: "text",
              text: "Sorry, I couldn't fetch your emails right now. Want to try again?",
            },
          ];
        }

        // Restore the email analysis functionality
        const analyzedData = this.analyzeEmails(
          emails,
          processedQuery || filter || ""
        );

        let text = "";
        // Check if we have table data from analysis
        if (analyzedData.table) {
          const introTexts = [
            "Here's what I dug up from your emails:",
            "I've sifted through your inbox and found this:",
            "Check out what I discovered in your emails:",
            "Here's the scoop from your inbox:",
          ];
          const followUpTexts = [
            "What do you want to do with these?",
            "Anything catch your eye here?",
            "Need help with any of these?",
            "What's next on your mind?",
          ];
          const intro =
            introTexts[Math.floor(Math.random() * introTexts.length)];
          const followUp =
            followUpTexts[Math.floor(Math.random() * followUpTexts.length)];
          text = `${intro}\n\n${analyzedData.table}\n\n${followUp}`;
        } else {
          const count = emails.messages.length;
          const previewCount = Math.min(count, 10);
          const previewEmails = emails.messages.slice(0, previewCount);
          // this.lastListedEmails.set(userId, previewEmails);

          // Automatically summarize if 3 or fewer emails, or if explicitly requested
          const autoSummarize = previewCount <= 3;
          const shouldSummarize = autoSummarize || summarize;

          if (count === 0) {
            const noEmailResponses = [
              `**No matching emails found**\n\nI couldn't find any emails that match your search for "${query}". You could try:\n• Using different keywords\n• Broadening your date range\n• Checking a different folder\n• Try a variation like \`from:${query}\` or \`subject:${query}\``,

              `**Your search returned no results**\n\nI searched for "${query}" but found nothing. Possible next steps:\n• Try different search terms\n• Remove some filters\n• Check for typos in names or email addresses\n• Try \`to:${query}\` if you're looking for emails sent to someone`,

              `**No emails match "${query}"**\n\nSuggestions:\n1. Use broader search terms than "${query}"\n2. Check a different time period\n3. Try searching in 'All Mail' instead`,

              `**I couldn't find any matching emails for "${query}"**\n\nThis might be because:\n• Your search was too specific\n• There might be a connection issue\n• The emails might be in another folder\n• Try alternatives like \`label:${query}\` or \`category:${query}\``,

              `**No matching results for "${query}"**\n\nLet's try a different approach:\n• Show me email \`from:${query}\` to find emails from specific people\n• Find all emails with \`subject:${query}\` to search subject lines`,
            ];
            text =
              noEmailResponses[
                Math.floor(Math.random() * noEmailResponses.length)
              ];
          } else {
            const foundEmailsTexts = [
              `Found **${count} emails** that match. Here's a peek at the latest **${previewCount}**:`,
              `Got **${count} emails** for you. Here are the top **${previewCount}**:`,
              `I've tracked down **${count} emails**. Check out the most recent **${previewCount}**:`,
            ];
            text =
              foundEmailsTexts[
                Math.floor(Math.random() * foundEmailsTexts.length)
              ] + "\n\n";

            if (shouldSummarize) {
              const summaryPromises = previewEmails.map(async (email) => {
                const summaryResponse = await this.callTool(
                  "summarize-email",
                  { email_id: email.id },
                  userId,
                  modelId
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
                  let attachmentNote = "";
                  if (e.hasAttachments) {
                    if (e.attachments && e.attachments.length > 0) {
                      // For Gmail, where attachments are available
                      const attachmentLinks = e.attachments
                        .map(
                          (att) =>
                            `[${att.filename}](https://server.inbox-buddy.ai/api/v1/emails/download/attachment?emailId=${e.id}&attachmentId=${att.id})`
                        )
                        .join(", ");
                      attachmentNote = `\n**Attachments:** **${attachmentLinks}** just click on it to download.`;
                    } else {
                      // For Outlook or when attachments aren't fetched
                      attachmentNote = `\n**Attachments:** Yes (say **show attachments for email ${
                        i + 1
                      }** to this are the download links just click on it to see them)`;
                    }
                  }
                  return `**${i + 1}.** **From:** ${e.from}\n**Subject:** ${
                    e.subject || "No subject"
                  }\n**Date:** ${date}${attachmentNote}\n**Summary:** ${
                    summaries[i]
                  }\n\n`;
                })
                .join("\n");
            } else {
              text += previewEmails
                .map((e, i) => {
                  const date = new Date(e.date).toLocaleDateString();
                  let attachmentNote = "";
                  if (e.hasAttachments) {
                    if (e.attachments && e.attachments.length > 0) {
                      // For Gmail, where attachments are available
                      const attachmentLinks = e.attachments
                        .map(
                          (att) =>
                            `[${att.filename}](https://server.inbox-buddy.ai/api/v1/emails/download/attachment?emailId=${e.id}&attachmentId=${att.id})`
                        )
                        .join(", ");
                      attachmentNote = `\n Here have **Attachments:** **${attachmentLinks}** just click on it to download.`;
                    } else {
                      // For Outlook or when attachments aren't fetched
                      attachmentNote = `\n**Attachments:** Yes (say **show attachments for email ${
                        i + 1
                      }** to see them)`;
                    }
                  }
                  return `**${i + 1}.** **From:** ${e.from}\n**Subject:** ${
                    e.subject || "No subject"
                  }\n**Date:** ${date}${attachmentNote}\n**Preview:** ${
                    e.snippet || "No preview available"
                  }\n\n`;
                })
                .join("\n");
            }

            const followUps = [
              shouldSummarize
                ? "Anything else I can help with?"
                : "Want me to summarize any of these for you?",
              "Should I open one up or refine the search?",
              "Anything here you'd like to explore further?",
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

      case "list-attachments": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID");
        const attachments = await this.emailService.getAttachments(email_id);
        if (attachments.length === 0) {
          return [{ type: "text", text: "This email has no attachments." }];
        }
        const attachmentList = attachments
          .map((att, index) => {
            const downloadLink = `https://inbox-buddy.ai/api/v1/emails/download/attachment?emailId=${email_id}&attachmentId=${att.id}`;
            return `${index + 1}. [${att.filename}](${downloadLink})`;
          })
          .join("\n");
        const text = `Here are the attachments for email ${email_id}:\n${attachmentList}\n\nClick the links to download them!`;
        return [{ type: "text", text }];
      }

      case "count-emails": {
        const { filter = "all", query = "" } = args;
        if (!filter) throw new Error("Missing filter parameter");
        const emails = await this.emailService.fetchEmails({ filter, query });
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
        const emailText = `**From:** ${emailContent.from}\n**To:** ${emailContent.to}\n**Subject:** ${emailContent.subject}\n**Date:** ${emailContent.date}\n\n${emailContent.body}`;
        const readIntros = [
          "Here’s the full email:",
          "Pulled up the email for you:",
          "Got the email right here:",
        ];
        return [
          {
            type: "text",
            text: `${
              readIntros[Math.floor(Math.random() * readIntros.length)]
            }\n\n${emailText}`,
            artifact: { type: "json", data: emailContent },
          },
        ];
      }
      case "trash-email": {
        const { email_id } = args;
        if (!email_id) throw new Error("Missing email ID parameter");
        try {
          await this.emailService.getEmail(email_id);
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
        } catch (error) {
          if (error.status === 404) {
            return [
              {
                type: "text",
                text: "Hmm, that email seems to be missing. Maybe it was already deleted or the ID is incorrect.",
              },
            ];
          }
          throw error;
        }
      }
      case "reply-to-email": {
        const { email_id, message, attachments = [] } = args;

        if (email_id === "latest" || email_id === "latest_meeting_mail") {
          try {
            const recentEmails = await this.emailService.fetchEmails({
              query: "meeting OR event OR calendar",
              limit: 20,
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
        const { query, timeFilter = "weekly" } = args; // Default to "weekly"
        if (!query) throw new Error("Missing query parameter");

        // Normalize timeFilter to YYYY/MM/DD
        let normalizedTimeFilter = timeFilter;
        if (
          timeFilter &&
          !["all", "daily", "weekly", "monthly"].includes(timeFilter)
        ) {
          if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(timeFilter)) {
            const [year, month, day] = timeFilter.split("/").map(Number);
            normalizedTimeFilter = `${year}/${String(month).padStart(
              2,
              "0"
            )}/${String(day).padStart(2, "0")}`;
            // Validate date
            const date = new Date(year, month - 1, day);
            if (
              date.getFullYear() !== year ||
              date.getMonth() + 1 !== month ||
              date.getDate() !== day
            ) {
              throw new Error(
                "Invalid date in timeFilter. Must be a valid date in 'YYYY/MM/DD' or 'YYYY/M/D' format."
              );
            }
          } else {
            throw new Error(
              "Invalid timeFilter. Must be 'all', 'daily', 'weekly', 'monthly', or a date in 'YYYY/MM/DD' or 'YYYY/M/D' format."
            );
          }
        }

        const processedQuery = this.processQuery(query);
        const searchResults = await this.emailService.fetchEmails({
          query: processedQuery,
          timeFilter,
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

          const MAX_TEXT_LENGTH = 5500;
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
            max_tokens: 5500,
          };

          const defaultModel = await getDefaultModel();
          const summaryResponse =
            await this.modelProvider.callWithFallbackChain(
              modelId || defaultModel.id,
              aiOptions,
              STANDARD_FALLBACK_CHAIN
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

      case "count-emails": {
        const { filter = "all", query = "" } = args;
        const count = await this.emailService.getEmailCount({ filter, query });
        let text = `You have **${count}** emails`;
        if (filter !== "all") text += ` that are ${filter}`;
        if (query) text += ` matching "${query}"`;
        text += ". What’s next?";
        return [{ type: "text", text }];
      }

      case "draft-email": {
        const { recipient, content, recipient_email } = args;
        if (!recipient || !content)
          throw new Error("Missing required parameters");

        let draftText;
        const pendingDraft = this.pendingEmails.get(userId);
        const modificationKeywords = [
          "change",
          "adjust",
          "adjustment",
          "modify",
          "edit",
          "update",
        ];
        if (
          pendingDraft &&
          modificationKeywords.some((keyword) =>
            message.toLowerCase().includes(keyword)
          )
        ) {
          const defaultModel = await getDefaultModel();
          const modificationPrompt = `
      Modify the following email draft based on the user's request: "${message}".
      Keep the original structure intact, including line breaks and formatting, and only update the requested parts.
      Provide the updated draft clearly with To:, Subject:, and the body separated by newlines.
      Ensure To: and Subject: are each on their own line, and the body starts after a blank line.
      
      Original Draft:
      To: ${pendingDraft.recipient_id}
      Subject: ${pendingDraft.subject}
      
      ${pendingDraft.message}
      
      Updated Draft:
    `;
          const modificationResponse =
            await this.modelProvider.callWithFallbackChain(
              defaultModel.id,
              {
                messages: [{ role: "user", content: modificationPrompt }],
                temperature: 1.0,
                max_tokens: 5500,
              },
              STANDARD_FALLBACK_CHAIN
            );
          draftText =
            modificationResponse.result.choices[0]?.message?.content ||
            "Draft not generated";

          const updatedDraftIndex = draftText.indexOf("To:");
          if (updatedDraftIndex !== -1) {
            draftText = draftText.substring(updatedDraftIndex).trim();
          }

          const lines = draftText.split("\n");
          let recipientParsed = "",
            subjectParsed = "",
            messageParsed = "";
          let currentSection = null,
            bodyStarted = false;

          for (const line of lines) {
            if (line.startsWith("To:")) {
              recipientParsed = line.replace("To:", "").trim();
              currentSection = "to";
            } else if (line.startsWith("Subject:")) {
              subjectParsed = line.replace("Subject:", "").trim();
              currentSection = "subject";
            } else if (line.trim() === "" && currentSection === "subject") {
              bodyStarted = true;
              messageParsed += "\n";
            } else if (bodyStarted || currentSection === "body") {
              messageParsed += line + "\n";
              currentSection = "body";
            }
          }
          messageParsed = messageParsed.trim();

          const updatedRecipient = recipientParsed || pendingDraft.recipient_id;
          const updatedSubject = subjectParsed || pendingDraft.subject;
          const updatedMessage = messageParsed || pendingDraft.message;

          this.pendingEmails.set(userId, {
            recipient_id: updatedRecipient,
            subject: updatedSubject,
            message: updatedMessage,
          });

          await EmailDraft.updateOne(
            { userId, status: "draft" },
            {
              recipientId: updatedRecipient,
              subject: updatedSubject,
              message: updatedMessage,
            },
            { upsert: true }
          );

          return [
            {
              type: "text",
              text: `I've updated the email draft for **${updatedRecipient}**:\n\n**To:** ${updatedRecipient}\n**Subject:** ${updatedSubject}\n\n${updatedMessage}\n\nDoes this look good? Say **"confirm send"** to send it, or let me know what else to tweak!`,
            },
          ];
        } else {
          const defaultModel = await getDefaultModel();
          const userName = this.emailService.user?.name || "Nayon Halder";
          const prompt = `Draft a polite and professional email from ${userName} to ${recipient} based on the following message: "${content}". Include a suitable subject line starting with 'Subject:'. If the message is brief, expand it into a complete email body with appropriate greetings, context, and a sign-off using the sender's name "${userName}". Ensure the email is clear, courteous, and professional.`;

          const draftResponse = await this.modelProvider.callWithFallbackChain(
            defaultModel.id,
            {
              messages: [{ role: "user", content: prompt }],
              temperature: 1.0,
              max_tokens: 5500,
            },
            STANDARD_FALLBACK_CHAIN
          );
          draftText =
            draftResponse.result.choices[0]?.message?.content ||
            "Draft not generated";

          const subjectMatch = draftText.match(/Subject:\s*(.+?)(?=\n|$)/);
          const subject = subjectMatch ? subjectMatch[1].trim() : "No subject";
          let body = "";
          const lines = draftText.split("\n");
          const subjectIndex = lines.findIndex((line) =>
            line.match(/Subject:/i)
          );
          if (subjectIndex !== -1) {
            let bodyStartIndex = subjectIndex + 1;
            while (
              bodyStartIndex < lines.length &&
              lines[bodyStartIndex].trim() === ""
            ) {
              bodyStartIndex++;
            }
            body = lines.slice(bodyStartIndex).join("\n").trim();
          } else {
            body = draftText.replace(/Subject:.*(\n|$)/, "").trim();
          }

          const recipientId = recipient_email || recipient;
          this.pendingEmails.set(userId, {
            recipient_id: recipientId,
            subject,
            message: body,
          });

          await EmailDraft.create({
            userId,
            recipientId,
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
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // Improved email analyzer with better output format selection
  // Improved email analyzer with better output format selection
  analyzeEmails(emails, query) {
    if (!emails || !emails.messages || emails.messages.length === 0) {
      return { text: "No emails found." };
    }

    const relevantEmails = emails.messages.filter((email) => {
      const content = `${email.subject || ""} ${
        email.snippet || ""
      }`.toLowerCase();
      return query
        .toLowerCase()
        .split(" ")
        .some(
          (term) => content.includes(term) && term.length > 2 // Ignore very short terms
        );
    });

    if (relevantEmails.length === 0) {
      return { text: "No matching emails found for your query." };
    }

    // Sort emails by date (newest first)
    relevantEmails.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Choose format based on number of results and query type
    if (relevantEmails.length > 5 || /schedule|appointment/i.test(query)) {
      return {
        list: this.buildDetailedList(relevantEmails),
        table: this.formatEmailTable(relevantEmails),
        summary: `Found ${relevantEmails.length} emails matching "${query}"`,
      };
    } else {
      return {
        list: this.buildDetailedList(relevantEmails),
        summary: `Found ${relevantEmails.length} emails matching "${query}"`,
      };
    }
  }

  // Build a more readable list format for smaller result sets
  buildDetailedList(emails) {
    return emails
      .map((email, index) => {
        const date = new Date(email.date).toLocaleString();
        const fromName = email.from.includes("<")
          ? email.from.split("<")[0].trim()
          : email.from;
        const fromEmail = email.from.includes("<")
          ? email.from.match(/<(.+)>/)[1]
          : email.from;

        return (
          `**${index + 1}. ${email.subject || "No Subject"}**\n` +
          `   **From:** ${fromName} (${fromEmail})\n` +
          `   **Date:** ${date}\n` +
          `   ${email.snippet || "No preview available"}\n`
        );
      })
      .join("\n\n");
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

  formatEmailTable(emails) {
    if (!emails || emails.length === 0) return "No emails available.";

    const relevantColumns = ["date", "from", "subject", "snippet"];
    const headers = {
      date: "Date",
      from: "From",
      subject: "Subject",
      snippet: "Preview",
    };

    const headerRow = `| ${relevantColumns
      .map((col) => headers[col])
      .join(" | ")} |`;
    const separator = `| :--- | :--- | :------ | :------ |`;

    const rows = emails.map((email) => {
      const date = new Date(email.date).toLocaleDateString();
      const from = email.from.includes("<")
        ? email.from.split("<")[0].trim()
        : email.from;
      const subject = this.truncateText(email.subject || "No Subject", 30);
      const preview = this.truncateText(email.body || "", 100);
      return `| ${date} | ${from} | ${subject} | ${preview} |`;
    });

    return `${headerRow}\n${separator}\n${rows.join("\n")}`;
  }

  // Helper function to truncate text with ellipsis
  truncateText(text, maxLength) {
    return text.length > maxLength
      ? text.substring(0, maxLength - 3) + "..."
      : text;
  }

  async chatWithBot(
    req,
    message,
    history = [],
    context = {},
    modelId = null,
    maxResults
  ) {
    const userId = req.user.id;
    const userName = req.user.name || "User";
    const userEmail = req.user.email;

    const {
      timeContext = "",
      emailCount = 0,
      unreadCount = 0,
      importantCount = 0,
      topImportantEmails = [],
    } = context;

    // Helper functions for response generation
    const getRandomResponse = (responses) => {
      return responses[Math.floor(Math.random() * responses.length)];
    };

    const formatErrorResponse = (error, customMessage = "") => {
      console.error(customMessage || "Error:", error);
      const errorResponses = [
        "**Something went wrong**\n\nI encountered an error while processing your request. This might be due to:\n• A temporary service disruption\n• Connection issues\n• An unsupported request type\n\nPlease try again in a moment.",
        "**Error processing request**\n\nI couldn't complete the action because:\n• The connection to your email provider might be interrupted\n• The requested information might be unavailable\n• There might be a temporary system limitation\n\nCould you try your request again?",
        "**Action couldn't be completed**\n\nI ran into a technical issue while working on your request. You could:\n1. Try again with a simpler query\n2. Refresh the page and try again\n3. Check if your email account is accessible",
        "**Request failed**\n\nI wasn't able to process that request due to a technical error. Let's try:\n• Breaking your request into smaller steps\n• Using different wording\n• Waiting a moment before trying again",
        "**Technical difficulty encountered**\n\nSorry about that! I experienced an error while trying to handle your request. This is likely a temporary issue. Please try again or try a different request.",
      ];

      return {
        type: "text",
        text: getRandomResponse(errorResponses),
        modelUsed: "N/A",
        fallbackUsed: false,
      };
    };

    const createTextResponse = (
      text,
      modelUsed = "N/A",
      fallbackUsed = false,
      tokenCount = 0
    ) => {
      return {
        type: "text",
        text,
        modelUsed:
          typeof modelUsed === "object" ? modelUsed.name || "N/A" : modelUsed,
        fallbackUsed,
        tokenCount,
      };
    };

    // Handle showing attachments
    const attachmentMatch = message.match(/show attachments for email (\d+)/i);
    if (attachmentMatch) {
      const emailNumber = parseInt(attachmentMatch[1], 10);
      const lastListed = this.lastListedEmails.get(userId);
      if (lastListed && emailNumber > 0 && emailNumber <= lastListed.length) {
        const emailId = lastListed[emailNumber - 1].id;
        try {
          const toolResponse = await this.callTool(
            "list-attachments",
            { email_id: emailId },
            userId
          );
          return {
            ...toolResponse[0],
            modelUsed: "N/A",
            fallbackUsed: false,
          };
        } catch (error) {
          return formatErrorResponse(error, "Failed to list attachments");
        }
      } else {
        return createTextResponse(
          "Sorry, I couldn't find that email. Please make sure you're referring to a recently listed email."
        );
      }
    }

    // Handle showing emails
    const readEmailMatch = message.match(/show email (\d+)/i);
    if (readEmailMatch) {
      const emailNumber = parseInt(readEmailMatch[1], 10);
      const lastListed = this.lastListedEmails.get(userId);
      if (lastListed && emailNumber > 0 && emailNumber <= lastListed.length) {
        const emailId = lastListed[emailNumber - 1].id;
        try {
          const toolResponse = await this.callTool(
            "read-email",
            { email_id: emailId },
            userId
          );
          return {
            ...toolResponse[0],
            modelUsed: "N/A",
            fallbackUsed: false,
          };
        } catch (error) {
          return formatErrorResponse(error, "Failed to read email");
        }
      } else {
        return createTextResponse(
          "Sorry, I couldn't find that email. Please make sure you're referring to a recently listed email."
        );
      }
    }

    // Create system prompt
    const systemPrompt = await this.getDefaultSystemMessage();
    const personalizedSystemPrompt =
      systemPrompt
        .replace(/{{USER_NAME}}/g, userName)
        .replace(/{{USER_EMAIL}}/g, userEmail)
        .replace(/{{TIME_CONTEXT}}/g, timeContext)
        .replace(/{{EMAIL_COUNT}}/g, emailCount.toString())
        .replace(/{{UNREAD_COUNT}}/g, unreadCount.toString()) +
      "\n\nWhen there's a pending email draft, interpret affirmative responses like 'confirm sent', 'yes', or 'send it' as a command to send the email, returning {\"action\": \"send-email\", \"params\": {...}}. If the user latest draft: say **'send draft 1'** or Old draft: say **'send draft 2'** after a list of drafts, select the corresponding draft (1 for the most recent, 2 for the second most recent) and return the same action." +
      "\n\nWhen the user uploads a file, the file content is included in the message. Analyze it directly and provide responses based on its text. Do not attempt to fetch emails or use undefined tools unless explicitly requested.";

    // Handle email sending confirmations
    const lowerCaseMessage = message.toLowerCase();
    const confirmationPhrases = [
      "confirm",
      "confirmed",
      "yes send it",
      "go ahead",
      "proceed",
      "send it now",
      "send draft 1",
      "send draft 2",
    ];
    const isConfirmation = confirmationPhrases.some((phrase) =>
      lowerCaseMessage.includes(phrase)
    );

    if (isConfirmation) {
      let pendingDraft = null;

      // Check for draft in last assistant message
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

        // Parse email components from last message
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
            const endMarkers = [
              "Looks good?",
              "What do you think—",
              "Happy with it?",
              "Let me know if this works",
            ];
            if (endMarkers.some((marker) => lines[i].includes(marker))) {
              break;
            }
            messageLines.push(lines[i]);
          }
          const messageContent = messageLines.join("\n").trim();
          if (messageContent) {
            pendingDraft = {
              recipient_id: to,
              subject: subject,
              message: messageContent,
            };
          }
        }
      }

      // Handle multiple drafts
      const drafts = await EmailDraft.find({ userId }).sort({ createdAt: -1 });
      if (drafts.length > 1 && !pendingDraft) {
        if (lowerCaseMessage.includes("send draft 1")) {
          pendingDraft = {
            recipient_id: drafts[0].recipientId,
            subject: drafts[0].subject,
            message: drafts[0].message,
          };
        } else if (lowerCaseMessage.includes("send draft 2")) {
          pendingDraft = {
            recipient_id: drafts[1].recipientId,
            subject: drafts[1].subject,
            message: drafts[1].message,
          };
        } else {
          return createTextResponse(
            `I found ${drafts.length} drafts:\n1. To: ${drafts[0].recipientId}, Subject: ${drafts[0].subject}\n2. To: ${drafts[1].recipientId}, Subject: ${drafts[1].subject}\nWhich one? Say **"send draft 1"** or **"send draft 2"**.`
          );
        }
      }

      // Check for a single draft
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

      // Process the draft sending
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
        affirmativeResponses.some((word) => lowerCaseMessage.includes(word))
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
          return createTextResponse(
            "Oops, something went wrong while sending the email. Please try again later."
          );
        }
      } else {
        const noDraftResponses = [
          "Hmm, no draft email's ready to send yet. Want to start one?",
          "Looks like there's no email queued up. Shall we draft a new one?",
          "I don't see a draft to send. How about we create one now?",
        ];
        return createTextResponse(getRandomResponse(noDraftResponses));
      }
    }

    // Handle email details requests
    const emailKeywordRegex =
      /(detail|details|full email)\s*(?:(\d+))?\s*email(?:s)?(?:\s*from\s*(\w+))?/i;
    const emailMatch = message.toLowerCase().match(emailKeywordRegex);

    if (emailMatch) {
      const numEmails = emailMatch[2] ? parseInt(emailMatch[2], 10) : 1; // Default to 1 if no number specified
      const sender = emailMatch[3]; // Sender is optional
      const maxEmails = Math.min(numEmails, 10); // Cap at 10 emails

      try {
        const fetchOptions = {
          filter: "all",
          maxResults: maxEmails,
        };
        if (sender) {
          fetchOptions.query = `from:${sender}`; // Add sender filter if specified
        }

        const recentEmails = await this.emailService.fetchEmails(fetchOptions);
        if (recentEmails.messages && recentEmails.messages.length > 0) {
          const emails = recentEmails.messages;
          this.lastEmailId = emails[0].id; // Track the last email ID (most recent)
          this.lastListedEmails.set(userId, emails); // Store for future reference

          // Format email details
          let emailText = emails
            .map((email, index) => {
              return `**Email ${index + 1}:**\n**From:** ${
                email.from
              }\n**To:** ${email.to}\n**Subject:** ${
                email.subject
              }\n**Date:** ${email.date}\n\n**Body:** ${email.body}`;
            })
            .join("\n\n---\n\n");

          const senderText = sender ? ` from ${sender}` : "";
          const plural = maxEmails > 1 ? "s" : "";
          return createTextResponse(
            `Hey ${userName}, here${
              maxEmails > 1 ? " are" : "'s"
            } the full details of your ${
              maxEmails > 1 ? `${maxEmails} most recent` : "last"
            } email${plural}${senderText}:\n\n${emailText}`
          );
        } else {
          const senderText = sender ? ` from ${sender}` : "";
          return createTextResponse(
            `Hi ${userName}, I couldn't find any emails${senderText} in your inbox. Want me to check again or try something else?`
          );
        }
      } catch (error) {
        console.error(
          `Failed to fetch email${maxEmails > 1 ? "s" : ""}${
            sender ? ` from ${sender}` : ""
          }:`,
          error
        );
        let errorText = `Sorry ${userName}, I ran into a problem fetching your email${
          maxEmails > 1 ? "s" : ""
        }${sender ? ` from ${sender}` : ""}:\n`;
        if (error.message.includes("token") || error.status === 401) {
          errorText +=
            "• It looks like there's an issue with your email account connection. Please re-authenticate.\n";
        } else if (error.message.includes("network")) {
          errorText +=
            "• The connection to your email provider seems interrupted.\n";
        } else {
          errorText +=
            "• Something unexpected happened—could be a temporary glitch.\n";
        }
        errorText +=
          "Could you try again, or let me know how else I can assist?";
        return createTextResponse(errorText);
      }
    }

    // Handle important email queries
    const importantTriggers = ["important", "priority", "urgent"];
    const isImportantQuery = importantTriggers.some((trigger) =>
      message.toLowerCase().includes(trigger)
    );

    if (isImportantQuery && importantCount > 0) {
      const importantEmailsList = topImportantEmails
        .map((email, index) => {
          const score = Math.round(email.score);
          const snippet = email.snippet ? `\nSnippet: ${email.snippet}` : "";
          const body = email.body
            ? `\nContent: ${email.body.substring(0, 1000)}${
                email.body.length > 1000 ? "..." : ""
              }`
            : "";
          return `**${index + 1}.** From: ${email.from}\nSubject: ${
            email.subject
          }\nImportance Score: ${score}%${snippet}${body}\n`;
        })
        .join("\n");

      this.lastListedEmails.set(userId, topImportantEmails); // Store for future reference

      return createTextResponse(
        `Hey ${userName}, I found **${importantCount} important emails** that need your attention. Here are the top ones:\n\n${importantEmailsList}\nWant me to open any of these?`,
        modelId ? (await getModelById(modelId)).name : "N/A",
        false
      );
    } else if (isImportantQuery) {
      return createTextResponse(
        `Hi ${userName}, I didn't find any important emails right now. Anything else I can help with?`,
        modelId ? (await getModelById(modelId)).name : "N/A",
        false
      );
    }

    // Process message and limit history
    let processedMessage = this.preprocessMessage(message, userId);
    const maxHistory = 5;
    const limitedHistory = history.slice(-maxHistory);

    // Estimate token count and manage token limits
    const estimateTokenCount = (text) => {
      // A very rough approximation: ~4 chars per token
      return Math.ceil(text.length / 4);
    };

    const systemTokens = estimateTokenCount(personalizedSystemPrompt);
    const userMessageTokens = estimateTokenCount(processedMessage);
    let historyTokens = 0;
    limitedHistory.forEach((msg) => {
      historyTokens += estimateTokenCount(msg.content);
    });

    const MAX_TOKENS = 5500; // Safe threshold below 6000
    let totalTokens = systemTokens + historyTokens + userMessageTokens + 100; // Extra buffer

    // Truncate history if exceeding token limit
    let adjustedHistory = [...limitedHistory];
    while (totalTokens > MAX_TOKENS && adjustedHistory.length > 0) {
      const removedMessage = adjustedHistory.shift();
      historyTokens -= estimateTokenCount(removedMessage.content);
      totalTokens = systemTokens + historyTokens + userMessageTokens + 100;
    }

    // If still over limit, truncate user message
    if (totalTokens > MAX_TOKENS) {
      const maxUserTokens = MAX_TOKENS - systemTokens - historyTokens - 100;
      const truncatedMessage = processedMessage.substring(0, maxUserTokens * 4); // Approx 4 chars per token
      processedMessage = `${truncatedMessage}... (message truncated due to length)`;
    }

    // Prepare message array for model
    const messages = [
      { role: "system", content: personalizedSystemPrompt },
      ...adjustedHistory,
    ];

    // Add important emails context if available
    if (context.topImportantEmails && context.topImportantEmails.length > 0) {
      const importantEmailsText = context.topImportantEmails
        .map(
          (email) =>
            `From: ${email.from}, Subject: ${email.subject}, Score: ${email.score}`
        )
        .join("\n");
      messages.push({
        role: "assistant",
        content: `I have found the following important emails:\n${importantEmailsText}`,
      });
    }

    // Add user message
    messages.push({ role: "user", content: processedMessage });

    // Validate all messages have required properties
    messages.forEach((msg, index) => {
      if (!msg.role || !msg.content) {
        console.error(`Invalid message at index ${index}:`, msg);
        throw new Error(
          "All messages must have 'role' and 'content' properties"
        );
      }
    });

    // Add time context hint
    const hour = new Date().getHours();
    let timeGreeting = "";
    if (hour >= 5 && hour < 12) timeGreeting = "It's morning, ";
    else if (hour >= 12 && hour < 18) timeGreeting = "It's afternoon, ";
    else timeGreeting = "It's evening, ";
    messages.push({
      role: "system",
      content: `${timeGreeting}the user might appreciate a response that acknowledges their busy schedule.`,
    });

    // Get model to use
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

    // Set up model options
    const options = {
      messages,
      temperature: 1.0,
      response_format: { type: "json_object" },
    };

    // Call the model
    let result, modelUsed, fallbackUsed, tokenCount;
    try {
      const response = await this.modelProvider.callWithFallbackChain(
        primaryModelId,
        options,
        STANDARD_FALLBACK_CHAIN
      );
      result = response.result;
      modelUsed = response.modelUsed;
      fallbackUsed = response.fallbackUsed;
      tokenCount = response.tokenCount;
    } catch (error) {
      console.error("Model call failed completely:", error);
      return createTextResponse(
        "I'm having trouble connecting right now. Could you try again in a moment?"
      );
    }

    // Process model response
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
        return createTextResponse(
          getRandomResponse(clarificationRequests),
          modelUsed,
          fallbackUsed
        );
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
      return createTextResponse(
        getRandomResponse(errorResponses),
        modelUsed,
        fallbackUsed
      );
    }

    // Handle action-based responses
    if (actionData.action) {
      if (actionData.action === "send-email") {
        // Create a new draft email
        try {
          // Save draft to database for future reference
          const newDraft = new EmailDraft({
            userId,
            recipientId: actionData.params.recipient_id,
            subject: actionData.params.subject,
            message: actionData.params.message,
            createdAt: new Date(),
          });
          await newDraft.save();

          // Store pending email in memory
          this.pendingEmails.set(userId, actionData.params);

          const recipientName = actionData.params.recipient_id.split("@")[0];
          const draftResponses = [
            `I've put together an email for **${recipientName}**:\n\n**To:** ${actionData.params.recipient_id}\n**Subject:** ${actionData.params.subject}\n\n${actionData.params.message}\n\nLooks okay? Say **"confirm send"** to send it, or let me know what to tweak!`,
            `Here's an email draft for **${recipientName}**:\n\n**To:** ${actionData.params.recipient_id}\n**Subject:** ${actionData.params.subject}\n\n${actionData.params.message}\n\nGood to go? Just say **"confirm send"**, or tell me what's off!`,
            `Drafted something for **${recipientName}**:\n\n**To:** ${actionData.params.recipient_id}\n**Subject:** ${actionData.params.subject}\n\n${actionData.params.message}\n\nHappy with it? Say **"confirm send"** or suggest changes!`,
          ];

          return createTextResponse(
            getRandomResponse(draftResponses),
            modelUsed,
            fallbackUsed
          );
        } catch (error) {
          console.error("Failed to create email draft:", error);
          return formatErrorResponse(error, "Failed to create email draft");
        }
      }

      // Handle other tool actions
      try {
        const toolResponse = await this.callTool(
          actionData.action,
          actionData.params,
          userId,
          modelId
        );
        return {
          ...toolResponse[0],
          modelUsed: modelUsed.name || "N/A",
          fallbackUsed: fallbackUsed,
        };
      } catch (error) {
        if (error.message && error.message.includes("Unknown tool")) {
          // Try to summarize content if tool is unknown
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
                  max_tokens: 5500,
                },
                STANDARD_FALLBACK_CHAIN
              );

            const summary =
              summaryResponse.result.choices[0]?.message?.content ||
              "Unable to summarize the content.";

            return createTextResponse(
              `I couldn't use the specified tool, but here's a summary of the provided content: ${summary}`,
              modelUsed,
              fallbackUsed
            );
          } catch (summaryError) {
            console.error("Failed to generate summary:", summaryError);
            return createTextResponse(
              "I couldn't use the requested tool and also had trouble summarizing the content. Can you try a different approach?",
              modelUsed,
              fallbackUsed
            );
          }
        } else {
          return formatErrorResponse(error, "Tool call failed");
        }
      }
    }
    // Handle message with data table
    else if (actionData.message && actionData.data) {
      const formattedTable = actionData.data.table
        ? this.formatTable(actionData.data.table)
        : "";

      const followUps = [
        "What's your next step with this?",
        "Anything here you want to dive into?",
        "Does this cover what you needed?",
        "Need me to expand on anything?",
      ];

      const randomFollowUp = getRandomResponse(followUps);
      let text = `${actionData.message}\n\n${formattedTable}\n\n${randomFollowUp}`;

      return createTextResponse(
        fallbackUsed
          ? `⚠️ The selected model is unavailable due to ***token limits***. Please use another best model.\n\n${text}`
          : text,
        modelUsed,
        fallbackUsed,
        tokenCount || 0
      );
    }
    // Handle chat response
    else if (actionData.chat) {
      return createTextResponse(
        fallbackUsed
          ? `⚠️ The selected model is unavailable due to ***token limits***. Please use another best model.\n\n${actionData.chat}`
          : actionData.chat,
        modelUsed,
        fallbackUsed,
        tokenCount || 0
      );
    }
    // Handle simple message response
    else if (actionData.message) {
      return createTextResponse(
        fallbackUsed
          ? `⚠️ The selected model is unavailable due to ***token limits***. Please use another best model.\n\n${actionData.message}`
          : actionData.message,
        modelUsed,
        fallbackUsed,
        tokenCount || 0
      );
    }
    // Handle unclear requests
    else {
      const clarificationRequests = [
        "Not sure what you're after—can you fill me in more?",
        "I'm a tad confused—could you clarify that?",
        "Hmm, what do you mean? Give me a nudge!",
      ];
      return createTextResponse(
        getRandomResponse(clarificationRequests),
        modelUsed,
        fallbackUsed
      );
    }
  }
}

export default MCPServer;
