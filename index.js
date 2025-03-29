// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";
import passport from "passport";
import connectDB from "./config/database.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import stripeRoutes from "./routes/stripeRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import aiChatRoutes from "./routes/aiChatRoutes.js";
import { globalErrorHandler } from "./utils/errorHandler.js";
import requestLogger from "./utils/requestLogger.js";
import "./config/passport.js";
import os from "os";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

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
  `http://192.168.10.206:3000`,
  `http://172.16.0.2:3000`,
  `http://${localIpAddress}:3000`,
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
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin or from allowed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Authorization"],
  })
);

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(requestLogger);

app.get("/", (req, res) => {
  res.send("Welcome to the you mail ai assistant!");
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/stripe", stripeRoutes);
app.use("/api/v1/emails", emailRoutes);
app.use("/api/v1/ai-assistant", aiChatRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.path,
  });
});

app.use(globalErrorHandler);

connectDB().then(() => {
  app.listen(PORT, localIpAddress, () => {
    console.log(`
    ╔═════════════════════════════════════╗
    ║  🚀 Server launched successfully!   ║
    ║  🌐 Running on IP: ${localIpAddress}:${PORT.toString().padEnd(10, " ")} ║
    ╚═════════════════════════════════════╝
    `);
  });
});
