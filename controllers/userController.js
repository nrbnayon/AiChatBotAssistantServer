import User from "../models/User.js";
import userService from "../services/userService.js";
import { StatusCodes } from "http-status-codes";
import { ApiError, catchAsync } from "../utils/errorHandler.js";

const getMe = catchAsync(async (req, res, next) => {
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

export { getMe, updateProfile, updateSubscription, deleteMe, getAllUsers };
