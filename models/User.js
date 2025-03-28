// models\User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

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
  plan: {
    type: String,
    enum: ["basic", "premium", "enterprise"],
    default: "basic",
  },
  status: {
    type: String,
    enum: ["active", "pending", "canceled"],
    default: "pending",
  },
  dailyQueries: { type: Number, default: 0 },
  autoRenew: { type: Boolean, default: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  stripeSubscriptionId: { type: String },
  lastRequestDate: { type: Date },
});

const userSchema = new mongoose.Schema({
  role: {
    type: String,
    default: "user",
    enum: ["super_admin", "admin", "user"],
  },
  name: { type: String },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  authProvider: { type: String, enum: ["google", "microsoft", "local"] },
  inboxList: [
    {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
    },
  ],
  googleId: { type: String },
  googleAccessToken: { type: Object },
  googleRefreshToken: { type: Object },
  googleAccessTokenExpires: { type: Number },
  microsoftId: { type: String },
  microsoftAccessToken: { type: Object },
  microsoftRefreshToken: { type: Object },
  microsoftAccessTokenExpires: { type: Number },
  profilePicture: { type: String },
  status: {
    type: String,
    default: "active",
    enum: ["active", "canceled", "pending", "block"],
  },
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
  userImportantMailKeywords: {
    type: [String],
    default: DEFAULT_IMPORTANT_KEYWORDS,
  },
});

userSchema.pre("save", async function (next) {
  if (this.email) {
    this.email = this.email.toLowerCase().trim();
  }
  if (this.isModified("password") && this.password) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.getAllImportantKeywords = function () {
  const combined = [
    ...DEFAULT_IMPORTANT_KEYWORDS,
    ...this.userImportantMailKeywords,
  ];
  return Array.from(new Set(combined.map((k) => k.toLowerCase())));
};

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
