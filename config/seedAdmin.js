// config/seedAdmin.js
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import dotenv from "dotenv";

dotenv.config();

const seedAdmin = async () => {
  try {
    // Check if admin already exists
    const adminExists = await User.findOne({
      email: process.env.ADMIN_EMAIL,
      role: "ADMIN",
    });

    if (adminExists) {
      console.log("Admin user already exists, skipping creation");
      return;
    }

    // Check if email exists with different role
    const emailExists = await User.findOne({
      email: process.env.ADMIN_EMAIL,
    });

    if (emailExists) {
      console.log(
        "Email already exists with different role, skipping admin creation"
      );
      return;
    }

    // Create hashed password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, salt);

    // Create admin user
    const adminUser = await User.create({
      name: process.env.ADMIN_NAME || "Admin",
      email: process.env.ADMIN_EMAIL,
      password: hashedPassword,
      role: "ADMIN",
      verified: true,
      status: "ACTIVE",
      authProvider: "email",
      subscription: {
        plan: "premium",
        status: "ACTIVE",
        dailyTokens: 10000,
        autoRenew: true,
      },
    });

    console.log("✅ Admin user created successfully");
    return adminUser;
  } catch (error) {
    console.error("Error creating admin user:", error);
    throw error;
  }
};

export default seedAdmin;
