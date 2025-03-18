import mongoose from "mongoose";

// Define default important keywords as a constant
const DEFAULT_IMPORTANT_KEYWORDS = [
  "urgent",
  "important",
  "priority",
  "action required",
  "meeting",
  "deadline",
  "due date",
  "due",
  "schedule",
  "reminder",
  "task",
];

const subscriptionSchema = new mongoose.Schema({
  plan: { type: String, default: "free" },
  status: { type: String, default: "ACTIVE" },
  dailyTokens: { type: Number, default: 100 },
  autoRenew: { type: Boolean, default: true },
  startDate: { type: Date, default: Date.now },
  lastRequestDate: { type: Date },
});

const userSchema = new mongoose.Schema({
  role: { type: String, default: "USER" },
  name: { type: String },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  authProvider: {
    type: String,
    enum: ["google", "microsoft", "yahoo", "email"],
  },
  googleId: { type: String },
  googleAccessToken: { type: String },
  googleRefreshToken: { type: String },
  googleAccessTokenExpires: { type: Number },
  microsoftId: { type: String },
  microsoftAccessToken: { type: String },
  microsoftRefreshToken: { type: String },
  microsoftAccessTokenExpires: { type: Number },
  yahooId: { type: String },
  yahooAccessToken: { type: String },
  yahooRefreshToken: { type: String },
  yahooAccessTokenExpires: { type: Number },
  profilePicture: { type: String },
  status: { type: String, default: "ACTIVE" },
  verified: { type: Boolean, default: false },
  subscription: { type: subscriptionSchema, default: () => ({}) },
  refreshToken: { type: String },
  phone: { type: String },
  address: { type: String },
  country: { type: String },
  gender: { type: String },
  dateOfBirth: { type: Date },
  createdAt: { type: Date, default: Date.now },
  lastSync: { type: Date, default: Date.now },
  userImportantMailKeywords: { type: [String], default: [] }, 
});

// Method to get all important keywords (default + user-specific)
userSchema.methods.getAllImportantKeywords = function () {
  return [...DEFAULT_IMPORTANT_KEYWORDS, ...this.userImportantMailKeywords];
};

const User = mongoose.model("User", userSchema);
export default User;
export { DEFAULT_IMPORTANT_KEYWORDS }; // Export for use elsewhere
