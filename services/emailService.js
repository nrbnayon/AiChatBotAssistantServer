// services/emailService.js
import Groq from "groq-sdk";
import { ApiError } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import User from "../models/User.js";

// Simple TTL cache implementation
class TTLCache {
  constructor(ttl = 3600000) {
    this.cache = new Map();
    this.ttl = ttl;
    console.log(`TTLCache initialized with TTL: ${ttl}ms`);
  }

  set(key, value) {
    console.log(
      `TTLCache: Setting key "${key}" in cache with expiry at ${new Date(
        Date.now() + this.ttl
      )}`
    );
    this.cache.set(key, { value, expiry: Date.now() + this.ttl });
  }

  get(key) {
    const item = this.cache.get(key);
    if (item && item.expiry > Date.now()) {
      console.log(
        `TTLCache: Cache HIT for key "${key}", expires in ${
          (item.expiry - Date.now()) / 1000
        }s`
      );
      return item.value;
    }
    console.log(`TTLCache: Cache MISS for key "${key}"`);
    this.cache.delete(key);
    return undefined;
  }

  clear() {
    console.log(
      `TTLCache: Clearing entire cache with ${this.cache.size} entries`
    );
    this.cache.clear();
  }

  // Debug method to show cache contents
  dumpCache() {
    console.log("TTLCache contents:");
    const now = Date.now();
    this.cache.forEach((item, key) => {
      const expiresIn = Math.round((item.expiry - now) / 1000);
      console.log(
        `- Key: "${key}", Expires in: ${expiresIn}s, Value:`,
        item.value
      );
    });
  }
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class EmailService {
  constructor(user) {
    this.user = user;
    this.grok = groq;
    this.analysisCache = new TTLCache();
    console.log(`EmailService created for user: ${user.id}`);
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

  // Shared AI-related method
  async filterImportantEmails(
    emails,
    customKeywords = [],
    timeRange = "weekly"
  ) {
    console.log(
      `filterImportantEmails called with ${emails.length} emails, timeRange: ${timeRange}`
    );
    console.log(`Custom keywords: ${customKeywords.join(", ")}`);

    // Validate timeRange
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
    console.log(
      `Filtered to ${recentEmails.length} recent emails within ${timeRange} timeframe`
    );

    const emailsToAnalyze = [];
    const processedEmails = [];

    console.log("Checking for cached analysis results...");
    this.analysisCache.dumpCache();

    for (const email of recentEmails) {
      const emailKey = `${email.id}-${timeRange}`;
      const content =
        `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();

      const cached = this.analysisCache.get(emailKey);
      if (cached) {
        console.log(
          `Using cached analysis for email ${email.id}: score=${cached.importanceScore}, important=${cached.isImportant}`
        );
        processedEmails.push(cached);
        continue;
      }

      const hasKeyword = keywords.some((keyword) =>
        content.includes(keyword.toLowerCase())
      );

      if (hasKeyword) {
        console.log(
          `Email ${email.id} contains keywords, queuing for analysis`
        );
        emailsToAnalyze.push(email);
      } else {
        console.log(
          `Email ${email.id} doesn't contain keywords, marking as not important`
        );
        const nonImportantEmail = {
          ...email,
          importanceScore: 0,
          isImportant: false,
        };
        processedEmails.push(nonImportantEmail);
        this.analysisCache.set(emailKey, nonImportantEmail);
      }
    }

    console.log(`${emailsToAnalyze.length} emails need AI analysis`);

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
        console.log(`Sending email ${email.id} to Groq API for analysis`);
        const response = await this.grok.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 1.0,
          response_format: { type: "json_object" }, // optional
        });

        const responseText = response.choices[0]?.message?.content || "";
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

        console.log(
          `Analysis result for email ${email.id}: score=${result.score}, important=${result.isImportant}`
        );
        const analyzedEmail = {
          ...email,
          importanceScore: result.score,
          isImportant: result.isImportant,
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

    const importantEmails = allEmails
      .filter((email) => email.isImportant)
      .sort((a, b) => b.importanceScore - a.importanceScore);

    console.log(`Found ${importantEmails.length} important emails`);
    console.log("Final cache state:");
    this.analysisCache.dumpCache();

    return importantEmails;
  }

  clearCache() {
    console.log("Clearing analysis cache");
    this.analysisCache.clear();
  }
}

// Cache to store email service instances per user
const emailServiceCache = new Map();
const TTL = 60000; // 1 minute

// Debug helper function to display cache contents
function dumpEmailServiceCache() {
  console.log("==== EMAIL SERVICE CACHE CONTENTS ====");
  console.log(`Total cached services: ${emailServiceCache.size}`);
  emailServiceCache.forEach((service, userId) => {
    console.log(`- User ID: ${userId}, Provider: ${service.user.authProvider}`);
  });
  console.log("======================================");
}

export async function getEmailService(req) {
  const userId = req.user.id;
  console.log(`getEmailService called for user ${userId}`);

  if (emailServiceCache.has(userId)) {
    console.log(`CACHE HIT: Using cached email service for user ${userId}`);
    return emailServiceCache.get(userId); // Return cached instance if available
  }

  console.log(`CACHE MISS: Creating new email service for user ${userId}`);
  const emailService = await createEmailService(req); // Create new instance if not cached
  emailServiceCache.set(userId, emailService); // Cache the instance
  console.log(`Added email service to cache for user ${userId}`);

  console.log(
    `Setting expiry timeout for user ${userId} cache entry (${TTL}ms)`
  );
  setTimeout(() => {
    console.log(
      `CACHE EXPIRY: Removing email service for user ${userId} from cache`
    );
    emailServiceCache.delete(userId);
    dumpEmailServiceCache();
  }, TTL);

  dumpEmailServiceCache(); // Show current cache state
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

  console.log(
    `Creating email service for user ${user.id} with provider ${user.authProvider}`
  );
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
