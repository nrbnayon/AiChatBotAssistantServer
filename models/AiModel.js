// models/AiModel.js
import mongoose from "mongoose";

const aiModelSchema = new mongoose.Schema({
  modelId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  developer: { type: String, required: true },
  contextWindow: { type: Number, required: true },
  description: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const AiModel = mongoose.model("AiModel", aiModelSchema);
export default AiModel;
