// services\userService.js
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import WaitingList from "../models/WaitingList.js";
import { ApiError, AppError } from "../utils/errorHandler.js";
import path from "path";

// Define plan configurations
const planConfigs = {
  free: { dailyQueries: 5, maxInboxes: 1 },
  basic: { dailyQueries: 15, maxInboxes: 1 },
  premium: { dailyQueries: Infinity, maxInboxes: 3 },
  enterprise: { dailyQueries: 10000000000000, maxInboxes: 10 },
};

const handleLocalLogin = async (email, password) => {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user)
    throw new AppError("User Does Not Exist Try With Correct Email", 401);
  if (user.authProvider !== "local")
    throw new AppError("Invalid authentication method", 401);
  if (!user.password)
    throw new AppError("Password not set for this account", 401);
  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new ApiError(401, "Invalid credentials");
  return user;
};

const updateProfile = async (userId, profileData, file) => {
  const allowedFields = [
    "name",
    "phone",
    "address",
    "country",
    "gender",
    "dateOfBirth",
    "profilePicture",
  ];
  const updates = Object.keys(profileData)
    .filter((key) => allowedFields.includes(key))
    .reduce((obj, key) => ({ ...obj, [key]: profileData[key] }), {});
  if (file) {
    const fileExt = path.extname(file.originalname).toLowerCase();
    updates.profilePicture = `https://server.inbox-buddy.ai/uploads/images/${userId}${fileExt}`;
  }
  if (Object.keys(updates).length === 0)
    throw new ApiError(400, "No valid fields to update");
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { ...updates, lastSync: new Date() },
    { new: true }
  );
  if (!updatedUser) throw new ApiError(404, "User not found or update failed");
  return updatedUser;
};

const updateSubscription = async (userId, { plan, autoRenew }) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");
  if (plan && planConfigs[plan]) {
    user.subscription.plan = plan;
    user.subscription.startDate = plan !== "free" ? new Date() : undefined;
    user.subscription.dailyQueries = planConfigs[plan].dailyQueries;
    user.subscription.remainingQueries = planConfigs[plan].dailyQueries;
    user.subscription.status = "active";
    user.subscription.endDate =
      plan !== "free"
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        : undefined;
    if (user.inboxList.length > planConfigs[plan].maxInboxes) {
      user.inboxList = user.inboxList.slice(0, planConfigs[plan].maxInboxes);
    }
  }
  if (typeof autoRenew === "boolean") user.subscription.autoRenew = autoRenew;
  await user.save();
  return user;
};

const deleteUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  // Delete all chats associated with the user
  await Chat.deleteMany({ userId });

  // Remove user from waiting list if exists
  await WaitingList.deleteOne({ email: user.email });

  // Delete the user
  await User.findByIdAndDelete(userId);
};

const getAllUsers = async (
  page = 1,
  limit = 10,
  searchQuery = "",
  status = null
) => {
  const skip = (page - 1) * limit;
  let query = {};
  if (status) query.status = status;
  if (searchQuery) {
    query = {
      ...query,
      $or: [
        { name: { $regex: searchQuery, $options: "i" } },
        { email: { $regex: searchQuery, $options: "i" } },
      ],
    };
  }
  const users = await User.find(query)
    .select("-password -refreshToken -googleAccessToken -microsoftAccessToken")
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 })
    .lean();
  const totalUsers = await User.countDocuments(query);
  return {
    users,
    totalCount: totalUsers,
    totalPages: Math.ceil(totalUsers / limit),
    currentPage: page,
  };
};

const searchWaitingList = async (
  page = 1,
  limit = 10,
  searchQuery = "",
  status = null
) => {
  const skip = (page - 1) * limit;
  let query = {};
  if (status) query.status = status;
  if (searchQuery) {
    query = {
      ...query,
      $or: [
        { name: { $regex: searchQuery, $options: "i" } },
        { email: { $regex: searchQuery, $options: "i" } },
      ],
    };
  }
  const waitingList = await WaitingList.aggregate([
    { $match: query },
    {
      $addFields: {
        sortOrder: {
          $cond: { if: { $eq: ["$status", "waiting"] }, then: 0, else: 1 },
        },
      },
    },
    { $sort: { sortOrder: 1, createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);
  const totalWaiting = await WaitingList.countDocuments(query);
  return {
    data: waitingList,
    total: totalWaiting,
    totalPages: Math.ceil(totalWaiting / limit),
    currentPage: page,
  };
};

const createUser = async ({
  name,
  email,
  password,
  role,
  status,
  returnDocument,
}) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) throw new ApiError(400, "User already exists");
  const plan = "free"; 
  const newUser = new User({
    name,
    email,
    password,
    role: role || "user",
    authProvider: "local",
    status: status || "active",
    inboxList: [email],
    subscription: {
      plan,
      dailyQueries: planConfigs[plan].dailyQueries,
      remainingQueries: planConfigs[plan].dailyQueries,
      status: "active",
    },
  });
  await newUser.save();
  return returnDocument
    ? newUser
    : (({ password: _, ...rest }) => rest)(newUser.toObject());
};

// Email services
const sendWaitingListConfirmation = async (entry) => {
  try {
    // Import directly in the function to avoid circular dependencies
    const { sendWaitingListConfirmation } = await import(
      "../helper/notifyByEmail.js"
    );
    return await sendWaitingListConfirmation(entry);
  } catch (error) {
    console.error("Failed to send waiting list confirmation:", error);
    throw error;
  }
};

const sendAdminNotification = async (entry) => {
  try {
    const { sendAdminNotification } = await import(
      "../helper/notifyByEmail.js"
    );
    return await sendAdminNotification(entry);
  } catch (error) {
    console.error("Failed to send admin notification:", error);
    throw error;
  }
};

const sendApprovalEmail = async (entry, loginLink) => {
  try {
    const { sendApprovalConfirmation } = await import(
      "../helper/notifyByEmail.js"
    );
    return await sendApprovalConfirmation(entry, loginLink);
  } catch (error) {
    console.error("Failed to send approval email:", error);
    throw error;
  }
};

const sendFirstLoginEmail = async (user) => {
  try {
    const { sendFirstLoginConfirmation } = await import(
      "../helper/notifyByEmail.js"
    );
    return await sendFirstLoginConfirmation(user);
  } catch (error) {
    console.error("Failed to send first login email:", error);
    throw error;
  }
};

export default {
  handleLocalLogin,
  updateProfile,
  updateSubscription,
  deleteUser,
  getAllUsers,
  searchWaitingList,
  createUser,
  sendWaitingListConfirmation,
  sendAdminNotification,
  sendApprovalEmail,
  sendFirstLoginEmail,
};
