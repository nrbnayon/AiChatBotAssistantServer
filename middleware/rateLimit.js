import rateLimit from "express-rate-limit";
import User from "../models/User.js";

// Generic rate limiter with user validation
const rateLimitMiddleware = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = "Too many requests, please try again later.",
    skipFailedRequests = false,
    keyGenerator = (req) => req.ip,
  } = options;

  return async (req, res, next) => {
    try {
      if (req.user) {
        const user = await User.findById(req.user.id);
        if (!user) {
          return res.status(401).json({ message: "User not found" });
        }
      }

      // Create a rate limiter
      const limiter = rateLimit({
        windowMs,
        max: (req) => {
          return req.user && req.user.role === "admin" ? Infinity : max;
        },
        message,
        skipFailedRequests,
        keyGenerator,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
          res.status(429).json({
            success: false,
            message: message,
          });
        },
      });

      // Apply the rate limiter
      return limiter(req, res, next);
    } catch (error) {
      next(error);
    }
  };
};

// Specific authentication rate limiter
const authRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 5,
    message = "Too many authentication attempts. Please try again later.",
  } = options;

  const authAttempts = new Map();

  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();

    for (const [key, attempt] of authAttempts.entries()) {
      if (now - attempt.firstAttempt > windowMs) {
        authAttempts.delete(key);
      }
    }

    const existingAttempt = authAttempts.get(ip) || {
      count: 0,
      firstAttempt: now,
    };

    if (existingAttempt.count >= max) {
      return res.status(429).json({
        success: false,
        message: message,
      });
    }

    authAttempts.set(ip, {
      count: existingAttempt.count + 1,
      firstAttempt: existingAttempt.firstAttempt || now,
    });

    next();
  };
};

const chatRateLimit = (options = {}) => {
  const { windowMs = 24 * 60 * 60 * 1000, max = 100 } = options;

  return async (req, res, next) => {
    try {
      if (!req.user) return next();

      // Find user
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const now = new Date();
      const lastRequest = user.subscription.lastRequestDate
        ? new Date(user.subscription.lastRequestDate)
        : null;

      // Plan-specific query limits
      const planLimits = {
        basic: 15,
        premium: 100,
        enterprise: Infinity,
      };

      const tokenLimits = {
        basic: 10000, //10000
        premium: Infinity,
        enterprise: Infinity,
      };

      const maxQueries = planLimits[user.subscription.plan] || max;
      const maxTokens = tokenLimits[user.subscription.plan] || 10000;

      // Reset daily counters if it's a new day
      if (
        !lastRequest ||
        lastRequest.getDate() !== now.getDate() ||
        lastRequest.getMonth() !== now.getMonth() ||
        lastRequest.getFullYear() !== now.getFullYear()
      ) {
        // Reset to max allowed for the day instead of 0
        user.subscription.remainingQueries = maxQueries;
        user.subscription.dailyTokens = 0;
        user.subscription.lastRequestDate = now;
      }

      // Initialize remainingQueries if it doesn't exist yet (for existing users)
      if (user.subscription.remainingQueries === undefined) {
        // If dailyQueries exists but not remainingQueries, calculate remaining
        if (user.subscription.dailyQueries !== undefined) {
          user.subscription.remainingQueries = Math.max(
            0,
            maxQueries - user.subscription.dailyQueries
          );
          // Remove the old field to avoid confusion
          delete user.subscription.dailyQueries;
        } else {
          user.subscription.remainingQueries = maxQueries;
        }
      }

      // Check subscription status
      if (
        user.subscription.status !== "active" ||
        !["basic", "premium", "enterprise"].includes(user.subscription.plan) ||
        (user.subscription.endDate && user.subscription.endDate < now)
      ) {
        return res.status(403).json({
          success: false,
          message: "An active subscription (at least basic) is required",
        });
      }

      // Check remaining queries
      if (user.subscription.remainingQueries <= 0) {
        return res.status(429).json({
          success: false,
          message:
            "Daily query limit reached for your plan. Please try again tomorrow.",
        });
      }

      // Decrement remaining queries
      user.subscription.remainingQueries -= 1;
      user.subscription.lastRequestDate = now;
      req.maxTokens = maxTokens;
      req.currentTokens = user.subscription.dailyTokens || 0;
      await user.save();

      next();
    } catch (error) {
      next(error);
    }
  };
};

export { rateLimitMiddleware, authRateLimit, chatRateLimit };
