// middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user || user.status !== "ACTIVE") {
        throw new Error("Invalid or inactive user");
      }
      req.user = user; // Use full user object instead of just decoded payload
      return next();
    }

    if (req.isAuthenticated()) {
      req.user = await User.findById(req.user.id);
      return next();
    }

    throw new Error("No token provided");
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Authentication failed: " + error.message,
    });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to perform this action",
      });
    }
    next();
  };
};

export { authenticate, restrictTo };
