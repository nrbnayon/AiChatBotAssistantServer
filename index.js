// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";
import passport from "passport";
import fs from "fs";
import path from "path";
import os from "os";
import bodyParser from "body-parser";

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
import serverMonitor from "./utils/serverMonitor.js"; // Import our server monitor
import { handleWebhook } from "./controllers/stripeController.js";
import "./config/passport.js";
import { homePageHTML } from "./home.js";

// Create the logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize dotenv
dotenv.config();

// Create Express app
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
  "http://localhost:4000",
  "https://inbox-buddy-ai-ynx6.vercel.app",
  "http://46.202.159.90:3000",
  "http://46.202.159.90:4000",
  "http://115.127.156.9:3000",
  "https://server.inbox-buddy.ai",
  "https://inbox-buddy.ai",
  "https://www.inbox-buddy.ai",
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

app.use((req, res, next) => {
  res.setTimeout(100000, () => {
    console.log("Request has timed out.");
    res.status(408).send("Request timed out");
  });
  next();
});

// Routes
app.get("/", (req, res) => {
  res.send(homePageHTML);
});
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/stripe", stripeRoutes);
app.use("/api/v1/ai-models", aiModelRoutes);
app.use("/api/v1/emails", emailRoutes);
app.use("/api/v1/ai-assistant", aiChatRoutes);
app.use("/api/v1/chats", chatRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found!",
    path: req.path,
  });
});

app.use(globalErrorHandler);

// Enhanced global error handling
process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION! 💥");
  console.error(error.name, error.message, error.stack);
  // Don't exit - let the server monitor handle it
  // Log to file
  fs.appendFileSync(
    path.join(logsDir, "uncaught-exceptions.log"),
    `[${new Date().toISOString()}] ${error.stack}\n`
  );
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION! 💥");
  console.error("Promise:", promise, "Reason:", reason);
  // Don't exit - let the server monitor handle it
  // Log to file
  fs.appendFileSync(
    path.join(logsDir, "unhandled-rejections.log"),
    `[${new Date().toISOString()}] ${reason}\n`
  );
});

// Create server monitor with our app
const monitor = serverMonitor(app, PORT, IP_ADDRESS, 2000);

// Connect to database and start server
(async () => {
  try {
    // Connect to database
    await connectDB();
    console.log("📊 Database connected successfully!");

    // Start server
    await monitor.start();

    // // Set up memory usage monitoring
    // const memoryMonitorInterval = setInterval(() => {
    //   const memoryUsage = process.memoryUsage();
    //   const heapUsed = Math.round(memoryUsage.heapUsed / 2048 / 2048);
    //   const heapTotal = Math.round(memoryUsage.heapTotal / 2048 / 2048);

    //   // Log memory usage if it's getting high (over 80% of total)
    //   if (heapUsed > heapTotal * 0.8) {
    //     console.warn(`⚠️ High memory usage: ${heapUsed}MB / ${heapTotal}MB`);
    //   }
    // }, 60000); // Check every minute

    // Handle process termination
    const handleTermination = async (signal) => {
      console.log(
        `\n🛑 Received ${signal} signal. Shutting down gracefully...`
      );
      clearInterval(memoryMonitorInterval);
      await monitor.stop();
      process.exit(0);
    };

    // Listen for termination signals
    process.on("SIGTERM", () => handleTermination("SIGTERM"));
    process.on("SIGINT", () => handleTermination("SIGINT"));
  } catch (error) {
    console.error("STARTUP ERROR! 💥");
    console.error(error);

    // Wait a bit then restart
    setTimeout(() => {
      console.log("🔄 Attempting to restart after startup error...");
      process.exit(1); // Exit with error code - PM2 will restart
    }, 5000);
  }
})();
