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
          return req.user &&
            (req.user.role === "admin" || req.user.role === "super_admin")
            ? Infinity
            : max;
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

// const chatRateLimit = (options = {}) => {
//   const { windowMs = 24 * 60 * 60 * 1000, max = 100 } = options;

//   return async (req, res, next) => {
//     try {
//       if (!req.user) return next();

//       // Find user
//       const user = await User.findById(req.user.id);
//       if (!user) {
//         return res.status(401).json({
//           success: false,
//           message: "User not found",
//         });
//       }

//       const now = new Date();
//       const lastRequest = user.subscription.lastRequestDate
//         ? new Date(user.subscription.lastRequestDate)
//         : null;

//       // Check subscription status first
//       if (user.subscription.status !== "active") {
//         return res.status(403).json({
//           success: false,
//           message:
//             "Your subscription is not active. Please activate your subscription to continue.",
//           code: "SUBSCRIPTION_INACTIVE",
//         });
//       }

//       if (
//         !["basic", "premium", "enterprise"].includes(user.subscription.plan)
//       ) {
//         return res.status(403).json({
//           success: false,
//           message:
//             "Invalid subscription plan. Please update your subscription.",
//           code: "INVALID_PLAN",
//         });
//       }

//       if (user.subscription.endDate && user.subscription.endDate < now) {
//         return res.status(403).json({
//           success: false,
//           message:
//             "Your subscription has expired. Please renew your subscription to continue.",
//           code: "SUBSCRIPTION_EXPIRED",
//         });
//       }

//       // Plan-specific query limits
//       const planLimits = {
//         basic: 15,
//         premium: 100,
//         enterprise: Infinity,
//       };

//       const tokenLimits = {
//         basic: Infinity,
//         premium: Infinity,
//         enterprise: Infinity,
//       };

//       // Get the daily query limit based on plan
//       const dailyQueryLimit = planLimits[user.subscription.plan] || max;
//       const maxTokens = tokenLimits[user.subscription.plan] || 100000000000;

//       // Reset daily counters if it's a new day
//       if (
//         !lastRequest ||
//         lastRequest.getDate() !== now.getDate() ||
//         lastRequest.getMonth() !== now.getMonth() ||
//         lastRequest.getFullYear() !== now.getFullYear()
//       ) {
//         user.subscription.remainingQueries = dailyQueryLimit;
//         user.subscription.dailyTokens = 0;
//         user.subscription.lastRequestDate = now;
//       }

//       if (user.subscription.remainingQueries === undefined) {
//         if (user.subscription.dailyQueries !== undefined) {
//           user.subscription.remainingQueries = Math.max(
//             0,
//             dailyQueryLimit - user.subscription.dailyQueries
//           );
//           delete user.subscription.dailyQueries;
//         } else {
//           user.subscription.remainingQueries = dailyQueryLimit;
//         }
//       }

//       // Check remaining queries
//       if (user.subscription.remainingQueries <= 0) {
//         return res.status(429).json({
//           success: false,
//           message: `You've reached your daily limit of ${dailyQueryLimit} queries for your ${user.subscription.plan} plan. Your limit will reset tomorrow.`,
//           code: "DAILY_LIMIT_REACHED",
//           plan: user.subscription.plan,
//           limit: dailyQueryLimit,
//         });
//       }

//       // Decrement remaining queries
//       user.subscription.remainingQueries -= 1;
//       user.subscription.lastRequestDate = now;

//       // Set token info for the request
//       req.maxTokens = maxTokens;
//       req.currentTokens = user.subscription.dailyTokens || 0;
//       req.remainingQueries = user.subscription.remainingQueries;
//       req.totalQueries = dailyQueryLimit;

//       await user.save();

//       next();
//     } catch (error) {
//       console.error("Rate limit middleware error:", error);
//       next(error);
//     }
//   };
// };

const chatRateLimit = (options = {}) => {
  const { windowMs = 24 * 60 * 60 * 1000, max = 100 } = options;
  return async (req, res, next) => {
    try {
      if (!req.user) return next();
      const user = await User.findById(req.user.id);
      if (!user)
        return res
          .status(401)
          .json({ success: false, message: "User not found" });
      const now = new Date();
      const lastRequest = user.subscription.lastRequestDate
        ? new Date(user.subscription.lastRequestDate)
        : null;

      // Skip subscription status/endDate checks for free plan
      if (user.subscription.plan !== "free") {
        if (user.subscription.status !== "active") {
          return res
            .status(403)
            .json({
              success: false,
              message: "Your subscription is not active.",
              code: "SUBSCRIPTION_INACTIVE",
            });
        }
        if (user.subscription.endDate && user.subscription.endDate < now) {
          return res
            .status(403)
            .json({
              success: false,
              message: "Your subscription has expired.",
              code: "SUBSCRIPTION_EXPIRED",
            });
        }
      }

      const dailyQueryLimit = user.subscription.dailyQueries; 

      // Reset daily counters if it’s a new day
      if (
        !lastRequest ||
        lastRequest.getDate() !== now.getDate() ||
        lastRequest.getMonth() !== now.getMonth() ||
        lastRequest.getFullYear() !== now.getFullYear()
      ) {
        user.subscription.remainingQueries = dailyQueryLimit;
        user.subscription.dailyTokens = 0;
        user.subscription.lastRequestDate = now;
      }

      if (user.subscription.remainingQueries <= 0) {
        return res.status(429).json({
          success: false,
          message: `You've reached your daily limit of ${dailyQueryLimit} queries for your ${user.subscription.plan} plan. Your limit will reset tomorrow.`,
          code: "DAILY_LIMIT_REACHED",
          plan: user.subscription.plan,
          limit: dailyQueryLimit,
        });
      }

      user.subscription.remainingQueries -= 1;
      user.subscription.lastRequestDate = now;
      req.maxTokens =
        user.subscription.plan === "enterprise" ? Infinity : 100000000000;
      req.currentTokens = user.subscription.dailyTokens || 0;
      req.remainingQueries = user.subscription.remainingQueries;
      req.totalQueries = dailyQueryLimit;
      await user.save();
      next();
    } catch (error) {
      console.error("Rate limit middleware error:", error);
      next(error);
    }
  };
};

export { rateLimitMiddleware, authRateLimit, chatRateLimit };
