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
