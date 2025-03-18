import User from "../models/User.js";
import bcrypt from "bcryptjs";

const handleLocalLogin = async (email, password) => {
  const user = await User.findOne({ email });
  if (!user || user.authProvider !== "email" || !user.password) {
    throw new Error("Invalid credentials or wrong auth method");
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new Error("Invalid credentials");
  return user;
};

const updateProfile = async (userId, profileData) => {
  const allowedFields = [
    "name",
    "phone",
    "address",
    "country",
    "gender",
    "dateOfBirth",
  ];
  const updates = Object.keys(profileData)
    .filter((key) => allowedFields.includes(key))
    .reduce((obj, key) => ({ ...obj, [key]: profileData[key] }), {});

  if (Object.keys(updates).length === 0) {
    throw new Error("No valid fields to update");
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { ...updates, lastSync: new Date() },
    { new: true }
  );

  if (!updatedUser) {
    throw new Error("User not found or update failed");
  }

  return updatedUser;
};

const updateSubscription = async (userId, { plan, autoRenew }) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const subscriptionPlans = {
    free: { dailyTokens: 100, duration: 30 * 24 * 60 * 60 * 1000 },
    basic: { dailyTokens: 1000000, duration: 90 * 24 * 60 * 60 * 1000 },
    premium: { dailyTokens: Infinity, duration: 30 * 24 * 60 * 60 * 1000 },
    enterprise: {
      dailyTokens: Infinity,
      duration: 2 * 365 * 24 * 60 * 60 * 1000,
    },
  };

  if (plan && subscriptionPlans[plan]) {
    user.subscription.plan = plan;
    user.subscription.startDate = new Date();
    user.subscription.endDate = new Date(
      Date.now() + subscriptionPlans[plan].duration
    );
    user.subscription.dailyTokens = subscriptionPlans[plan].dailyTokens;
    user.subscription.status = "ACTIVE";
  }
  if (typeof autoRenew === "boolean") {
    user.subscription.autoRenew = autoRenew;
  }

  await user.save();
  return user;
};

const deleteUser = async (userId) => {
  const user = await User.findByIdAndDelete(userId);
  if (!user) throw new Error("User not found");
};

const getAllUsers = async () => {
  return await User.find().select(
    "-password -refreshToken -googleAccessToken -microsoftAccessToken -yahooAccessToken"
  );
};

const createUser = async ({ name, email, password, role }) => {
  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error("User already exists");
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create new user
  const newUser = new User({
    name,
    email,
    password: hashedPassword,
    role: role || "USER", // Default to USER if no role provided
    authProvider: "email",
  });

  await newUser.save();

  // Exclude sensitive fields from response
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
