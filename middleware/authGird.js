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
