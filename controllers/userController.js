// controllers\userController.js
import User from "../models/User.js";
import userService from "../services/userService.js";
import WaitingList from "../models/WaitingList.js";
import { StatusCodes } from "http-status-codes";
import { ApiError, catchAsync } from "../utils/errorHandler.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const getIncome = catchAsync(async (req, res, next) => {
  const { period, startDate, endDate } = req.query;
  let created = {};

  if (period === "daily") {
    created.gte = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  } else if (period === "weekly") {
    created.gte = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  } else if (period === "monthly") {
    created.gte = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  } else if (startDate && endDate) {
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

  if (!entry) {
    return next(new ApiError("Entry not found or already processed", 404));
  }
  res.json({ message: "User approved", entry });
});

const rejectWaitingList = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const entry = await WaitingList.findOneAndUpdate(
    { email, status: "waiting" },
    { status: "rejected" },
    { new: true }
  );

  if (!entry) {
    return next(new ApiError("Entry not found or already processed", 404));
  }
  res.json({ message: "User rejected", entry });
});

const getMe = catchAsync(async (req, res, next) => {
  if (!req.user || !req.user.id) {
    return next(new ApiError("User not authenticated", 400));
  }

  const user = await User.findById(req.user.id).select(
    "-googleAccessToken -refreshToken -microsoftAccessToken -password"
  );
  if (!user) return next(new ApiError("User not found", 404));

  res.status(StatusCodes.OK).json({ success: true, data: user });
});

const updateProfile = catchAsync(async (req, res) => {
  const user = await userService.updateProfile(req.user.id, req.body);
  res.json({ success: true, user });
});

const updateSubscription = catchAsync(async (req, res) => {
  const user = await userService.updateSubscription(req.user.id, req.body);
  res.json({ success: true, user });
});

const deleteMe = catchAsync(async (req, res) => {
  await userService.deleteUser(req.user.id);
  res.json({ success: true, message: "User deleted" });
});

const getAllUsers = catchAsync(async (req, res) => {
  const users = await userService.getAllUsers();
  res.json({ success: true, users });
});

const updateKeywords = catchAsync(async (req, res, next) => {
  const { keywords } = req.body;

  if (!Array.isArray(keywords)) {
    return next(new ApiError("Keywords must be an array", 400));
  }
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

  if (!email || !password) {
    return next(new AppError("Email and password are required", 400));
  }
  if (role && !["user", "admin"].includes(role)) {
    return next(new AppError("Invalid role", 400));
  }

  const newUser = await userService.createUser({ name, email, password, role });
  res.status(StatusCodes.CREATED).json({ success: true, data: newUser });
});

const deleteUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return next(new ApiError("Cannot delete yourself", 403));
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
  const maxInboxes = {
    basic: 1,
    premium: 3,
    enterprise: 10,
  }[user.subscription.plan];

  if (user.inboxList.length >= maxInboxes) {
    return next(new ApiError("Inbox limit reached for your plan", 400));
  }

  if (!user.inboxList.includes(inbox)) {
    user.inboxList.push(inbox);
    await user.save();
  }

  res.json({ message: "Inbox added", inboxList: user.inboxList });
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
  addInbox,
  getIncome,
  getUserStats,
  approveWaitingList,
  rejectWaitingList,
};
