import bcrypt from "bcryptjs";
import User from "../models/User.js";
import AiModel from "../models/AiModel.js";
import SystemMessage from "../models/SystemMessage.js";
import dotenv from "dotenv";
import { SYSTEM_PROMPT } from "../helper/aiTraining.js";

dotenv.config();

const seedAdmin = async () => {
  try {
    // Seed SystemMessage
    const systemMessageCount = await SystemMessage.countDocuments();
    if (systemMessageCount === 0) {
      await SystemMessage.create({
        content: SYSTEM_PROMPT.trim(),
        isDefault: true,
      });
      // console.log("Default system message added.");
    }

    // Seed AiModel
    const aiModelCount = await AiModel.countDocuments();
    if (aiModelCount === 0) {
      await AiModel.create([
        {
          id: "gpt-4o",
          name: "GPT-4.o",
          developer: "OpenAI",
          provider: "openai",
          contextWindow: 100000000000,
          maxCompletionTokens: 1000000000000,
          description: "OpenAI's efficient and versatile chat model",
          isDefault: false,
        },
        {
          id: "llama-3.3-70b-versatile",
          name: "Llama 3.3 70B Versatile",
          developer: "Meta",
          provider: "groq",
          contextWindow: 128000,
          maxCompletionTokens: 32768,
          description:
            "Meta's advanced 70B parameter model with versatile capabilities",
        },
        {
          id: "llama-3.1-8b-instant",
          name: "Llama 3.1 8B Instant",
          developer: "Meta",
          provider: "groq",
          contextWindow: 128000,
          maxCompletionTokens: 8192,
          description: "Efficient and responsive model for quick interactions",
        },

        {
          id: "gpt-4o-mini",
          name: "GPT-4.o Mini",
          developer: "OpenAI",
          provider: "openai",
          contextWindow: 100000000000,
          maxCompletionTokens: 1000000000000,
          description: "OpenAI's efficient and versatile chat model",
          isDefault: true,
        },
        {
          id: "gemma2-9b-it",
          name: "Gemma 2 9B IT",
          developer: "Google",
          provider: "groq",
          contextWindow: 8192,
          description: "Instruction-tuned version of Google's Gemma 2 9B model",
        },

        {
          id: "llama3-70b-8192",
          name: "Llama 3 70B (8K)",
          developer: "Meta",
          provider: "groq",
          contextWindow: 8192,
          description: "Meta's 70B parameter model with 8K context window",
        },
        {
          id: "llama3-8b-8192",
          name: "Llama 3 8B (8K)",
          developer: "Meta",
          provider: "groq",
          contextWindow: 8192,
          description:
            "Meta's efficient 8B parameter model with 8K context window",
        },
        // {
        //   modelId: "mixtral-8x7b-32768",
        //   name: "Mixtral-8x7b-32768",
        //   developer: "Mistral",
        //   contextWindow: 32768,
        //   description:
        //     "Powerful open-source mixture-of-experts model with exceptional reasoning capabilities",
        // },
        // {
        //   modelId: "llama-3-70b",
        //   name: "Llama 3 70B",
        //   developer: "Meta",
        //   contextWindow: 128000,
        //   maxCompletionTokens: 32768,
        //   description:
        //     "Meta's largest open LLM offering best-in-class performance and reasoning",
        // },
        // {
        //   modelId: "llama-3.1-8b-instant",
        //   name: "Llama 3.1 8B Instant",
        //   developer: "Meta",
        //   contextWindow: 128000,
        //   maxCompletionTokens: 8192,
        //   description: "Efficient and responsive model for quick interactions",
        // },
        // {
        //   modelId: "gemma-7b",
        //   name: "Gemma 7B",
        //   developer: "Google",
        //   contextWindow: 8192,
        //   description: "Google's lightweight yet powerful open model",
        // },
        // {
        //   modelId: "gemma2-9b-it",
        //   name: "Gemma 2 9B IT",
        //   developer: "Google",
        //   contextWindow: 8192,
        //   description: "Instruction-tuned version of Google's Gemma 2 9B model",
        // },
        // {
        //   modelId: "llama-3.3-70b-versatile",
        //   name: "Llama 3.3 70B Versatile",
        //   developer: "Meta",
        //   contextWindow: 128000,
        //   maxCompletionTokens: 32768,
        //   description:
        //     "Meta's advanced 70B parameter model with versatile capabilities",
        //   isDefault: true,
        // },
        // {
        //   modelId: "llama-guard-3-8b",
        //   name: "Llama Guard 3 8B",
        //   developer: "Meta",
        //   contextWindow: 8192,
        //   description: "Specialized safety model from Meta's Llama 3 family",
        // },
        // {
        //   modelId: "llama3-70b-8192",
        //   name: "Llama 3 70B (8K)",
        //   developer: "Meta",
        //   contextWindow: 8192,
        //   description: "Meta's 70B parameter model with 8K context window",
        // },
        // {
        //   modelId: "llama3-8b-8192",
        //   name: "Llama 3 8B (8K)",
        //   developer: "Meta",
        //   contextWindow: 8192,
        //   description:
        //     "Meta's efficient 8B parameter model with 8K context window",
        // },
      ]);
      // console.log("Initial AI models added.");
    }

    // Check if admin already exists
    const adminExists = await User.findOne({
      email: process.env.ADMIN_EMAIL,
      role: "admin",
    });

    if (adminExists) {
      // console.log("Admin user already exists, skipping creation");
      return adminExists;
    }

    // Check if email exists with different role
    const emailExists = await User.findOne({
      email: process.env.ADMIN_EMAIL,
    });

    if (emailExists) {
      // console.log(
      //   "Email already exists with different role, skipping admin creation"
      // );
      return null;
    }

    // Create hashed password
    const hashedPassword = process.env.ADMIN_PASSWORD || "admin@1234";

    // Create admin user
    const superAdminUser = await User.create({
      name: process.env.ADMIN_NAME || "Admin",
      email: process.env.ADMIN_EMAIL || "admin@example.com",
      password: hashedPassword,
      role: "super_admin",
      verified: true,
      status: "active",
      authProvider: "local",
      subscription: {
        plan: "premium",
        status: "active",
        dailyQueries: 100000000000,
        startDate: new Date(),
        endDate: new Date().setFullYear(new Date().getFullYear() + 10),
        dailyTokens: 0,
        autoRenew: true,
      },
    });

    // console.log("✅ Admin user created successfully");
    return superAdminUser;
  } catch (error) {
    console.error("Error creating admin user:", error);
    throw error;
  }
};

export default seedAdmin;
