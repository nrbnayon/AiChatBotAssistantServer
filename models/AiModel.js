// models/Ai.js
import mongoose from "mongoose";

const aiModelSchema = new mongoose.Schema({
  modelId: {
    type: String,
    required: function () {
      return this.type === "model";
    },
    unique: true,
  },
  type: {
    type: String,
    required: true,
    enum: ["system_message", "model"],
  },
  content: {
    type: String,
    required: function () {
      return this.type === "system_message";
    },
  },

  developer: { type: String },
  contextWindow: { type: Number },
  name: {
    type: String,
    required: function () {
      return this.type === "model";
    },
  },
  description: {
    type: String,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const AiModel = mongoose.model("AiModel", aiModelSchema);
export default AiModel;
