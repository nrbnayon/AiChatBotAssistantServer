// config/database.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import seedAdmin from "./seedAdmin.js";

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await seedAdmin();

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

export default connectDB;
