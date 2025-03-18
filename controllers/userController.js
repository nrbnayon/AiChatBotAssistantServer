import User from "../models/User.js";
import userService from "../services/userService.js";
import { StatusCodes } from "http-status-codes";
import { ApiError, catchAsync } from "../utils/errorHandler.js";

const getMe = catchAsync(async (req, res, next) => {
  if (!req.user || !req.user.id) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User not authenticated");
  }

  const user = await User.findById(req.user.id).select(
    "-googleAccessToken -refreshToken -microsoftAccessToken -yahooAccessToken -password"
  );

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  res.status(StatusCodes.OK).json({
    success: true,
    data: user,
  });
});

const updateProfile = catchAsync(async (req, res, next) => {
  const user = await userService.updateProfile(req.user.id, req.body);
  res.json({ success: true, user });
});

const updateSubscription = catchAsync(async (req, res, next) => {
  const user = await userService.updateSubscription(req.user.id, req.body);
  res.json({ success: true, user });
});

const deleteMe = catchAsync(async (req, res, next) => {
  await userService.deleteUser(req.user.id);
  res.json({ success: true, message: "User deleted" });
});

const getAllUsers = catchAsync(async (req, res, next) => {
  const users = await userService.getAllUsers();
  res.json({ success: true, users });
});

const updateKeywords = catchAsync(async (req, res, next) => {
  const { keywords } = req.body;

  if (!Array.isArray(keywords)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Keywords must be an array");
  }
  if (keywords.some((kw) => typeof kw !== "string" || kw.trim() === "")) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "All keywords must be non-empty strings"
    );
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  user.userImportantMailKeywords = keywords;
  await user.save();

  res.status(StatusCodes.OK).json({
    success: true,
    data: user.userImportantMailKeywords,
  });
});

const createUser = catchAsync(async (req, res, next) => {
  const { name, email, password, role } = req.body;

  // Validate required fields
  if (!email || !password) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Email and password are required"
    );
  }

  // Validate role if provided
  if (role && !["USER", "ADMIN"].includes(role)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid role");
  }

  const newUser = await userService.createUser({ name, email, password, role });
  res.status(StatusCodes.CREATED).json({
    success: true,
    data: newUser,
  });
});

const deleteUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // Prevent admin from deleting themselves
  if (id === req.user.id) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Cannot delete yourself");
  }

  await userService.deleteUser(id);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "User deleted successfully",
  });
});

export {
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  getAllUsers,
  updateKeywords,
  createUser,
  deleteUser,
};
