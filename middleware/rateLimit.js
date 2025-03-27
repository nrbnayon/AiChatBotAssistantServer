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
  const {
    windowMs = 24 * 60 * 60 * 1000, 
    max = 100, 
  } = options;

  return async (req, res, next) => {
    try {
      if (!req.user) return next();

      // Find user
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      if (
        user.subscription.status !== "active" ||
        !["basic", "premium", "enterprise"].includes(user.subscription.plan) ||
        (user.subscription.endDate && user.subscription.endDate < now)
      ) {
        user.subscription.status = "canceled"; 
        await user.save();
        return res.status(403).json({
          success: false,
          message: "An active subscription (at least basic) is required",
        });
      }

      const now = new Date();
      const lastRequest = user.subscription.lastRequestDate
        ? new Date(user.subscription.lastRequestDate)
        : null;

      if (
        !lastRequest ||
        lastRequest.getDate() !== now.getDate() ||
        lastRequest.getMonth() !== now.getMonth() ||
        lastRequest.getFullYear() !== now.getFullYear()
      ) {
        user.subscription.dailyQueries = 0;
        user.subscription.lastRequestDate = now;
      }

      // Plan-specific query limits
      const planLimits = {
        basic: 15,
        premium: 100,
        enterprise: Infinity,
      };
      const maxQueries = planLimits[user.subscription.plan] || max;

      // Check daily limit
      if (user.subscription.dailyQueries >= maxQueries) {
        return res.status(429).json({
          success: false,
          message: "Daily query limit exceeded for your plan",
        });
      }

      // Increment and save query count
      user.subscription.dailyQueries += 1;
      user.subscription.lastRequestDate = now;
      await user.save();

      next();
    } catch (error) {
      next(error);
    }
  };
};

export { rateLimitMiddleware, authRateLimit, chatRateLimit };
