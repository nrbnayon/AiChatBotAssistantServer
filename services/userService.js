// services\userService.js
import User from "../models/User.js";
import bcrypt from "bcryptjs";

const handleLocalLogin = async (email, password) => {
  const user = await User.findOne({ email });
  if (!user || user.authProvider !== "local" || !user.password) {
    throw new Error("Invalid credentials or wrong auth method");
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new Error("Invalid credentials");
  return user;
};

const updateProfile = async (userId, profileData) => {
  const allowedFields = [
    "name",
    "phone",
    "address",
    "country",
    "gender",
    "dateOfBirth",
  ];
  const updates = Object.keys(profileData)
    .filter((key) => allowedFields.includes(key))
    .reduce((obj, key) => ({ ...obj, [key]: profileData[key] }), {});
  return await User.findByIdAndUpdate(
    userId,
    { ...updates, lastSync: new Date() },
    { new: true }
  );
};

const updateSubscription = async (userId, { plan, autoRenew }) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const endDateMap = {
    free: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    basic: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    premium: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    enterprise: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
  };

  if (plan) {
    user.subscription.plan = plan;
    user.subscription.startDate = new Date();
    user.subscription.endDate = endDateMap[plan];
    user.subscription.status = "ACTIVE";
  }
  if (typeof autoRenew === "boolean") {
    user.subscription.autoRenew = autoRenew;
  }
  await user.save();
  return user;
};

const deleteUser = async (userId) => {
  const user = await User.findByIdAndDelete(userId);
  if (!user) throw new Error("User not found");
  return user;
};

const getAllUsers = async () => {
  return await User.find().select("-password");
};

export default {
  handleLocalLogin,
  updateProfile,
  updateSubscription,
  deleteUser,
  getAllUsers,
};
  


// config\passport.js
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Strategy as YahooStrategy } from "passport-yahoo-oauth";
import dotenv from "dotenv";
import User from "../models/User.js";
import { generateTokens } from "../controllers/authController.js";

dotenv.config();

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

const oauthCallback = async (
  accessToken,
  refreshToken,
  profile,
  done,
  provider
) => {
  try {
    const email =
      provider === "microsoft"
        ? profile._json.mail || profile._json.userPrincipalName
        : profile.emails[0].value;
    let user = await User.findOne({ email });

    const providerFields = {
      google: {
        idField: "googleId",
        accessTokenField: "googleAccessToken",
        refreshTokenField: "googleRefreshToken",
      },
      microsoft: {
        idField: "microsoftId",
        accessTokenField: "microsoftAccessToken",
        refreshTokenField: "microsoftRefreshToken",
      },
      yahoo: {
        idField: "yahooId",
        accessTokenField: "yahooAccessToken",
        refreshTokenField: "yahooRefreshToken",
      },
    };

    const { idField, accessTokenField, refreshTokenField } =
      providerFields[provider];
    const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
      generateTokens(user || {});

    if (user) {
      user[idField] = profile.id;
      user[accessTokenField] = accessToken;
      user[refreshTokenField] = refreshToken;
      user.authProvider = provider;
      user.verified = true;
      user.refreshToken = jwtRefreshToken;
      await user.save();
    } else {
      user = await User.create({
        email,
        name: profile.displayName,
        [idField]: profile.id,
        [accessTokenField]: accessToken,
        [refreshTokenField]: refreshToken,
        authProvider: provider,
        verified: true,
        refreshToken: jwtRefreshToken,
      });
    }

    return done(null, user, {
      accessToken: jwtAccessToken,
      refreshToken: jwtRefreshToken,
    });
  } catch (error) {
    return done(error, null);
  }
};

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.GOOGLE_LIVE_REDIRECT_URI
          : process.env.GOOGLE_REDIRECT_URI,
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
    },
    (accessToken, refreshToken, profile, done) =>
      oauthCallback(accessToken, refreshToken, profile, done, "google")
  )
);

passport.use(
  new MicrosoftStrategy(
    {
      clientID: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.MICROSOFT_LIVE_REDIRECT_URI
          : process.env.MICROSOFT_REDIRECT_URI,
      scope: ["user.read", "mail.read"],
      tenant: "common",
    },
    (accessToken, refreshToken, profile, done) =>
      oauthCallback(accessToken, refreshToken, profile, done, "microsoft")
  )
);

passport.use(
  new YahooStrategy(
    {
      consumerKey: process.env.YAHOO_CLIENT_ID,
      consumerSecret: process.env.YAHOO_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.YAHOO_REDIRECT_URI
          : process.env.YAHOO_DEV_REDIRECT_URI ||
            "http://localhost:4000/api/v1/auth/yahoo/callback",
      scope: ["profile", "email", "mail-r"],
    },
    (accessToken, refreshToken, profile, done) =>
      oauthCallback(accessToken, refreshToken, profile, done, "yahoo")
  )
);

export default passport;


// controllers\authController.js
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/User.js";
import userService from "../services/userService.js";

dotenv.config();

const getFrontendUrl =
  process.env.NODE_ENV === "production"
    ? process.env.FRONTEND_LIVE_URL
    : process.env.FRONTEND_URL;

const generateTokens = (user) => {
  const payload = {
    id: user._id || user.id,
    email: user.email,
    role: user.role || "USER",
    hasGoogleAuth: !!user.googleAccessToken,
    hasMicrosoftAuth: !!user.microsoftAccessToken,
    hasYahooAuth: !!user.yahooAccessToken,
  };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  const refreshToken = jwt.sign(
    { id: payload.id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "30d" }
  );
  return { accessToken, refreshToken };
};

const authError = (req, res) => {
  const message = req.query.message || "Authentication failed";
  res.redirect(`${getFrontendUrl}/login?error=${encodeURIComponent(message)}`);
};

const oauthCallback = (req, res) => {
  const { accessToken, refreshToken } = req.authInfo || {};
  const state = req.query.state
    ? JSON.parse(Buffer.from(req.query.state, "base64").toString())
    : {};
  if (!accessToken) {
    return res.redirect(
      `${getFrontendUrl}/login?error=${encodeURIComponent(
        "Authentication failed: No access token provided"
      )}`
    );
  }
  res.redirect(
    `${getFrontendUrl}/auth-callback?token=${accessToken}&refreshToken=${refreshToken}&redirect=${encodeURIComponent(
      state.redirect || "/"
    )}`
  );
};

const localLogin = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    const user = await userService.handleLocalLogin(email, password);
    const { accessToken, refreshToken } = generateTokens(user);
    user.refreshToken = refreshToken;
    await user.save();
    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: user._id, email: user.email, name: user.name },
    });
  } catch (error) {
    res.status(401).json({ success: false, message: error.message });
  }
};

const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const user = await User.create({
      email,
      password,
      name,
      authProvider: "local",
    });
    const { accessToken, refreshToken } = generateTokens(user);
    user.refreshToken = refreshToken;
    await user.save();
    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: user._id, email: user.email, name: user.name },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken)
      throw new Error("Invalid refresh token");
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    user.refreshToken = newRefreshToken;
    await user.save();
    res.json({ success: true, accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    res.status(401).json({ success: false, message: error.message });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) throw new Error("User not found");
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const user = await userService.updateProfile(req.user.id, req.body);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateSubscription = async (req, res) => {
  try {
    const user = await userService.updateSubscription(req.user.id, req.body);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteMe = async (req, res) => {
  try {
    await userService.deleteUser(req.user.id);
    res.json({ success: true, message: "User deleted" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const logout = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user) {
      user.refreshToken = null;
      await user.save();
    }
    req.logout((err) => {
      if (err) throw new Error("Logout failed");
      res.json({ success: true, message: "Logged out successfully" });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    res.json({ success: true, users });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export {
  getFrontendUrl,
  generateTokens,
  authError,
  oauthCallback as googleCallback,
  oauthCallback as microsoftCallback,
  oauthCallback as yahooCallback,
  localLogin,
  register,
  refresh,
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  logout,
  getAllUsers,
};

export default {
  getFrontendUrl,
  generateTokens,
  authError,
  googleCallback: oauthCallback,
  microsoftCallback: oauthCallback,
  yahooCallback: oauthCallback,
  localLogin,
  register,
  refresh,
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  logout,
  getAllUsers,
};

// helper\cookieHelper.js
const defaultConfig = {
  cookies: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: undefined,
  },
};

// Create base options function to reduce duplication
const getBaseOptions = () => {
  const options = {
    httpOnly: defaultConfig.cookies.httpOnly,
    secure: defaultConfig.cookies.secure,
    sameSite: defaultConfig.cookies.sameSite,
    path: defaultConfig.cookies.path,
  };

  if (defaultConfig.cookies.domain) {
    return { ...options, domain: defaultConfig.cookies.domain };
  }

  return options;
};

export const cookieHelper = {
  getAccessTokenOptions: () => ({
    ...getBaseOptions(),
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  }),

  getRefreshTokenOptions: () => ({
    ...getBaseOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  }),
};

export const safeCookie = {
  set: (res, name, value, options) => {
    try {
      res.cookie(name, value, options);
      console.log(`Cookie '${name}' set successfully`);
    } catch (error) {
      console.error(
        `Failed to set cookie '${name}':`,
        error instanceof Error ? error.message : String(error)
      );

      try {
        const simpleOptions = { ...options };
        delete simpleOptions.domain;
        res.cookie(name, value, simpleOptions);
        console.log(`Cookie '${name}' set with fallback options`);
      } catch (fallbackError) {
        console.error(
          `Critical: Failed to set cookie '${name}' even with fallback:`,
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        );
      }
    }
  },

  clear: (res, name, options) => {
    try {
      res.clearCookie(name, options);
      console.log(`Cookie '${name}' cleared successfully`);
    } catch (error) {
      console.error(
        `Failed to clear cookie '${name}':`,
        error instanceof Error ? error.message : String(error)
      );

      try {
        const simpleOptions = { ...options };
        delete simpleOptions.domain;
        res.clearCookie(name, simpleOptions);
        console.log(`Cookie '${name}' cleared with fallback options`);
      } catch (fallbackError) {
        console.error(
          `Critical: Failed to clear cookie '${name}' even with fallback:`,
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        );
      }
    }
  },
};


//helper\jwtHelper.js
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";

const defaultConfig = {
  jwt: {
    secret: process.env.JWT_SECRET || "your-secret-key",
    refresh_secret:
      process.env.REFRESH_TOKEN_SECRET || "your-refresh-secret-key",
    expire_in: process.env.JWT_EXPIRE_IN || "24h",
    refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
};

// Custom API Error class
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

const createToken = (payload, secret, expireTime) => {
  const options = { expiresIn: expireTime };
  return jwt.sign(payload, secret, options);
};

const verifyToken = (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid token");
  }
};

const createAccessToken = (payload) => {
  if (!defaultConfig.jwt.secret) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "JWT secret is not defined"
    );
  }
  return createToken(
    payload,
    defaultConfig.jwt.secret,
    defaultConfig.jwt.expire_in
  );
};

const createRefreshToken = (payload) => {
  if (!defaultConfig.jwt.refresh_secret) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "JWT refresh secret is not defined"
    );
  }
  return createToken(
    payload,
    defaultConfig.jwt.refresh_secret,
    defaultConfig.jwt.refresh_expires_in
  );
};

export const jwtHelper = {
  createToken,
  verifyToken,
  createAccessToken,
  createRefreshToken,
};


// middleware/authGird.js
import { StatusCodes } from "http-status-codes";
import jwt from "jsonwebtoken";
import User from "../models/User";

const defaultConfig = {
  jwt: {
    secret: process.env.JWT_SECRET || "your-secret-key",
    refresh_secret: process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key",
    expire_in: process.env.JWT_EXPIRE_IN || "24h",
    refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
};

// Custom API Error class
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Assume these are imported from their respective files
// Define enums that were imported
const USER_ROLES = {
  ADMIN: "ADMIN",
  USER: "USER",
  SUPER_ADMIN: "super_admin",
};

const USER_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  BLOCKED: "blocked",
};

const AUTH_PROVIDER = {
  GOOGLE: "google",
  MICROSOFT: "microsoft",
  YAHOO: "yahoo",
};

// Create simplified versions of required helpers
const jwtHelper = {
  verifyToken: (token, secret) => {
    try {
      return jwt.verify(token, secret);
    } catch (error) {
      throw error;
    }
  },
  createToken: (payload, secret, expireTime) => {
    const options = { expiresIn: expireTime };
    return jwt.sign(payload, secret, options);
  },
};

if (req.isAuthenticated()) {
      req.user = await User.findById(req.user.id);
      return next();
    }

// Simple logger
const logger = {
  info: (message, meta) => {
    console.log(`[INFO] ${message}`, meta || "");
  },
  error: (message, meta) => {
    console.error(`[ERROR] ${message}`, meta || "");
  },
};

// Cookie helper simplified
const cookieHelper = {
  getAccessTokenOptions: () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  }),
};

const safeCookie = {
  set: (res, name, value, options) => {
    try {
      res.cookie(name, value, options);
      logger.info(`Cookie '${name}' set successfully`);
    } catch (error) {
      logger.error(
        `Failed to set cookie '${name}':`,
        error.message || String(error)
      );
      try {
        const simpleOptions = { ...options };
        delete simpleOptions.domain;
        res.cookie(name, value, simpleOptions);
        logger.info(`Cookie '${name}' set with fallback options`);
      } catch (fallbackError) {
        logger.error(
          `Critical: Failed to set cookie '${name}' even with fallback:`,
          fallbackError.message || String(fallbackError)
        );
      }
    }
  },
};

// Auth middleware
const auth =
  (...roles) =>
  async (req, res, next) => {
    try {
      // Extract token from cookie or authorization header
      const accessToken =
        req.cookies?.accessToken ||
        (req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.substring(7)
          : undefined);

      logger.info("Auth middleware - Token present:", {
        hasToken: !!accessToken,
        from: {
          cookies: !!req.cookies?.accessToken,
          headers: !!req.headers.authorization,
        },
      });

      if (!accessToken) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "Invalid or missing token"
        );
      }

      try {
        // Verify the access token
        const decoded = jwtHelper.verifyToken(
          accessToken,
          defaultConfig.jwt.secret
        );

        logger.info("Token decoded successfully", {
          userId: decoded.userId,
          role: decoded.role,
        });

        // Check if the user exists and is active
        const user = await User.findById(decoded.userId);
        if (!user || user.status !== USER_STATUS.ACTIVE) {
          logger.error("User check failed", {
            userExists: !!user,
            userStatus: user?.status,
          });
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "User not found or inactive"
          );
        }

        // Check role permissions
        if (roles.length && !roles.includes(decoded.role)) {
          logger.error("Role check failed", {
            requiredRoles: roles,
            userRole: decoded.role,
          });
          throw new ApiError(
            StatusCodes.FORBIDDEN,
            "You don't have permission to access this resource"
          );
        }

        // Attach user info to request
        req.user = {
          userId: decoded.userId,
          role: decoded.role,
          email: decoded.email,
          name: decoded.name,
          authProvider: decoded.authProvider,
        };

        logger.info("User authenticated successfully", {
          userId: decoded.userId,
        });
        return next();
      } catch (error) {
        // Handle expired access token
        if (error instanceof jwt.TokenExpiredError) {
          logger.info("Access token expired, checking refresh token");

          const refreshToken = req.cookies?.refreshToken;
          if (!refreshToken) {
            logger.error("No refresh token available");
            throw new ApiError(
              StatusCodes.UNAUTHORIZED,
              "Refresh token required"
            );
          }

          try {
            // Verify refresh token
            const decodedRefresh = jwtHelper.verifyToken(
              refreshToken,
              defaultConfig.jwt.refresh_secret
            );

            logger.info("Refresh token decoded successfully", {
              userId: decodedRefresh.userId,
            });

            // Check if the user exists and is active
            const user = await User.findById(decodedRefresh.userId);
            if (!user || user.status !== USER_STATUS.ACTIVE) {
              logger.error("User check with refresh token failed", {
                userExists: !!user,
                userStatus: user?.status,
              });
              throw new ApiError(
                StatusCodes.UNAUTHORIZED,
                "User not found or inactive"
              );
            }

            // Check role permissions
            if (roles.length && !roles.includes(user.role)) {
              logger.error("Role check with refresh token failed", {
                requiredRoles: roles,
                userRole: user.role,
              });
              throw new ApiError(
                StatusCodes.FORBIDDEN,
                "You don't have permission to access this resource"
              );
            }

            // Generate new access token
            const newAccessToken = jwtHelper.createToken(
              {
                userId: user._id.toString(),
                role: user.role,
                email: user.email,
                name: user.name,
                authProvider: user.authProvider,
              },
              defaultConfig.jwt.secret,
              defaultConfig.jwt.expire_in
            );

            logger.info("New access token generated", {
              userId: user._id.toString(),
            });

            // Attach user info and token refresh flag to request
            req.user = {
              userId: user._id.toString(),
              role: user.role,
              email: user.email,
              name: user.name,
              authProvider: user.authProvider,
            };
            req.tokenRefreshed = true;
            req.newAccessToken = newAccessToken;

            logger.info("User authenticated with refresh token", {
              userId: user._id.toString(),
            });
            return next();
          } catch (refreshError) {
            logger.error("Refresh token verification failed", {
              error: refreshError.message,
            });
            throw new ApiError(
              StatusCodes.UNAUTHORIZED,
              "Invalid refresh token"
            );
          }
        }

        logger.error("Token verification failed", {
          error: error.message,
        });
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid access token");
      }
    } catch (error) {
      logger.error("Authentication middleware error", {
        error: error.message,
      });
      next(error);
    }
  };

// Middleware to set the refreshed token cookie after authentication
const setRefreshedTokenCookie = (req, res, next) => {
  if (req.tokenRefreshed && req.newAccessToken) {
    safeCookie.set(
      res,
      "accessToken",
      req.newAccessToken,
      cookieHelper.getAccessTokenOptions()
    );
    logger.info("Refreshed access token cookie set");
  }

  next();
};

export default auth;
export { setRefreshedTokenCookie };


// models\User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSubscriptionSchema = new mongoose.Schema({
  plan: {
    type: String,
    enum: ["free", "basic", "premium", "enterprise"],
    default: "free",
  },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  status: {
    type: String,
    enum: ["ACTIVE", "EXPIRED", "CANCELLED"],
    default: "ACTIVE",
  },
  dailyRequests: { type: Number, default: 0 },
  dailyTokens: { type: Number, default: 0 },
  lastRequestDate: { type: Date },
  autoRenew: { type: Boolean, default: true },
});

const userSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["ADMIN", "USER"],
    default: "USER",
    required: true,
  },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  authProvider: {
    type: String,
    enum: ["google", "microsoft", "yahoo", "local"],
    required: true,
  },
  password: { type: String },
  phone: String,
  address: String,
  country: String,
  googleId: { type: String, sparse: true },
  microsoftId: { type: String, sparse: true },
  yahooId: { type: String, sparse: true },
  googleAccessToken: String,
  googleRefreshToken: String,
  microsoftAccessToken: String,
  microsoftRefreshToken: String,
  yahooAccessToken: String,
  yahooRefreshToken: String,
  refreshToken: String,
  status: {
    type: String,
    enum: ["ACTIVE", "INACTIVE", "BLOCKED"],
    default: "ACTIVE",
  },
  verified: { type: Boolean, default: false },
  gender: { type: String, enum: ["male", "female", "others"] },
  dateOfBirth: Date,
  subscription: { type: userSubscriptionSchema, default: () => ({}) },
  createdAt: { type: Date, default: Date.now },
  lastSync: { type: Date, default: Date.now },
});

userSchema.pre("save", async function (next) {
  if (this.isModified("password") && this.authProvider === "local") {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

export default mongoose.model("User", userSchema);

// routes\authRouter.js
import express from "express";
import passport from "../config/passport.js";
import userController from "../controllers/authController.js";
import { authenticate, restrictTo } from "../middleware/auth.js";
import { rateLimit, authRateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

router.get(
  "/google",
  authRateLimit(),
  (req, res, next) => {
    console.log("Google OAuth route hit");
    next();
  },
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    state: Buffer.from(JSON.stringify({ redirect: "/" })).toString("base64"),
  })
);

router.get(
  "/google/callback",
  authRateLimit(),
  passport.authenticate("google", {
    failureRedirect: "/api/v1/auth/error",
    session: true,
  }),
  userController.googleCallback
);

router.get(
  "/microsoft",
  authRateLimit(),
  passport.authenticate("microsoft", {
    prompt: "select_account",
    state: Buffer.from(JSON.stringify({ redirect: "/" })).toString("base64"),
  })
);

router.get(
  "/microsoft/callback",
  authRateLimit(),
  passport.authenticate("microsoft", {
    failureRedirect: "/api/v1/auth/error",
    session: true,
  }),
  userController.microsoftCallback
);

router.get(
  "/yahoo",
  authRateLimit(),
  passport.authenticate("yahoo", {
    state: Buffer.from(JSON.stringify({ redirect: "/" })).toString("base64"),
  })
);

router.get(
  "/yahoo/callback",
  authRateLimit(),
  passport.authenticate("yahoo", {
    failureRedirect: "/api/v1/auth/error",
    session: true,
  }),
  userController.yahooCallback
);

router.get("/error", userController.authError);
router.post("/login", authRateLimit(), userController.localLogin);
router.post("/register", authRateLimit(), userController.register);
router.post("/refresh", authRateLimit(), userController.refresh);

router.get("/me", authenticate, rateLimit(), userController.getMe);
router.put("/profile", authenticate, rateLimit(), userController.updateProfile);
router.put(
  "/subscription",
  authenticate,
  rateLimit(),
  userController.updateSubscription
);
router.delete("/me", authenticate, rateLimit(), userController.deleteMe);
router.get("/logout", authenticate, userController.logout);

router.get(
  "/admin/users",
  authenticate,
  restrictTo("ADMIN"),
  rateLimit({ max: 1000 }),
  userController.getAllUsers
);

export default router;

// services\userService.js
import User from "../models/User.js";
import bcrypt from "bcryptjs";

const handleLocalLogin = async (email, password) => {
  const user = await User.findOne({ email });
  if (!user || user.authProvider !== "local" || !user.password) {
    throw new Error("Invalid credentials or wrong auth method");
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new Error("Invalid credentials");
  return user;
};

const updateProfile = async (userId, profileData) => {
  const allowedFields = [
    "name",
    "phone",
    "address",
    "country",
    "gender",
    "dateOfBirth",
  ];
  const updates = Object.keys(profileData)
    .filter((key) => allowedFields.includes(key))
    .reduce((obj, key) => ({ ...obj, [key]: profileData[key] }), {});
  return await User.findByIdAndUpdate(
    userId,
    { ...updates, lastSync: new Date() },
    { new: true }
  );
};

const updateSubscription = async (userId, { plan, autoRenew }) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const endDateMap = {
    free: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    basic: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    premium: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    enterprise: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
  };

  if (plan) {
    user.subscription.plan = plan;
    user.subscription.startDate = new Date();
    user.subscription.endDate = endDateMap[plan];
    user.subscription.status = "ACTIVE";
  }
  if (typeof autoRenew === "boolean") {
    user.subscription.autoRenew = autoRenew;
  }
  await user.save();
  return user;
};

const deleteUser = async (userId) => {
  const user = await User.findByIdAndDelete(userId);
  if (!user) throw new Error("User not found");
  return user;
};

const getAllUsers = async () => {
  return await User.find().select("-password");
};

export default {
  handleLocalLogin,
  updateProfile,
  updateSubscription,
  deleteUser,
  getAllUsers,
};
  
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import session from "express-session";
import passport from "passport";
import authRoutes from "./routes/authRouter.js";
import emailRoutes from "./routes/emails.js";
import aiRoutes from "./routes/ai.js";
import "./config/passport.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://192.168.10.206:5173",
  "http://172.16.0.2:3000",
  "https://email-aichatbot.netlify.app",
  "https://email-ai-chat-bot-server.vercel.app",
];

app.use(cookieParser());
app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req, res, next) => {
  console.log(`Request received: ${req.method} ${req.path}`);
  next();
});

app.get("/", (req, res) => {
  res.send("Hello developer! How can I help you?");
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/emails", emailRoutes);
app.use("/api/v1/ai", aiRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res
    .status(500)
    .json({ error: "Something went wrong!", message: err.message });
});

// Catch-all 404 handler
app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: "Route not found", path: req.path });
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
  });

NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb+srv://nrbnayon:chatters@cluster0.f6x2ow6.mongodb.net/AIBot?retryWrites=true&w=majority

JWT_SECRET=4q35asdfads4adsfasd4adfat433aqagdfsg
JWT_EXPIRE_IN=24h
REFRESH_TOKEN_SECRET=4q35asdfads4adsfasd4adfat433aqagdfsg
JWT_REFRESH_EXPIRES_IN=7d

# Frontend URLs
FRONTEND_URL=http://localhost:5173
FRONTEND_LIVE_URL=https://ai-assistant-jade-rho.vercel.app

# OAuth 2.0 Configuration
# Google OAuth
GOOGLE_CLIENT_ID=637440655664-8jn20evpnggkks8p81o09fs4q99mt79s.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/auth/google/callback
GOOGLE_LIVE_REDIRECT_URI=https://aichatbot-sigma-mauve.vercel.app/api/v1/auth/google/callback

# Microsoft OAuth
MICROSOFT_CLIENT_ID=7fb509f4-8e49-489a-817a-abb83710bb11
MICROSOFT_CLIENT_SECRET=Tsg8Q~jGZZfkvQITGA9buVMI6eTu87zfph6t2aLI
MICROSOFT_REDIRECT_URI=http://localhost:4000/api/v1/auth/microsoft/callback
MICROSOFT_LIVE_REDIRECT_URI=https://aichatbot-sigma-mauve.vercel.app/api/v1/auth/microsoft/callback

# Yahoo OAuth
YAHOO_CLIENT_ID=dj0yJmk9V2dNazdsekx5cWIwJmQ9WVdrOWMwcHlXRTB3YjIwbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTRm
YAHOO_CLIENT_SECRET=6e6fa73b4774eefa41980386c519f59a199c472b
YAHOO_REDIRECT_URI=https://aichatbot-sigma-mauve.vercel.app/api/v1/auth/yahoo/callback
YAHOO_DEV_REDIRECT_URI=http://localhost:4000/api/v1/auth/yahoo/callback

# AI Service API Keys
GROQ_API_KEY=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
DEEPSEEK_API_KEY=sk-6bd4cb44605c4b208bc6dcf381c917c0

# Stripe Payment Gateway
STRIPE_SECRET_KEY=sk_test_51PNpt3P4ZGqybo6DHLWbjDqkVrcxkLbQS7WoECnVPAdeZMJkAnFHI2nUSRWrIozr4WRA6KBFvwZQWYJ7fUtWQz5T004FYTF9Vq
STRIPE_WEBHOOK_SECRET=whsec_5b2525123a8042ae8498d7db60c880688d73467890a9ba547ebcf613fed5fa32

# Rate Limiting
RATE_LIMIT=600000
RATE_MAX=100

Be carefull:: What i want  ?

I want 