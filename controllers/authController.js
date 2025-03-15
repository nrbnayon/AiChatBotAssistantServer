import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/User.js";
import userService from "../services/userService.js";

dotenv.config();

const getFrontendUrl =
  process.env.NODE_ENV === "production"
    ? process.env.FRONTEND_LIVE_URL
    : process.env.FRONTEND_URL;

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      hasGoogleAuth: !!user.googleAccessToken,
      hasMicrosoftAuth: !!user.microsoftAccessToken,
      hasYahooAuth: !!user.yahooAccessToken,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

const googleCallback = (req, res) => {
  const token = generateToken(req.user);
  res.redirect(`${getFrontendUrl}/auth-callback?token=${token}`);
};

const microsoftCallback = (req, res) => {
  const token = generateToken(req.user);
  res.redirect(`${getFrontendUrl}/auth-callback?token=${token}`);
};

const yahooCallback = (req, res) => {
  const token = generateToken(req.user);
  res.redirect(`${getFrontendUrl}/auth-callback?token=${token}`);
};

const localLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await userService.handleLocalLogin(email, password);
    const token = generateToken(user);
    res.json({
      success: true,
      token,
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
    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: { id: user._id, email: user.email, name: user.name },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const user = await userService.updateProfile(req.user._id, req.body);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateSubscription = async (req, res) => {
  try {
    const user = await userService.updateSubscription(req.user._id, req.body);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteMe = async (req, res) => {
  try {
    await userService.deleteUser(req.user._id);
    res.json({ success: true, message: "User deleted" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const logout = (req, res) => {
  req.logout((err) => {
    if (err)
      return res.status(500).json({ success: false, message: "Logout failed" });
    res.json({ success: true, message: "Logged out successfully" });
  });
};

const getAllUsers = async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    res.json({ success: true, users });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export default {
  getFrontendUrl,
  googleCallback,
  microsoftCallback,
  yahooCallback,
  localLogin,
  register,
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  logout,
  getAllUsers,
};
