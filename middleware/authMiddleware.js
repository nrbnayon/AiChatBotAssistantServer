// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import User from "../models/User.js";
import { safeCookie, cookieHelper } from "../helper/cookieHelper.js";
import { ApiError, catchAsync } from "../utils/errorHandler.js";

const logger = {
  info: (message, meta) => console.log(`[INFO] ${message}`, meta || ""),
  error: (message, meta) => console.error(`[ERROR] ${message}`, meta || ""),
};

const auth = (...roles) =>
  catchAsync(async (req, res, next) => {
    const accessToken =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.substring(7)
        : undefined);

    if (!accessToken) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid or missing token");
    }
    try {
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      console.log(
        "[DEBUG] Get User from DB after decoded accessToken:::",
        user?.email
      );

      if (!user || user.status !== "ACTIVE") {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "User not found or inactive"
        );
      }

      if (roles.length && !roles.includes(user.role)) {
        throw new ApiError(StatusCodes.FORBIDDEN, "Insufficient permissions");
      }

      // Set req.user for valid access token
      req.user = {
        id: user._id,
        role: user.role,
        email: user.email,
        authProvider: user.authProvider,
      };

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

        // Set req.user for refreshed access token
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
        return next();
      }
      console.error("[ERROR] Authentication error:", error);
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
