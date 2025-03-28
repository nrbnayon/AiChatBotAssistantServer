// models/AiModel.js
import mongoose from "mongoose";

const aiModelSchema = new mongoose.Schema({
  modelId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  developer: { type: String, required: true },
  contextWindow: { type: Number, required: true },
  maxCompletionTokens: { type: Number },
  description: { type: String },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

aiModelSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const AiModel = mongoose.model("AiModel", aiModelSchema);
export default AiModel;
