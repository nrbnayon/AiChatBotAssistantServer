// controllers/authController.js
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/User.js";
import userService from "../services/userService.js";
import { safeCookie } from "../helper/cookieHelper.js";
import { AppError, catchAsync } from "../utils/errorHandler.js";

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
    authProvider: user.authProvider,
    hasGoogleAuth: !!user.googleAccessToken,
    hasMicrosoftAuth: !!user.microsoftAccessToken,
    hasYahooAuth: !!user.yahooAccessToken,
  };
  console.log("[DEBUG] Generating tokens for payload:", payload);
  console.log("[DEBUG] JWT_SECRET:", process.env.JWT_SECRET);

  if (!process.env.JWT_SECRET) {
    throw new AppError(
      "JWT_SECRET is not defined in environment variables",
      500
    );
  }

  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new AppError(
      "REFRESH_TOKEN_SECRET is not defined in environment variables",
      500
    );
  }

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  const refreshToken = jwt.sign(
    { id: payload.id },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: "30d",
    }
  );
  console.log("[DEBUG] Generated Tokens:", { accessToken, refreshToken });
  return { accessToken, refreshToken };
};

const authError = (req, res) => {
  const message = req.query.message || "Authentication failed";
  console.log("[DEBUG] Auth Error:", message);
  res.redirect(`${getFrontendUrl}/login?error=${encodeURIComponent(message)}`);
};

const oauthCallback = catchAsync(async (req, res, next) => {
  const { accessToken, refreshToken } = req.authInfo || {};
  const state = req.query.state
    ? JSON.parse(Buffer.from(req.query.state, "base64").toString())
    : {};

  console.log("[DEBUG] OAuth Callback - Tokens:", {
    accessToken,
    refreshToken,
  });
  console.log("[DEBUG] OAuth Callback - State:", state);

  if (!accessToken) {
    console.log("[DEBUG] No access token in OAuth callback");
    return res.redirect(
      `${getFrontendUrl}/login?error=${encodeURIComponent(
        "Authentication failed: No access token"
      )}`
    );
  }

  safeCookie.set(res, "accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
  safeCookie.set(res, "refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  const redirectUrl = `${getFrontendUrl}/auth-callback?token=${accessToken}&refreshToken=${refreshToken}&redirect=${encodeURIComponent(
    state.redirect || "/"
  )}`;
  console.log("[DEBUG] Redirecting to:", redirectUrl);
  res.redirect(redirectUrl);
});

const localLogin = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError("Email and password are required", 400));
  }

  const user = await userService.handleLocalLogin(email, password);

  if (!user) {
    return next(new AppError("Invalid credentials", 401));
  }

  const { accessToken, refreshToken } = generateTokens(user);

  user.refreshToken = refreshToken;
  await user.save();

  safeCookie.set(res, "accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
  safeCookie.set(res, "refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({
    success: true,
    accessToken,
    refreshToken,
    user: { id: user._id, email: user.email, name: user.name },
  });
});

const register = catchAsync(async (req, res, next) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return next(new AppError("Email and password are required", 400));
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError("User with this email already exists", 400));
  }

  const user = await User.create({
    email,
    password,
    name,
    authProvider: "local",
    subscription: { plan: "free", dailyTokens: 100 },
  });

  const { accessToken, refreshToken } = generateTokens(user);

  user.refreshToken = refreshToken;
  await user.save();

  safeCookie.set(res, "accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
  safeCookie.set(res, "refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({
    success: true,
    accessToken,
    refreshToken,
    user: { id: user._id, email: user.email, name: user.name },
  });
});

const refresh = catchAsync(async (req, res, next) => {
  console.log("[DEBUG] Refresh - Body:", req.body);
  console.log("[DEBUG] Refresh - Cookies:", req.cookies);
  const refreshToken = req.body.refreshToken || req.cookies.refreshToken;

  if (!refreshToken) {
    return next(new AppError("Refresh token required", 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch (error) {
    return next(new AppError("Invalid or expired refresh token", 401));
  }

  console.log("[DEBUG] Refresh - Decoded Refresh Token:", decoded);
  const user = await User.findById(decoded.id);

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  if (user.refreshToken !== refreshToken) {
    return next(new AppError("Invalid refresh token", 401));
  }

  const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
  user.refreshToken = newRefreshToken;
  await user.save();

  safeCookie.set(res, "accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
  safeCookie.set(res, "refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({ success: true, accessToken, refreshToken: newRefreshToken });
});

const logout = catchAsync(async (req, res, next) => {
  console.log("get logout user:::", req.user);

  // Invalidate refresh token if user is authenticated
  if (req.user && req.user.id) {
    try {
      const user = await User.findById(req.user.id);
      if (user) {
        user.refreshToken = null;
        await user.save();
      } else {
        console.warn(
          "[DEBUG] User not found in database during logout, id:",
          req.user.id
        );
      }
    } catch (error) {
      return next(new AppError("Failed to invalidate refresh token", 500));
    }
  } else {
    console.warn(
      "[DEBUG] No user found in session, proceeding to clear cookies"
    );
  }

  // Clear cookies
  try {
    safeCookie.clear(res, "accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    safeCookie.clear(res, "refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
  } catch (error) {
    return next(new AppError("Failed to clear cookies", 500));
  }

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
