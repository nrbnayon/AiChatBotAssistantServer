// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import User from "../models/User.js";
import { safeCookie, cookieHelper } from "../helper/cookieHelper.js";
// import { createEmailService } from "../services/emailService.js";
import { ApiError, catchAsync } from "../utils/errorHandler.js";

const logger = {
  info: (message, meta) => console.log(`[INFO] ${message}`, meta || ""),
  error: (message, meta) => console.error(`[ERROR] ${message}`, meta || ""),
};

const auth = (...roles) =>
  catchAsync(async (req, res, next) => {
    // console.log("[DEBUG] Cookies:", req.cookies);
    // console.log("[DEBUG] Authorization Header:", req.headers.authorization);

    const accessToken =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.substring(7)
        : undefined);

    if (!accessToken) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid or missing token");
    }

    // console.log("[DEBUG] Access Token:", accessToken);

    try {
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      console.log("[DEBUG] Decoded Token:", decoded);

      const user = await User.findById(decoded.id);
      // console.log("[DEBUG] Found User:", user);

      if (!user || user.status !== "ACTIVE") {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "User not found or inactive"
        );
      }

      if (roles.length && !roles.includes(user.role)) {
        throw new ApiError(StatusCodes.FORBIDDEN, "Insufficient permissions");
      }

      // Trigger email sync if status is PENDING
      // if (user.emailSyncStatus === "PENDING") {
      //   req.user = {
      //     id: decoded.id,
      //     role: decoded.role,
      //     email: decoded.email,
      //     authProvider: decoded.authProvider,
      //   };
      //   const emailService = await createEmailService(req);
      //   await emailService.syncEmails();
      //   // Refresh the user object after sync
      //   const updatedUser = await User.findById(decoded.id).select("-password");
      //   req.user = {
      //     id: updatedUser._id,
      //     role: updatedUser.role,
      //     email: updatedUser.email,
      //     authProvider: updatedUser.authProvider,
      //   };
      // } else {
      //   req.user = {
      //     id: user._id,
      //     role: user.role,
      //     email: user.email,
      //     authProvider: user.authProvider,
      //   };
      // }

      return next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        console.log("[DEBUG] Access token expired, attempting refresh");

        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Refresh token required"
          );
        }

        const decodedRefresh = jwt.verify(
          refreshToken,
          process.env.REFRESH_TOKEN_SECRET
        );
        const user = await User.findById(decodedRefresh.id);

        if (!user || user.refreshToken !== refreshToken) {
          throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid refresh token");
        }

        if (roles.length && !roles.includes(user.role)) {
          throw new ApiError(StatusCodes.FORBIDDEN, "Insufficient permissions");
        }

        const newAccessToken = jwt.sign(
          {
            id: user._id,
            role: user.role,
            email: user.email,
            authProvider: user.authProvider,
          },
          process.env.JWT_SECRET,
          { expiresIn: "1d" }
        );

        req.user = {
          id: user._id,
          role: user.role,
          email: user.email,
          authProvider: user.authProvider,
        };
        req.tokenRefreshed = true;
        req.newAccessToken = newAccessToken;

        safeCookie.set(
          res,
          "accessToken",
          newAccessToken,
          cookieHelper.getAccessTokenOptions()
        );
        // console.log("[DEBUG] New Access Token Set:", newAccessToken);
        return next();
      }
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid access token");
    }
  });

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
