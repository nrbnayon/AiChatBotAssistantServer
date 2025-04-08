// services\userService.js
import User from "../models/User.js";
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

const getAllUsers = async () => {
  return await User.find().select(
    "-password -refreshToken -googleAccessToken -microsoftAccessToken"
  );
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

export default {
  handleLocalLogin,
  updateProfile,
  updateSubscription,
  deleteUser,
  getAllUsers,
  createUser,
};
