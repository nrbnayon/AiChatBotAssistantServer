// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import User from "../models/User.js";
import { safeCookie, cookieHelper } from "../helper/cookieHelper.js";
import { ApiError, catchAsync } from "../utils/errorHandler.js";
import { jwtHelper } from "../helper/jwtHelper.js";

const logger = {
  info: (message, meta) => console.log(`[INFO] message log---`),
  error: (message, meta) => console.error(`[ERROR] ${message}`, meta || ""),
};

/**
 * Authentication middleware that verifies JWT tokens
 * @param {...string} roles - Optional roles to check (if any provided)
 * @returns {Function} Express middleware
 */
const auth = (...roles) =>
  catchAsync(async (req, res, next) => {
    // Extract token from cookie or Authorization header
    const accessToken =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.substring(7)
        : undefined);
    

    // If no access token is provided at all, check for refresh token
    if (!accessToken) {
      // Try to use refresh token if available
      const refreshToken = req.cookies?.refreshToken;

      if (refreshToken) {
        return handleTokenRefresh(refreshToken, req, res, next, roles);
      }

      throw new ApiError(StatusCodes.UNAUTHORIZED, "Authentication required");
    }

    try {
      // Verify the access token
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (!user || user.status !== "active") {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "User not found or inactive"
        );
      }

      // Check user roles if specified
      if (roles.length && !roles.includes(user.role)) {
        throw new ApiError(StatusCodes.FORBIDDEN, "Insufficient permissions");
      }

      // Attach user to request
      req.user = {
        id: user._id,
        name: user?.name || "User",
        role: user.role,
        email: user.email,
        authProvider: user.authProvider,
      };

      return next();
    } catch (error) {
      // Handle expired tokens
      if (error instanceof jwt.TokenExpiredError) {
        const refreshToken = req.cookies?.refreshToken;

        // If refresh token exists, use it to get a new access token
        if (refreshToken) {
          return handleTokenRefresh(refreshToken, req, res, next, roles);
        }

        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "Session expired, please log in again"
        );
      }

      throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid access token");
    }
  });

/**
 * Helper function to handle token refresh
 * @param {string} refreshToken - The refresh token
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 * @param {Array} roles - Roles to check
 */
const handleTokenRefresh = async (refreshToken, req, res, next, roles) => {
  try {
    // Verify refresh token
    const decodedRefresh = jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    // Find the user
    const user = await User.findById(decodedRefresh.id);

    // Validate user exists and refresh token matches
    if (!user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not found");
    }

    // Optional: Uncomment if you want to strictly verify the stored refresh token
    // This adds security but may cause issues if tokens are not consistently stored
    if (user.refreshToken !== refreshToken) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid refresh token");
    }

    // Check user roles if specified
    if (roles.length && !roles.includes(user.role)) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Insufficient permissions");
    }

    // Generate new tokens
    const payload = {
      id: user._id,
      email: user.email,
      name: user.name || "User",
      role: user.role,
      authProvider: user.authProvider,
      hasGoogleAuth: !!user.googleAccessToken,
      hasMicrosoftAuth: !!user.microsoftAccessToken,
    };

    const newAccessToken = jwtHelper.createAccessToken(payload);

    // Attach user to request
    req.user = {
      id: user._id,
      role: user.role,
      name: user?.name || "User",
      email: user.email,
      authProvider: user.authProvider,
    };

    // Mark token as refreshed for the middleware
    req.tokenRefreshed = true;
    req.newAccessToken = newAccessToken;

    // Set the new access token cookie
    safeCookie.set(
      res,
      "accessToken",
      newAccessToken,
      cookieHelper.getAccessTokenOptions()
    );

    logger.info(`Access token refreshed for user: ${user.email}`);

    return next();
  } catch (error) {
    logger.error("Refresh token error:", error);
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Invalid or expired session. Please log in again."
    );
  }
};

/**
 * Middleware to ensure refreshed tokens are properly set in cookies
 */
const setRefreshedTokenCookie = catchAsync(async (req, res, next) => {
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
});

export default auth;
export { setRefreshedTokenCookie };
