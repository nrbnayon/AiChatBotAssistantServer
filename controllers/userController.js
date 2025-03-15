import User from "../models/User.js";
import userService from "../services/userService.js";
import { StatusCodes } from "http-status-codes"; // Import StatusCodes

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

const getMe = async (req, res, next) => {
  try {
    console.log("[DEBUG] getMe - req.user:", req.user);
    if (!req.user || !req.user.id) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "User not authenticated");
    }

    const user = await User.findById(req.user.id).select(
      "-googleAccessToken -refreshToken"
    );
    console.log("[DEBUG] getMe - Retrieved User:", user);

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
    }

    res.status(StatusCodes.OK).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("[ERROR] getMe Error:", error.message);
    next(error);
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

const getAllUsers = async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    res.json({ success: true, users });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export { getMe, updateProfile, updateSubscription, deleteMe, getAllUsers };
