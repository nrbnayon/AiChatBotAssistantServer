// controllers\userController.js
import User from "../models/User.js";
import userService from "../services/userService.js";
import WaitingList from "../models/WaitingList.js";
import { StatusCodes } from "http-status-codes";
import { ApiError, catchAsync } from "../utils/errorHandler.js";
import Stripe from "stripe";
import AiModel from "../models/AiModel.js";
import SystemMessage from "../models/SystemMessage.js";
import { safeCookie } from "../helper/cookieHelper.js";
import { generateTokens } from "./authController.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const getIncome = catchAsync(async (req, res, next) => {
  const { period, startDate, endDate } = req.query;
  let created = {};
  if (period === "daily")
    created.gte = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  else if (period === "weekly")
    created.gte = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  else if (period === "monthly")
    created.gte = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  else if (startDate && endDate) {
    created.gte = Math.floor(new Date(startDate).getTime() / 1000);
    created.lte = Math.floor(new Date(endDate).getTime() / 1000);
  }
  const charges = await stripe.charges.list({ created });
  const totalIncome =
    charges.data.reduce((sum, charge) => sum + charge.amount, 0) / 100;
  res.json({ totalIncome });
});

const getUserStats = catchAsync(async (req, res) => {
  const totalUsers = await User.countDocuments();
  const activeSubscriptions = await User.countDocuments({
    "subscription.status": "active",
  });
  const waitingListUsers = await WaitingList.countDocuments({
    status: "waiting",
  });
  res.json({ totalUsers, activeSubscriptions, waitingListUsers });
});

const approveWaitingList = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const entry = await WaitingList.findOneAndUpdate(
    { email, status: "waiting" },
    { status: "approved" },
    { new: true }
  );
  if (!entry)
    return next(new ApiError("Entry not found or already processed", 404));
  res.json({ message: "User approved", entry });
});

const rejectWaitingList = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const entry = await WaitingList.findOneAndUpdate(
    { email, status: "waiting" },
    { status: "rejected" },
    { new: true }
  );
  if (!entry)
    return next(new ApiError("Entry not found or already processed", 404));
  res.json({ message: "User rejected", entry });
});

const getMe = catchAsync(async (req, res, next) => {
  if (!req.user || !req.user.id)
    return next(new ApiError("User not authenticated", 400));
  const user = await User.findById(req.user.id).select(
    "-googleAccessToken -refreshToken -microsoftAccessToken -password"
  );
  if (!user) return next(new ApiError("User not found", 404));
  res.status(StatusCodes.OK).json({ success: true, data: user });
});

const updateProfile = catchAsync(async (req, res) => {
   const user = await userService.updateProfile(
     req.user.id,
     req.body,
     req.file
   );

  res.json({
    success: true,
    message: "Profile updated successfully",
    user: user,
  });
});

const updateSubscription = catchAsync(async (req, res) => {
  const user = await userService.updateSubscription(req.user.id, req.body);
  res.json({ success: true, user });
});

const deleteMe = catchAsync(async (req, res) => {
  await userService.deleteUser(req.user.id);
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
  res.json({ success: true, message: "User deleted" });
});

const getAllUsers = catchAsync(async (req, res) => {
  const users = await userService.getAllUsers();
  res.json({ success: true, users });
});

const updateKeywords = catchAsync(async (req, res, next) => {
  const { keywords } = req.body;
  if (!Array.isArray(keywords))
    return next(new ApiError("Keywords must be an array", 400));
  if (keywords.some((kw) => typeof kw !== "string" || kw.trim() === "")) {
    return next(new ApiError("All keywords must be non-empty strings", 400));
  }
  const user = await User.findById(req.user.id);
  if (!user) return next(new ApiError("User not found", 404));
  user.userImportantMailKeywords = keywords;
  await user.save();
  res
    .status(StatusCodes.OK)
    .json({ success: true, data: user.userImportantMailKeywords });
});

const createUser = catchAsync(async (req, res, next) => {
  const { name, email, password, role } = req.body;
  const requesterRole = req.user.role || "admin";

  if (!email || !password)
    return next(new ApiError("Email and password are required", 400));

  if (requesterRole === "super_admin") {
    if (role && !["user", "admin", "super_admin"].includes(role)) {
      return next(new ApiError("Invalid role", 400));
    }
  } else if (requesterRole === "admin") {
    if (role && !["user", "admin"].includes(role)) {
      return next(new ApiError("Admins cannot create Super Admins", 403));
    }
  } else {
    return next(new ApiError("Unauthorized to create users", 403));
  }

  const newUser = await userService.createUser({ name, email, password, role });
  const { accessToken, refreshToken } = generateTokens(newUser);
  newUser.refreshToken = refreshToken;
  await newUser.save();

  safeCookie.set(res, "accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
  safeCookie.set(res, "refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res
    .status(StatusCodes.CREATED)
    .json({ success: true, data: newUser, accessToken, refreshToken });
});

const updateUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const updates = req.body;
  const requesterRole = req.user.role;

  if (id === req.user.id)
    return next(new ApiError("Use /profile to update your own details", 403));

  const targetUser = await User.findById(id);
  if (!targetUser) return next(new ApiError("User not found", 404));

  if (requesterRole === "super_admin") {
    // Super Admin can update any field
  } else if (requesterRole === "admin") {
    if (targetUser.role === "super_admin")
      return next(new ApiError("Admins cannot modify Super Admins", 403));
    if (updates.role)
      return next(new ApiError("Admins cannot change user roles", 403));
    if (updates.status && targetUser.role !== "user") {
      return next(new ApiError("Admins can only change status of Users", 403));
    }
  } else {
    return next(new ApiError("Unauthorized to update users", 403));
  }

  Object.assign(targetUser, updates);
  await targetUser.save();
  res.json({ success: true, user: targetUser });
});

const deleteUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const requesterRole = req.user.role;

  if (id === req.user.id)
    return next(new ApiError("Cannot delete yourself", 403));

  const targetUser = await User.findById(id);
  if (!targetUser) return next(new ApiError("User not found", 404));

  if (requesterRole === "super_admin") {
    // Super Admin can delete any user
  } else if (requesterRole === "admin") {
    if (targetUser.role !== "user")
      return next(new ApiError("Admins can only delete Users", 403));
  } else {
    return next(new ApiError("Unauthorized to delete users", 403));
  }

  await userService.deleteUser(id);
  res
    .status(StatusCodes.OK)
    .json({ success: true, message: "User deleted successfully" });
});

const addInbox = catchAsync(async (req, res, next) => {
  const { inbox } = req.body;
  const user = await User.findById(req.user.id);
  if (!user) return next(new ApiError("User not found", 404));
  const maxInboxes = { basic: 1, premium: 3, enterprise: 10 }[
    user.subscription.plan
  ];
  if (user.inboxList.length >= maxInboxes) {
    return next(new ApiError("Inbox limit reached for your plan", 400));
  }
  if (!user.inboxList.includes(inbox)) {
    user.inboxList.push(inbox);
    await user.save();
  }
  res.json({ message: "Inbox added", inboxList: user.inboxList });
});

// System Messages Management
const getAllSystemMessages = catchAsync(async (req, res) => {
  const systemMessages = await SystemMessage.find();
  res.json({ success: true, systemMessages });
});

const getSystemMessage = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const systemMessage = await SystemMessage.findById(id);
  if (!systemMessage) {
    return next(new ApiError("System message not found", 404));
  }
  res.json({ success: true, systemMessage });
});

const createSystemMessage = catchAsync(async (req, res) => {
  const { content, isDefault } = req.body;
  if (!content) throw new ApiError("Content is required", 400);

  if (isDefault) {
    await SystemMessage.updateMany({}, { isDefault: false });
  }
  const newSystemMessage = new SystemMessage({ content, isDefault });
  await newSystemMessage.save();
  res.status(201).json({ success: true, systemMessage: newSystemMessage });
});

const updateSystemMessage = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { content, isDefault } = req.body;

  if (isDefault) {
    await SystemMessage.updateMany({}, { isDefault: false });
  }
  const systemMessage = await SystemMessage.findByIdAndUpdate(
    id,
    { content, isDefault, updatedAt: new Date() },
    { new: true }
  );
  if (!systemMessage) {
    return next(new ApiError("System message not found", 404));
  }
  res.json({ success: true, systemMessage });
});

const deleteSystemMessage = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const systemMessage = await SystemMessage.findById(id);
  if (!systemMessage) {
    return next(new ApiError("System message not found", 404));
  }
  if (systemMessage.isDefault) {
    const totalMessages = await SystemMessage.countDocuments();
    if (totalMessages <= 1) {
      return next(
        new ApiError("Cannot delete the only default system message", 403)
      );
    }
  }
  await systemMessage.remove();
  res.json({ success: true, message: "System message deleted" });
});

// AI Model Management
const getAllAiModels = catchAsync(async (req, res) => {
  const aiModels = await AiModel.find();
  res.json({ success: true, aiModels });
});

const getAiModel = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const aiModel = await AiModel.findById(id);
  if (!aiModel) {
    return next(new ApiError("AI model not found", 404));
  }
  res.json({ success: true, aiModel });
});

const createAiModel = catchAsync(async (req, res) => {
  const { modelId, name, developer, contextWindow, description, isDefault } =
    req.body;
  if (!modelId || !name || !developer || !contextWindow || !description) {
    throw new ApiError("All fields are required", 400);
  }
  const existingModel = await AiModel.findOne({ modelId });
  if (existingModel) {
    throw new ApiError("Model with this ID already exists", 400);
  }
  if (isDefault) {
    await AiModel.updateMany({}, { isDefault: false });
  }
  const newAiModel = new AiModel({
    modelId,
    name,
    developer,
    contextWindow,
    description,
    isDefault,
  });
  await newAiModel.save();
  res.status(201).json({ success: true, aiModel: newAiModel });
});

const updateAiModel = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { modelId, name, developer, contextWindow, description, isDefault } =
    req.body;
  const aiModel = await AiModel.findById(id);
  if (!aiModel) {
    return next(new ApiError("AI model not found", 404));
  }
  if (isDefault) {
    await AiModel.updateMany({}, { isDefault: false });
  }
  aiModel.modelId = modelId || aiModel.modelId;
  aiModel.name = name || aiModel.name;
  aiModel.developer = developer || aiModel.developer;
  aiModel.contextWindow = contextWindow || aiModel.contextWindow;
  aiModel.description = description || aiModel.description;
  aiModel.isDefault = isDefault !== undefined ? isDefault : aiModel.isDefault;
  aiModel.updatedAt = new Date();
  await aiModel.save();
  res.json({ success: true, aiModel });
});

const deleteAiModel = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const aiModel = await AiModel.findById(id);
  if (!aiModel) {
    return next(new ApiError("AI model not found", 404));
  }
  if (aiModel.isDefault) {
    const totalModels = await AiModel.countDocuments();
    if (totalModels <= 1) {
      return next(new ApiError("Cannot delete the only default AI model", 403));
    }
  }
  await aiModel.remove();
  res.json({ success: true, message: "AI model deleted" });
});

export {
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  getAllUsers,
  updateKeywords,
  createUser,
  updateUser,
  deleteUser,
  addInbox,
  getIncome,
  getUserStats,
  approveWaitingList,
  rejectWaitingList,
  getAllSystemMessages,
  getSystemMessage,
  createSystemMessage,
  updateSystemMessage,
  deleteSystemMessage,
  getAllAiModels,
  getAiModel,
  createAiModel,
  updateAiModel,
  deleteAiModel,
};
