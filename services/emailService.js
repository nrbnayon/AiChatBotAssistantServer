// services/emailService.js
import Groq from "groq-sdk";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import User from "../models/User.js";
import { getDefaultModel, getModelById } from "../routes/aiModelRoutes.js";

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
const modelResponseCache = new TTLCache(300000); // 5 minute cache for model responses

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STANDARD_FALLBACK_CHAIN = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gpt-4o-mini",
];
class EmailService {
  constructor(user) {
    this.user = user;
    this.grok = groq;
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
          throw new Error("OpenAI provider not implemented");
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
              throw new Error("OpenAI provider not implemented");
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
    timeRange = "weekly"
  ) {
    const validTimeRanges = ["daily", "weekly", "monthly"];
    if (!validTimeRanges.includes(timeRange)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid timeRange: ${timeRange}`
      );
    }

    const userKeywords = this.user.userImportantMailKeywords || [];
    const keywords = [...new Set([...userKeywords, ...customKeywords])];
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

    const emailsToAnalyze = [];
    const processedEmails = [];

    for (const email of recentEmails) {
      const emailKey = `${email.id}-${timeRange}`;
      const content =
        `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();

      const cached = this.analysisCache.get(emailKey);
      if (cached) {
        processedEmails.push(cached);
        continue;
      }

      const hasKeyword = keywords.some((keyword) =>
        content.includes(keyword.toLowerCase())
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

    const analysisPromises = emailsToAnalyze.map(async (email) => {
      const emailKey = `${email.id}-${timeRange}`;
      const content =
        `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();
      const prompt = `
        Analyze the following email content and determine if it's important based on these keywords: ${keywords.join(
          ", "
        )}.
        Consider context, sender, and urgency. Return only a valid JSON object: {"score": NUMBER_BETWEEN_0_AND_100, "isImportant": BOOLEAN_VALUE}
        
        Email content: "${content}"
        Sender: "${email.from}"
      `;

      try {
        // Use our new model call method instead of direct Groq call
        const modelResponse = await this.callModelWithFallback(
          prompt,
          "llama-3.3-70b-versatile",
          ["llama-3.1-8b-instant", "gpt-4o-mini"]
        );

        const responseText = modelResponse.content || "";
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
            "Response:",
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

    const analyzedEmails = await Promise.all(analysisPromises);
    const allEmails = [...analyzedEmails, ...processedEmails];

    return allEmails
      .filter((email) => email.isImportant)
      .sort((a, b) => b.importanceScore - a.importanceScore);
  }

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
