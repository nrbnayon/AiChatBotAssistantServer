// controllers\authController.js
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/User.js";
import userService from "../services/userService.js";
import { safeCookie } from "../helper/cookieHelper.js";
import { ApiError, AppError, catchAsync } from "../utils/errorHandler.js";
import { jwtHelper } from "./../helper/jwtHelper.js";
import { sendFirstLoginConfirmation } from "../helper/notifyByEmail.js";

dotenv.config();

const getFrontendUrl =
  process.env.NODE_ENV === "production"
    ? process.env.FRONTEND_LIVE_URL
    : process.env.FRONTEND_URL;

const generateTokens = (user) => {
  const accessPayload = {
    id: user._id,
    email: user.email,
    name: user.name || "User",
    role: user.role || "user",
    authProvider: user.authProvider,
    hasGoogleAuth: !!user.googleAccessToken,
    hasMicrosoftAuth: !!user.microsoftAccessToken,
  };
  const refreshPayload = { id: user._id };

  const accessToken = jwtHelper.createAccessToken(accessPayload);
  const refreshToken = jwtHelper.createRefreshToken(refreshPayload);
  return { accessToken, refreshToken };
};

const authError = (req, res) => {
  let message = req.query.message || "Authentication failed";
  if (req.session && req.session.messages && req.session.messages.length > 0) {
    message = req.session.messages[req.session.messages.length - 1];
    req.session.messages = [];
  }
  res.redirect(`${getFrontendUrl}/login?error=${encodeURIComponent(message)}`);
};

const oauthCallback = catchAsync(async (req, res) => {
  const { accessToken, refreshToken } = req.authInfo || {};
  const state = req.query.state
    ? JSON.parse(Buffer.from(req.query.state, "base64").toString())
    : {};

  const errorMsg =
    req.query.message ||
    (req.session && req.session.messages && req.session.messages[0]);

  if (errorMsg) {
    // console.log("OAuth callback error:", errorMsg);
    return res.redirect(
      `${getFrontendUrl}/login?error=${encodeURIComponent(errorMsg)}`
    );
  }

  if (!accessToken) {
    return res.redirect(
      `${getFrontendUrl}/login?error=${encodeURIComponent(
        "Authentication failed: No access token received"
      )}`
    );
  }

  safeCookie.set(res, "accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: jwtHelper.getAccessTokenExpiryMs(),
  });
  safeCookie.set(res, "refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: jwtHelper.getRefreshTokenExpiryMs(),
  });

  const redirectUrl = `${getFrontendUrl}/auth-callback?accessToken=${accessToken}&refreshToken=${refreshToken}&redirect=${encodeURIComponent(
    state.redirect || "/dashboard"
  )}`;
  res.redirect(redirectUrl);
});

const localLogin = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new AppError("Email and password are required", 400));
  }

  try {
    const user = await userService.handleLocalLogin(email, password);

    const { accessToken, refreshToken } = generateTokens(user);
    user.refreshToken = refreshToken;

    if (user.firstLogin) {
      await sendFirstLoginConfirmation(user);
      user.firstLogin = false;
    }

    await user.save();

    safeCookie.set(res, "accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: jwtHelper.getAccessTokenExpiryMs(),
    });
    safeCookie.set(res, "refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: jwtHelper.getRefreshTokenExpiryMs(),
    });

    res.json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    next(
      new AppError(error.message || "Login failed", error?.statusCode || 401)
    );
  }
});

const register = catchAsync(async (req, res, next) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return next(new AppError("Email and password are required", 400));
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError("User with this email already exists", 400));
  }

  const user = await User.create({
    email,
    password,
    name,
    authProvider: "local",
    subscription: {
      plan: "free",
      dailyQueries: 10000000,
      remainingQueries: 10000000,
      status: "active",
    },
  });

  const { accessToken, refreshToken } = generateTokens(user);
  user.refreshToken = refreshToken;
  await user.save();

  safeCookie.set(res, "accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: jwtHelper.getAccessTokenExpiryMs(),
  });
  safeCookie.set(res, "refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: jwtHelper.getRefreshTokenExpiryMs(),
  });

  res.json({
    success: true,
    message: "Registration successful",
    accessToken,
    refreshToken,
    user: { id: user._id, email: user.email, name: user.name },
  });
});

const refresh = catchAsync(async (req, res, next) => {
  // Get refresh token from cookie OR request body
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    return next(new AppError("Refresh token required", 401));
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return next(new ApiError(401, "User not found"));
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    // Update user's refresh token
    user.refreshToken = newRefreshToken;
    await user.save();

    // Set cookies with appropriate settings
    safeCookie.set(res, "accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: jwtHelper.getAccessTokenExpiryMs(),
      path: "/",
    });

    safeCookie.set(res, "refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: jwtHelper.getRefreshTokenExpiryMs(), // 30 days
      path: "/",
    });

    // Return tokens in response for clients that need them directly
    return res.json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name || "User",
        role: user.role,
      },
    });
  } catch (error) {
    // Clear cookies on verification error
    safeCookie.clear(res, "accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });

    safeCookie.clear(res, "refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });

    return next(new AppError("Invalid or expired refresh token", 401));
  }
});

const logout = catchAsync(async (req, res, next) => {
  if (req.user && req.user.id) {
    const user = await User.findById(req.user.id);
    if (user) {
      user.refreshToken = null;
      await user.save();
    }
  }

  req.session.destroy((err) => {
    if (err) return next(new AppError("Failed to clear session", 500));
  });

  safeCookie.clear(res, "accessToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  safeCookie.clear(res, "refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });

  res.json({ success: true, message: "Logged out successfully" });
});

export {
  generateTokens,
  authError,
  oauthCallback,
  localLogin,
  register,
  refresh,
  logout,
};
