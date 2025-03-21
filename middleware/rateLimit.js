// middleware\rateLimit.js
import User from "../models/User.js";

const rateLimit = (options = {}) => {
  const { windowMs = 24 * 60 * 60 * 1000, max = 100 } = options;

  return async (req, res, next) => {
    try {
      if (!req.user) return next();

      const user = await User.findById(req.user.id);
      const now = new Date();

      if (
        !user.subscription.lastRequestDate ||
        new Date(user.subscription.lastRequestDate).getDate() !== now.getDate()
      ) {
        user.subscription.dailyRequests = 0;
        user.subscription.lastRequestDate = now;
      }

      const planLimits = {
        free: 50,
        basic: 200,
        premium: 1000,
        enterprise: 5000,
      };

      const maxRequests = planLimits[user.subscription.plan] || max;

      if (user.subscription.dailyRequests >= maxRequests) {
        return res.status(429).json({
          success: false,
          message: "Rate limit exceeded for your plan",
        });
      }

      user.subscription.dailyRequests += 1;
      await user.save();
      next();
    } catch (error) {
      next(error);
    }
  };
};

const authRateLimit = (options = {}) => {
  const { windowMs = 15 * 60 * 1000, max = 5 } = options;
  const authAttempts = new Map();

  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();

    if (!authAttempts.has(ip)) {
      authAttempts.set(ip, { count: 1, firstAttempt: now });
    } else {
      const attempt = authAttempts.get(ip);
      if (now - attempt.firstAttempt > windowMs) {
        authAttempts.set(ip, { count: 1, firstAttempt: now });
      } else if (attempt.count >= max) {
        return res.status(429).json({
          success: false,
          message: "Too many authentication attempts. Please try again later.",
        });
      } else {
        attempt.count += 1;
      }
    }
    next();
  };
};

// Adding the rateLimitMiddleware as an alias for rateLimit to maintain backward compatibility
const rateLimitMiddleware = rateLimit;

export { rateLimit, authRateLimit, rateLimitMiddleware };



// import User from "../models/User.js";

// const rateLimit = (options = {}) => {
//   const { windowMs = 24 * 60 * 60 * 1000, max = 100 } = options;

//   return async (req, res, next) => {
//     try {
//       if (!req.user) return next();

//       const user = await User.findById(req.user.id);
//       if (!user) {
//         return next();
//       }

//       // Check if user has exceeded their daily query limit
//       if (user.hasExceededDailyQueries()) {
//         return res.status(429).json({
//           success: false,
//           message: `You've reached your daily limit of ${user.subscription.dailyQueries} queries. Please try again tomorrow or upgrade your plan.`,
//           limit: user.subscription.dailyQueries,
//           used: user.subscription.dailyQueriesUsed,
//           plan: user.subscription.plan,
//         });
//       }

//       // Increment the query count
//       await user.incrementDailyQueries();
//       next();
//     } catch (error) {
//       next(error);
//     }
//   };
// };

// const authRateLimit = (options = {}) => {
//   const { windowMs = 15 * 60 * 1000, max = 5 } = options;
//   const authAttempts = new Map();

//   return (req, res, next) => {
//     const ip = req.ip;
//     const now = Date.now();

//     if (!authAttempts.has(ip)) {
//       authAttempts.set(ip, { count: 1, firstAttempt: now });
//     } else {
//       const attempt = authAttempts.get(ip);
//       if (now - attempt.firstAttempt > windowMs) {
//         authAttempts.set(ip, { count: 1, firstAttempt: now });
//       } else if (attempt.count >= max) {
//         return res.status(429).json({
//           success: false,
//           message: "Too many authentication attempts. Please try again later.",
//         });
//       } else {
//         attempt.count += 1;
//       }
//     }
//     next();
//   };
// };

// // Clean up expired rate limit records every hour
// setInterval(() => {
//   const now = Date.now();
//   for (const [ip, data] of authAttempts.entries()) {
//     if (now - data.firstAttempt > windowMs) {
//       authAttempts.delete(ip);
//     }
//   }
// }, 60 * 60 * 1000);

// // Adding the rateLimitMiddleware as an alias for rateLimit to maintain backward compatibility
// const rateLimitMiddleware = rateLimit;

// export { rateLimit, authRateLimit, rateLimitMiddleware };