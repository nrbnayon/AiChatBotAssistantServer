// models/EmailDraft.js
import mongoose from "mongoose";

const emailDraftSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recipientId: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const EmailDraft = mongoose.model("EmailDraft", emailDraftSchema);
export default EmailDraft;
