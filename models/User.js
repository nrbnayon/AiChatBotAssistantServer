// models/User.js (updated)
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
  "schedule",
  "reminder",
  "task",
];

const subscriptionSchema = new mongoose.Schema({
  plan: {
    type: String,
    enum: ["free", "basic", "premium", "enterprise"],
    default: "free",
  },
  status: {
    type: String,
    enum: ["active", "pending", "cancelled", "expired"],
    default: "active",
  },
  remainingQueries: {
    type: Number,
    default: 5,
  },
  dailyQueries: { type: Number, default: 5 },
  dailyTokens: { type: Number, default: 0 },
  autoRenew: { type: Boolean, default: false },
  startDate: { type: Date },
  endDate: { type: Date },
  stripeSubscriptionId: { type: String },
  lastRequestDate: { type: Date },
});

const userSchema = new mongoose.Schema(
  {
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
    thirdTPartyIntegration: {
      type: String,
      status: {
        type: String,
        enum: ["active", "inactive", "pending"],
        default: "pending",
      },
    },
    googleId: { type: String },
    // googleAccessToken: { type: Object },
    // googleRefreshToken: { type: Object },
    googleAccessToken: { type: String },
    googleRefreshToken: { type: String },
    googleAccessTokenExpires: { type: Number },
    microsoftId: { type: String },
    // microsoftAccessToken: { type: Object },
    // microsoftRefreshToken: { type: Object },
    microsoftAccessToken: { type: String },
    microsoftRefreshToken: { type: String },
    microsoftAccessTokenExpires: { type: Number },
    profilePicture: { type: String },
    status: {
      type: String,
      default: "active",
      enum: ["active", "cancelled", "pending", "blocked"],
    },
    verified: { type: Boolean, default: false },
    subscription: { type: subscriptionSchema, default: () => ({}) },
    refreshToken: { type: String },
    phone: { type: String },
    image: { type: String },
    address: { type: String },
    country: { type: String },
    gender: { type: String },
    dateOfBirth: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastSync: { type: Date, default: Date.now },
    userImportantMailKeywords: {
      type: [String],
      default: DEFAULT_IMPORTANT_KEYWORDS,
    },
    firstLogin: { type: Boolean, default: true },
  },
  { timestamps: true }
);

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