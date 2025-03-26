import mongoose from "mongoose";

const waitingListSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  inbox: { type: String },
  description: { type: String },
  status: {
    type: String,
    enum: ["waiting", "approved", "rejected"],
    default: "waiting",
  },
  createdAt: { type: Date, default: Date.now },
});

waitingListSchema.pre("save", function (next) {
  if (this.email) {
    this.email = this.email.toLowerCase().trim();
  }
  next();
});

const WaitingList = mongoose.model("WaitingList", waitingListSchema);
export default WaitingList;
