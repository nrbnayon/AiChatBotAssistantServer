// models/SystemMessage.js
import mongoose from "mongoose";

const systemMessageSchema = new mongoose.Schema({
  content: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

systemMessageSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const SystemMessage = mongoose.model("SystemMessage", systemMessageSchema);
export default SystemMessage;
