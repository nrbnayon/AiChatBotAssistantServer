// services/emailService.js
import Groq from "groq-sdk";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import User from "../models/User.js";
import { getDefaultModel, getModelById } from "../routes/aiModelRoutes.js";
import OpenAI from "openai";

// Simple TTL cache implementation
class TTLCache {
  constructor(ttl = 7200000) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  set(key, value) {
    this.cache.set(key, { value, expiry: Date.now() + this.ttl });
  }

  get(key) {
    const item = this.cache.get(key);
    if (item && item.expiry > Date.now()) {
      return item.value;
    }
    this.cache.delete(key);
    return undefined;
  }

  clear() {
    this.cache.clear();
  }
}

// Cache to store model call results
const modelResponseCache = new TTLCache(300000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STANDARD_FALLBACK_CHAIN = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gpt-4o",
  "gemma2-9b-it",
  "llama3-70b-8192",
  "gpt-4o-mini",
];
class EmailService {
  constructor(user) {
    this.user = user;
    this.grok = groq;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.analysisCache = new TTLCache();
  }

  // Abstract methods to be implemented by provider-specific classes
  async getClient() {
    throw new Error("Method 'getClient' must be implemented");
  }

  async fetchEmails({ query, maxResults, pageToken, filter }) {
    throw new Error("Method 'fetchEmails' must be implemented");
  }

  async sendEmail({ to, subject, body, attachments }) {
    throw new Error("Method 'sendEmail' must be implemented");
  }

  async getEmail(emailId) {
    throw new Error("Method 'getEmail' must be implemented");
  }

  async replyToEmail(emailId, { body, attachments }) {
    throw new Error("Method 'replyToEmail' must be implemented");
  }

  async trashEmail(emailId) {
    throw new Error("Method 'trashEmail' must be implemented");
  }

  async markAsRead(emailId, read) {
    throw new Error("Method 'markAsRead' must be implemented");
  }

  async draftEmail({ to, subject, body, attachments }) {
    throw new Error("Method 'draftEmail' must be implemented");
  }

  async getInboxStats() {
    throw new Error("Method 'getInboxStats' must be implemented");
  }

  async getEmailCount({ filter, query }) {
    throw new Error("Method 'getEmailCount' must be implemented");
  }

  async getAttachments(emailId) {
    throw new Error("Method 'getAttachments' must be implemented");
  }

  async getAttachment(emailId, attachmentId) {
    throw new Error("Method 'getAttachment' must be implemented");
  }

  // Helper method to call AI model with fallback
  async callModelWithFallback(
    prompt,
    modelId = null,
    customFallbackChain = []
  ) {
    try {
      let primaryModel = modelId
        ? await getModelById(modelId)
        : await getDefaultModel();
      if (!primaryModel) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "No valid AI model found");
      }

      const cacheKey = `${primaryModel.id}-${prompt.slice(0, 100)}`;
      const cachedResponse = modelResponseCache.get(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }

      const fallbackChain =
        customFallbackChain.length > 0
          ? customFallbackChain
          : STANDARD_FALLBACK_CHAIN;

      let response = null;
      let usedModel = primaryModel;
      let fallbackUsed = false;

      try {
        if (primaryModel.provider === "groq") {
          response = await this.grok.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: primaryModel.id,
            temperature: 1.0,
            response_format: { type: "json_object" },
          });
        } else if (primaryModel.provider === "openai") {
          response = await this.openai.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: primaryModel.id,
            temperature: 1.0,
            response_format: { type: "json_object" },
          });
        } else {
          throw new Error(`Unsupported provider: ${primaryModel.provider}`);
        }
      } catch (primaryError) {
        console.error(
          `Error with primary model ${primaryModel.id}:`,
          primaryError
        );
        let fallbackSucceeded = false;

        for (const fallbackModelId of fallbackChain) {
          try {
            const fallbackModel = await getModelById(fallbackModelId);
            if (!fallbackModel) continue;

            if (fallbackModel.provider === "groq") {
              response = await this.grok.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: fallbackModel.id,
                temperature: 1.0,
                response_format: { type: "json_object" },
              });
              usedModel = fallbackModel;
              fallbackUsed = true;
              fallbackSucceeded = true;
              break;
            } else if (fallbackModel.provider === "openai") {
              response = await this.openai.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: fallbackModel.id,
                temperature: 1.0,
                response_format: { type: "json_object" },
              });
              usedModel = fallbackModel;
              fallbackUsed = true;
              fallbackSucceeded = true;
              break;
            }
          } catch (fallbackError) {
            console.error(
              `Error with fallback model ${fallbackModelId}:`,
              fallbackError
            );
          }
        }

        if (!fallbackSucceeded) {
          throw new ApiError(
            StatusCodes.SERVICE_UNAVAILABLE,
            "All AI models failed to respond"
          );
        }
      }

      const result = {
        content: response.choices[0]?.message?.content || "",
        model: usedModel,
        fallbackUsed,
      };

      modelResponseCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Model call error:", error);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to process with AI model: ${error.message}`
      );
    }
  }

  // Shared AI-related method
  async filterImportantEmails(
    emails,
    customKeywords = [],
    timeRange = "weekly",
    modelId = null
  ) {
    console.log(
      `Filtering ${emails.length} emails for importance, time range ${timeRange}`
    );
    const validTimeRanges = ["daily", "weekly", "monthly"];
    if (!validTimeRanges.includes(timeRange)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid timeRange: ${timeRange}`
      );
    }

    const userKeywords = this.user.userImportantMailKeywords || [];
    const keywords = [...new Set([...userKeywords, ...customKeywords])];
    console.log("Using keywords for filtering:", keywords);

    const timeFrames = {
      daily: 1 * 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
    };
    const timeLimit = timeFrames[timeRange];

    const recentEmails = emails.filter((email) => {
      const emailDate = new Date(email.date);
      const cutoffDate = new Date(Date.now() - timeLimit);
      return emailDate >= cutoffDate;
    });

    console.log(
      `Found ${recentEmails.length} emails within the ${timeRange} time frame`
    );

    const emailsToAnalyze = [];
    const processedEmails = [];

    for (const email of recentEmails) {
      const emailKey = `${email.id}-${timeRange}`;
      const content = `${email.subject || ""} ${email.snippet || ""} ${
        email.body || ""
      }`.toLowerCase();

      // Fixed variable name from cached to cachedEmail
      const cachedEmail = this.analysisCache.get(emailKey);
      if (cachedEmail) {
        processedEmails.push(cachedEmail);
        continue;
      }

      const hasKeyword = keywords.some(
        (keyword) => keyword && content.includes(keyword.toLowerCase())
      );

      if (hasKeyword) {
        emailsToAnalyze.push(email);
      } else {
        const nonImportantEmail = {
          ...email,
          importanceScore: 0,
          isImportant: false,
        };
        processedEmails.push(nonImportantEmail);
        this.analysisCache.set(emailKey, nonImportantEmail);
      }
    }

    console.log(
      `Found ${emailsToAnalyze.length} emails containing keywords that need analysis`
    );

    if (emailsToAnalyze.length === 0) {
      return processedEmails
        .filter((e) => e.isImportant)
        .sort((a, b) => b.importanceScore - a.importanceScore);
    }

    const analysisPromises = emailsToAnalyze.map(async (email) => {
      const emailKey = `${email.id}-${timeRange}`;
      const content = `${email.subject || ""} ${email.snippet || ""} ${
        email.body || ""
      }`.toLowerCase();
      const prompt = `
      Analyze the following email content and determine if it's important based on these keywords: ${keywords.join(
        ", "
      )}.
      Consider context, sender, and urgency. Return only a valid JSON object: {"score": NUMBER_BETWEEN_0_AND_100, "isImportant": BOOLEAN_VALUE}

      Email content: "${content}"
      Sender: "${email.from || "Unknown"}"
    `;

      try {
        // Use our new model call method instead of direct Groq call
        const modelResponse = await this.callModelWithFallback(prompt, modelId);

        const responseText = modelResponse.content || "";
        console.log(
          `Model response for email (${
            email.id
          }) analysis (first 50 chars): ${responseText.substring(0, 50)}...`
        );

        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch
          ? jsonMatch[0]
          : '{"score": 25, "isImportant": false}';

        let result;
        try {
          result = JSON.parse(jsonStr);
        } catch (parseError) {
          console.error(
            "JSON parse error:",
            parseError,
            "Response text:",
            responseText
          );
          result = { score: 25, isImportant: false };
        }

        const analyzedEmail = {
          ...email,
          importanceScore: result.score,
          isImportant: result.isImportant,
          modelUsed: modelResponse.model.id,
          fallbackUsed: modelResponse.fallbackUsed,
        };
        this.analysisCache.set(emailKey, analyzedEmail);
        return analyzedEmail;
      } catch (error) {
        console.error("Error analyzing email:", error);
        const fallbackEmail = {
          ...email,
          importanceScore: 0,
          isImportant: false,
        };
        this.analysisCache.set(emailKey, fallbackEmail);
        return fallbackEmail;
      }
    });

    let analyzedEmails;
    try {
      analyzedEmails = await Promise.all(analysisPromises);
    } catch (error) {
      console.error("Error in Promise.all for email analysis:", error);
      analyzedEmails = []; // Fallback
    }

    const allEmails = [...analyzedEmails, ...processedEmails];
    const importantEmails = allEmails
      .filter((email) => email.isImportant)
      .sort((a, b) => b.importanceScore - a.importanceScore);

    console.log(
      `Found ${importantEmails.length} important emails after analysis`
    );

    return importantEmails.map((email) => ({
      ...email,
      score: email.importanceScore,
      subject: email.subject,
      from: email.from,
      snippet: email.snippet,
      body: email.body,
    }));
  }

  // async filterImportantEmails(
  //   emails,
  //   customKeywords = [],
  //   timeRange = "weekly",
  //   modelId = null
  // ) {
  //   const validTimeRanges = ["daily", "weekly", "monthly"];
  //   if (!validTimeRanges.includes(timeRange)) {
  //     throw new ApiError(400, `Invalid timeRange: ${timeRange}`);
  //   }

  //   const cacheKey = `${this.user.id}-${customKeywords.join(",")}-${timeRange}`;
  //   const cached = this.analysisCache.get(cacheKey);
  //   if (cached) return cached;

  //   // Filter emails by time range
  //   const timeFrames = {
  //     daily: 1 * 24 * 60 * 60 * 1000,
  //     weekly: 7 * 24 * 60 * 60 * 1000,
  //     monthly: 30 * 24 * 60 * 60 * 1000,
  //   };
  //   const cutoffDate = new Date(Date.now() - timeFrames[timeRange]);
  //   const recentEmails = emails.filter(
  //     (email) => new Date(email.date) >= cutoffDate
  //   );

  //   if (recentEmails.length === 0) {
  //     this.analysisCache.set(cacheKey, []);
  //     return [];
  //   }

  //   // Batch analysis
  //   const batchPrompt =
  //     recentEmails
  //       .map(
  //         (e, i) =>
  //           `Email ${i}: Subject: "${e.subject || "No subject"}", Snippet: "${
  //             e.snippet || ""
  //           }"`
  //       )
  //       .join("\n") +
  //     `\n\nAnalyze these emails for importance based on keywords: ${
  //       customKeywords.join(", ") || "none"
  //     }. ` +
  //     `Return a JSON array ONLY, without any wrapping object: [{index: NUMBER, score: NUMBER, isImportant: BOOLEAN}]`;

  //   try {
  //     const response = await this.callModelWithFallback(batchPrompt, modelId);
  //     let results = JSON.parse(response.content || "[]");

  //     // Handle cases where results is an object with importance_analysis or emails
  //     if (!Array.isArray(results)) {
  //       if (
  //         results &&
  //         typeof results === "object" &&
  //         Array.isArray(results.importance_analysis)
  //       ) {
  //         console.log(
  //           "Extracted array from importance_analysis:",
  //           results.importance_analysis
  //         );
  //         results = results.importance_analysis;
  //       } else if (
  //         results &&
  //         typeof results === "object" &&
  //         Array.isArray(results.emails)
  //       ) {
  //         console.log("Extracted array from emails:", results.emails);
  //         results = results.emails;
  //       } else {
  //         console.error("Model did not return a valid array:", results);
  //         results = []; // Fallback to empty array
  //       }
  //     }

  //     const analyzedEmails = recentEmails
  //       .map((e, i) => {
  //         const result = results.find((r) => r.index === i) || {
  //           score: 0,
  //           isImportant: false,
  //         };
  //         return {
  //           ...e,
  //           importanceScore: result.score || 0,
  //           isImportant: result.isImportant || false,
  //         };
  //       })
  //       .filter((e) => e.isImportant)
  //       .sort((a, b) => b.importanceScore - a.importanceScore);

  //     this.analysisCache.set(cacheKey, analyzedEmails);
  //     return analyzedEmails;
  //   } catch (error) {
  //     console.error("Error analyzing emails:", error);
  //     return [];
  //   }
  // }

  // async filterImportantEmails(
  //   emails,
  //   customKeywords = [],
  //   timeRange = "weekly",
  //   modelId = null
  // ) {
  //   console.log(
  //     "Filtering important emails with keywords:",
  //     // emails,
  //     customKeywords,
  //     timeRange,
  //     modelId
  //   );
  //   const validTimeRanges = ["daily", "weekly", "monthly"];
  //   if (!validTimeRanges.includes(timeRange)) {
  //     throw new ApiError(
  //       StatusCodes.BAD_REQUEST,
  //       `Invalid timeRange: ${timeRange}`
  //     );
  //   }

  //   const cacheKey = `${this.user.id}-${customKeywords.join(",")}-${timeRange}`;
  //   const cached = this.analysisCache.get(cacheKey);
  //   if (cached) return cached;

  //   // Filter emails by time range
  //   const timeFrames = {
  //     daily: 1 * 24 * 60 * 60 * 1000,
  //     weekly: 7 * 24 * 60 * 60 * 1000,
  //     monthly: 30 * 24 * 60 * 60 * 1000,
  //   };
  //   const cutoffDate = new Date(Date.now() - timeFrames[timeRange]);
  //   const recentEmails = emails.filter(
  //     (email) => new Date(email.date) >= cutoffDate
  //   );

  //   if (recentEmails.length === 0) {
  //     this.analysisCache.set(cacheKey, []);
  //     return [];
  //   }

  //   // Batch analysis with clearer instructions for response format
  //   const batchPrompt =
  //     recentEmails
  //       .map(
  //         (e, i) =>
  //           `Email ${i}: Subject: "${e.subject || "No subject"}", Snippet: "${
  //             e.snippet || ""
  //           }"`
  //       )
  //       .join("\n") +
  //     `\n\nAnalyze these emails for importance based on keywords: ${
  //       customKeywords.join(", ") || "none"
  //     }. ` +
  //     `Return ONLY a JSON array at the top level (not nested in an object): [{index: NUMBER, score: NUMBER, isImportant: BOOLEAN}]`;

  //   try {
  //     const response = await this.callModelWithFallback(batchPrompt, modelId);
  //     const parsedContent = JSON.parse(response.content || "[]");

  //     // Extract the array, whether it's directly returned or nested
  //     let results = [];
  //     if (Array.isArray(parsedContent)) {
  //       // Direct array response
  //       results = parsedContent;
  //     } else if (typeof parsedContent === "object") {
  //       // Handle nested structure - check for any array property
  //       // First look for common pattern names
  //       const possibleArrayProps = [
  //         "importance_analysis",
  //         "results",
  //         "emails",
  //         "data",
  //         "items",
  //       ];

  //       // Try to find arrays using the common names first
  //       for (const propName of possibleArrayProps) {
  //         if (
  //           parsedContent[propName] &&
  //           Array.isArray(parsedContent[propName])
  //         ) {
  //           results = parsedContent[propName];
  //           break;
  //         }
  //       }

  //       // If still no results, try to find any array in the response
  //       if (results.length === 0) {
  //         const arrayProp = Object.values(parsedContent).find((val) =>
  //           Array.isArray(val)
  //         );
  //         if (arrayProp) {
  //           results = arrayProp;
  //         }
  //       }
  //     }

  //     // Normalize entries to ensure they have the expected format
  //     const normalizedResults = results.map((item) => {
  //       // Ensure all entries have index, score, and isImportant properties
  //       return {
  //         index: typeof item.index === "number" ? item.index : 0,
  //         score: typeof item.score === "number" ? item.score : 0,
  //         isImportant: Boolean(item.isImportant),
  //       };
  //     });

  //     const analyzedEmails = recentEmails
  //       .map((e, i) => {
  //         // Find matching result by index, or use default values
  //         const result = normalizedResults.find((r) => r.index === i) || {
  //           score: 0,
  //           isImportant: false,
  //         };

  //         return {
  //           ...e,
  //           importanceScore: result.score || 0,
  //           isImportant: result.isImportant || false,
  //         };
  //       })
  //       .filter((e) => e.isImportant)
  //       .sort((a, b) => b.importanceScore - a.importanceScore);

  //     this.analysisCache.set(cacheKey, analyzedEmails);
  //     return analyzedEmails;
  //   } catch (error) {
  //     console.error("Error analyzing emails:", error);
  //     // Log more details about the error
  //     if (error.response) {
  //       console.error("API error response:", error.response.data);
  //     }
  //     // Return empty array as fallback
  //     return [];
  //   }
  // }

  clearCache() {
    this.analysisCache.clear();
  }
}

// Cache to store email service instances per user
const emailServiceCache = new Map();
const TTL = 60000; // 1 minute

export async function getEmailService(req) {
  const userId = req.user.id;
  if (emailServiceCache.has(userId)) {
    return emailServiceCache.get(userId);
  }
  const emailService = await createEmailService(req);
  emailServiceCache.set(userId, emailService);
  setTimeout(() => emailServiceCache.delete(userId), TTL);
  return emailService;
}

export const createEmailService = async (req) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");

  if (!user.authProvider) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "User has no authentication provider set"
    );
  }

  try {
    switch (user.authProvider) {
      case "google":
        const { default: GmailService } = await import("./gmailService.js");
        return new GmailService(user);
      case "microsoft":
        const { default: OutlookService } = await import("./outlookService.js");
        return new OutlookService(user);
      default:
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Unsupported email provider"
        );
    }
  } catch (error) {
    console.error("Error loading email service:", error);
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to load email service"
    );
  }
};

export default EmailService;
