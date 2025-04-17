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
    { email, status: { $in: ["waiting", "rejected"] } },
    { status: "approved" },
    { new: true }
  );

  if (!entry) {
    return next(new ApiError(404, "Entry not found or already processed"));
  }

  const loginLink = `${process.env.FRONTEND_LIVE_URL}/login`;
  await userService.sendApprovalEmail(entry, loginLink);
  res.json({ message: "User approved successfully", entry });
});

const rejectWaitingList = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const entry = await WaitingList.findOneAndUpdate(
    { email, status: { $in: ["waiting", "approved"] } },
    { status: "rejected" },
    { new: true }
  );
  if (!entry)
    return next(new ApiError(404, "Entry not found or already processed"));
  res.json({ message: "User rejected", entry });
});

const getAllUsers = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const search = req.query.search || "";
  const status = req.query.status || null;

  const result = await userService.getAllUsers(page, limit, search, status);

  res.json({
    success: true,
    message: "Users fetched successfully",
    ...result,
  });
});

export const getAllWaitingList = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const status = req.query.status || null;
  const search = req.query.search || "";

  const result = await userService.searchWaitingList(
    page,
    limit,
    search,
    status
  );

  res.status(200).json({
    success: true,
    message: "Waiting list fetched successfully",
    ...result,
  });
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
  const user = await userService.updateProfile(req.user.id, req.body, req.file);

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
  const { name, email, password, role, status } = req.body;

  console.log("Get User Body:::", req.body);
  if (!name || !email || !password) {
    return next(new ApiError("Name, email, and password are required", 400));
  }

  const requesterRole = req.user.role || "admin";

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

  // Create the user without converting to object
  const newUser = await userService.createUser({
    name,
    email,
    password,
    role,
    status,
    returnDocument: true, // Add flag to indicate we need the mongoose document
  });

  const { accessToken, refreshToken } = generateTokens(newUser);
  newUser.refreshToken = refreshToken;

  // Send first login email for locally created users using service function
  await userService.sendFirstLoginEmail(newUser);
  newUser.firstLogin = false; // Set to false after sending email
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
    .json({
      success: true,
      data: newUser.toObject(),
      accessToken,
      refreshToken,
    });
});

const updateUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const updates = {
    ...req.body,
    updatedAt: new Date(),
  };
  const requesterRole = req.user.role;

  // Check if trying to update self
  if (id === req.user.id)
    return next(new ApiError(403, "Use /profile to update your own details"));

  // Find target user
  const targetUser = await User.findById(id);
  if (!targetUser) return next(new ApiError(404, "User not found"));

  // Permission checks based on role hierarchy
  if (requesterRole === "super_admin") {
    // Super Admin can update any field except for other super admins
    if (targetUser.role === "super_admin" && updates.status) {
      return next(
        new ApiError(403, "Cannot modify status of another Super Admin")
      );
    }
  } else if (requesterRole === "admin") {
    // Admins can only modify regular users, not other admins or super_admins
    if (targetUser.role === "super_admin" || targetUser.role === "admin") {
      return next(
        new ApiError(403, "Admins cannot modify other Admins or Super Admins")
      );
    }

    // Admins cannot change roles
    if (updates.role) {
      return next(new ApiError(403, "Admins cannot change user roles"));
    }
  } else {
    return next(new ApiError(403, "Unauthorized to update users"));
  }

  // Apply updates and save
  Object.assign(targetUser, updates);
  await targetUser.save();

  res.status(200).json({
    success: true,
    message: "User updated successfully",
    user: targetUser,
  });
});

const deleteUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const requesterRole = req.user.role;

  // Check if trying to delete self
  if (id === req.user.id)
    return next(new ApiError(403, "Cannot delete yourself"));

  // Find target user
  const targetUser = await User.findById(id);
  if (!targetUser) return next(new ApiError(404, "User not found"));

  // Permission checks based on role hierarchy
  if (requesterRole === "super_admin") {
    // Super Admin can delete any user or admin (but not other super_admins)
    if (targetUser.role === "super_admin") {
      return next(new ApiError(403, "Cannot delete another Super Admin"));
    }
  } else if (requesterRole === "admin") {
    // Admins can only delete regular users, not other admins or super_admins
    if (targetUser.role !== "user") {
      return next(
        new ApiError(
          403,
          "Admins can only delete regular Users, not other Admins or Super Admins"
        )
      );
    }
  } else {
    return next(new ApiError(403, "Unauthorized to delete users"));
  }

  // Delete the user
  await userService.deleteUser(id);

  res.status(200).json({
    success: true,
    message: "User deleted successfully",
  });
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
