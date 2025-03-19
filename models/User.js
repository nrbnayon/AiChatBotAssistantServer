import mongoose from "mongoose";

// Define default important keywords
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

// Subscription schema
const subscriptionSchema = new mongoose.Schema({
  plan: { type: String, default: "free" },
  status: { type: String, default: "ACTIVE" },
  dailyTokens: { type: Number, default: 100 },
  autoRenew: { type: Boolean, default: true },
  startDate: { type: Date, default: Date.now },
  lastRequestDate: { type: Date },
});

// User schema
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
  userImportantMailKeywords: { type: [String], default: [] }, // Custom user keywords
});

// Method to get all keywords: default + user-defined
userSchema.methods.getAllImportantKeywords = function () {
  const combined = [
    ...DEFAULT_IMPORTANT_KEYWORDS,
    ...this.userImportantMailKeywords,
  ];
  const uniqueCombined = Array.from(
    new Set(combined.map((k) => k.toLowerCase()))
  );
  return uniqueCombined;
};

// Optional method: Add a new user keyword (avoids duplicates)
userSchema.methods.addImportantKeyword = async function (keyword) {
  const lowerKeyword = keyword.toLowerCase();
  if (
    !this.userImportantMailKeywords
      .map((k) => k.toLowerCase())
      .includes(lowerKeyword) &&
    !DEFAULT_IMPORTANT_KEYWORDS.map((k) => k.toLowerCase()).includes(
      lowerKeyword
    )
  ) {
    this.userImportantMailKeywords.push(keyword);
    await this.save();
  }
};

const User = mongoose.model("User", userSchema);

export default User;
export { DEFAULT_IMPORTANT_KEYWORDS };
