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
        user.subscription.dailyQueries = 0;
        user.subscription.lastRequestDate = now;
      }

      const planLimits = {
        basic: 15,
        premium: 100,
        enterprise: Infinity,
      };

      const maxQueries = planLimits[user.subscription.plan] || max;

      if (user.subscription.dailyQueries >= maxQueries) {
        return res.status(429).json({
          success: false,
          message: "Daily query limit exceeded for your plan",
        });
      }

      user.subscription.dailyQueries += 1;
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

const rateLimitMiddleware = rateLimit;

export { rateLimit, authRateLimit, rateLimitMiddleware };
