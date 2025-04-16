// services\userService.js
import User from "../models/User.js";
import WaitingList from "../models/WaitingList.js";
import { ApiError } from "../utils/errorHandler.js";
import path from "path";

const handleLocalLogin = async (email, password) => {
  try {
    // Convert email to lowercase to ensure consistent matching
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    // Detailed logging for debugging
    console.log("Login Attempt:", {
      email: normalizedEmail,
      userFound: !!user,
      authProvider: user?.authProvider,
      passwordSet: !!user?.password,
    });

    if (!user) {
      throw new ApiError(401, "User not found");
    }

    if (user.authProvider !== "local") {
      throw new ApiError(401, "Invalid authentication method");
    }

    if (!user.password) {
      throw new ApiError(401, "Password not set for this account");
    }

    const isMatch = await user.comparePassword(password);

    console.log("Password Match Result:", {
      isMatch,
      providedPassword: password,
      storedPasswordHash: user.password,
    });

    if (!isMatch) {
      throw new ApiError(401, "Invalid credentials");
    }

    return user;
  } catch (error) {
    console.error("Login Error:", error);
    throw error;
  }
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

  // Handle profile picture file if provided
  if (file) {
    const fileExt = path.extname(file.originalname).toLowerCase();
    updates.profilePicture = `http://${process.env.IP_ADDRESS}:${process.env.PORT}/uploads/images/${userId}${fileExt}`;
  }

  if (Object.keys(updates).length === 0)
    throw new ApiError("No valid fields to update", 400);

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { ...updates, lastSync: new Date() },
    { new: true }
  );

  if (!updatedUser) throw new ApiError("User not found or update failed", 404);
  return updatedUser;
};

const updateSubscription = async (userId, { plan, autoRenew }) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError("User not found", 404);
  const subscriptionPlans = {
    basic: { dailyQueries: 15, maxInboxes: 1 },
    premium: { dailyQueries: 100, maxInboxes: 3 },
    enterprise: { dailyQueries: Infinity, maxInboxes: 10 },
  };
  if (plan && subscriptionPlans[plan]) {
    user.subscription.plan = plan;
    user.subscription.startDate = new Date();
    user.subscription.dailyQueries = 0;
    user.subscription.dailyTokens = 0;
    user.subscription.status = "active";
    if (user.inboxList.length > subscriptionPlans[plan].maxInboxes) {
      user.inboxList = user.inboxList.slice(
        0,
        subscriptionPlans[plan].maxInboxes
      );
    }
  }
  if (typeof autoRenew === "boolean") user.subscription.autoRenew = autoRenew;
  await user.save();
  return user;
};

const deleteUser = async (userId) => {
  const user = await User.findByIdAndDelete(userId);
  if (!user) throw new ApiError("User not found", 404);
};

const getAllUsers = async (
  page = 1,
  limit = 10,
  searchQuery = "",
  status = null
) => {
  const skip = (page - 1) * limit;

  // Create search query
  let query = {};

  // Add status filter only if provided
  if (status) {
    query.status = status;
  }

  // Add search query if provided
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
  const totalPages = Math.ceil(totalUsers / limit);

  return {
    users,
    totalCount: totalUsers,
    totalPages,
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

  // Create search query
  let query = {};

  // Add status filter only if provided
  if (status) {
    query.status = status;
  }

  if (searchQuery) {
    query = {
      ...query,
      $or: [
        { name: { $regex: searchQuery, $options: "i" } },
        { email: { $regex: searchQuery, $options: "i" } },
      ],
    };
  }

  // Using aggregation to sort "waiting" status to the top
  const waitingList = await WaitingList.aggregate([
    { $match: query },
    {
      $addFields: {
        sortOrder: {
          $cond: {
            if: { $eq: ["$status", "waiting"] },
            then: 0,
            else: 1,
          },
        },
      },
    },
    { $sort: { sortOrder: 1, createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);

  const totalWaiting = await WaitingList.countDocuments(query);
  const totalPages = Math.ceil(totalWaiting / limit);

  return {
    data: waitingList,
    total: totalWaiting,
    totalPages,
    currentPage: page,
  };
};

const createUser = async ({ name, email, password, role }) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) throw new ApiError("User already exists", 400);
  const newUser = new User({
    name,
    email,
    password,
    role: role || "user",
    authProvider: "local",
    subscription: {
      plan: "basic",
      dailyQueries: 15,
      autoRenew: true,
      status: "active",
    },
  });
  await newUser.save();
  const { password: _, ...userWithoutPassword } = newUser.toObject();
  return userWithoutPassword;
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
