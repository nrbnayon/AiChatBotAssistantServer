// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";
import passport from "passport";
import fs from "fs";
import path from "path";
import connectDB from "./config/database.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import stripeRoutes from "./routes/stripeRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import aiChatRoutes from "./routes/aiChatRoutes.js";
import aiModelRoutes from "./routes/aiModelRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import { globalErrorHandler } from "./utils/errorHandler.js";
import requestLogger from "./utils/requestLogger.js";
import "./config/passport.js";
import os from "os";
import bodyParser from "body-parser";
import { handleWebhook } from "./controllers/stripeController.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;
const IP_ADDRESS = process.env.IP_ADDRESS || "127.0.0.1";

// Determine the upload directory based on the environment
const isLambda = !!process.env.LAMBDA_TASK_ROOT;
const baseUploadDir = isLambda ? "/tmp" : process.cwd();
const uploadDir = path.join(baseUploadDir, "uploads/images");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use("/uploads", express.static(path.join(baseUploadDir, "uploads")));

// Get local IP address
const getLocalIpAddress = () => {
  const networkInterfaces = os.networkInterfaces();
  for (const devName in networkInterfaces) {
    const iface = networkInterfaces[devName];
    for (const details of iface) {
      if (details.family === "IPv4" && !details.internal) {
        return details.address;
      }
    }
  }
  return "localhost";
};

const localIpAddress = getLocalIpAddress();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://email-aichatbot.netlify.app",
  process.env.FRONTEND_URL,
  process.env.FRONTEND_LIVE_URL,
  "http://192.168.10.33:3000",
  `http://192.168.10.206:3000`,
  `http://172.16.0.2:3000`,
  "https://inbox-buddy-ai-ynx6.vercel.app",
  `http://${localIpAddress}:3000`,
  `http://${IP_ADDRESS}:3000`,
].filter(Boolean);

app.use(cookieParser());
app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      httpOnly: true,
      maxAge: 15 * 24 * 60 * 60 * 1000, // 15 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`Origin ${origin} not allowed by CORS`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cache-Control"],
    exposedHeaders: ["Authorization"],
  })
);

// Webhook handler with raw body parsing
app.post(
  "/my-webhook",
  bodyParser.raw({ type: "application/json" }),
  handleWebhook
);

// Apply body parsing middleware for other routes
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(requestLogger);

// Routes
app.get("/", (req, res) => {
  res.send("Welcome to the you mail ai assistant!");
});
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/stripe", stripeRoutes);
app.use("/api/v1/ai-models", aiModelRoutes);
app.use("/api/v1/emails", emailRoutes);
app.use("/api/v1/ai-assistant", aiChatRoutes);
app.use("/api/v1/chats", chatRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found!",
    path: req.path,
  });
});

app.use(globalErrorHandler);

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION! 💥 Shutting down gracefully...");
  console.error(error.name, error.message, error.stack);
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

connectDB().then(() => {
  app.listen(PORT, IP_ADDRESS, () => {
    console.log(`
    ╔═════════════════════════════════════╗
    ║  🚀 Server launched successfully!   ║
    ║  🌐 Running on:${IP_ADDRESS}:${PORT.toString().padEnd(10, " ")} ║
    ╚═════════════════════════════════════╝
    `);
  });
});