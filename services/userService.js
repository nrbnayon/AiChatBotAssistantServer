import User from "../models/User.js";
import bcrypt from "bcryptjs";

const handleLocalLogin = async (email, password) => {
  const user = await User.findOne({ email });
  if (!user || user.authProvider !== "local" || !user.password) {
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
  return await User.findByIdAndUpdate(
    userId,
    { ...updates, lastSync: new Date() },
    { new: true }
  );
};

const updateSubscription = async (userId, { plan, autoRenew }) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const endDateMap = {
    free: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    basic: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    premium: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    enterprise: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
  };

  if (plan) {
    user.subscription.plan = plan;
    user.subscription.startDate = new Date();
    user.subscription.endDate = endDateMap[plan];
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
  return user;
};

const getAllUsers = async () => {
  return await User.find().select("-password");
};

export default {
  handleLocalLogin,
  updateProfile,
  updateSubscription,
  deleteUser,
  getAllUsers,
};
