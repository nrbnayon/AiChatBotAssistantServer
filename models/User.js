// models\User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSubscriptionSchema = new mongoose.Schema({
  plan: {
    type: String,
    enum: ["free", "basic", "premium", "enterprise"],
    default: "free",
  },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  status: {
    type: String,
    enum: ["ACTIVE", "EXPIRED", "CANCELLED"],
    default: "ACTIVE",
  },
  dailyRequests: { type: Number, default: 0 },
  dailyTokens: { type: Number, default: 0 },
  lastRequestDate: { type: Date },
  autoRenew: { type: Boolean, default: true },
});

const userSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["ADMIN", "USER"],
    default: "USER",
    required: true,
  },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  authProvider: {
    type: String,
    enum: ["google", "microsoft", "yahoo", "local"],
    required: true,
  },
  password: { type: String },
  phone: String,
  address: String,
  country: String,
  googleId: { type: String, sparse: true },
  microsoftId: { type: String, sparse: true },
  yahooId: { type: String, sparse: true },
  googleAccessToken: String,
  googleRefreshToken: String,
  microsoftAccessToken: String,
  microsoftRefreshToken: String,
  yahooAccessToken: String,
  yahooRefreshToken: String,
  refreshToken: String,
  status: {
    type: String,
    enum: ["ACTIVE", "INACTIVE", "BLOCKED"],
    default: "ACTIVE",
  },
  verified: { type: Boolean, default: false },
  gender: { type: String, enum: ["male", "female", "others"] },
  dateOfBirth: Date,
  subscription: { type: userSubscriptionSchema, default: () => ({}) },
  createdAt: { type: Date, default: Date.now },
  lastSync: { type: Date, default: Date.now },
});

userSchema.pre("save", async function (next) {
  if (this.isModified("password") && this.authProvider === "local") {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

export default mongoose.model("User", userSchema);
