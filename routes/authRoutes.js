// routes/authRoutes.js
import express from "express";
import passport from "../config/passport.js";
import {
  authError,
  oauthCallback,
  localLogin,
  register,
  refresh,
  logout,
} from "../controllers/authController.js";
import { authRateLimit } from "../middleware/rateLimit.js";
import auth from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/oauth/:provider", authRateLimit(), (req, res, next) => {
  const { provider } = req.params;
  const providers = {
    google: {
      strategy: "google",
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.compose",
      ],
    },
    microsoft: {
      strategy: "microsoft",
      scope: ["user.read", "mail.read", "Mail.Read", "Mail.Send"],
      options: { prompt: "select_account" },
    },
    yahoo: {
      strategy: "yahoo",
      scope: ["profile", "email", "mail-r"],
    },
  };

  if (!providers[provider]) {
    return res.status(400).json({ message: "Invalid provider" });
  }

  const { strategy, scope, options = {} } = providers[provider];
  const state = Buffer.from(
    JSON.stringify({ redirect: req.query.redirect || "/" })
  ).toString("base64");

  passport.authenticate(strategy, { scope, state, ...options })(req, res, next);
});

router.get(
  // "/oauth/callback/:provider",
  "/:provider/callback",
  authRateLimit(),
  (req, res, next) => {
    console.log("Callback hit for provider:", req.params.provider);
    const { provider } = req.params;
    passport.authenticate(provider, {
      failureRedirect: "/api/v1/auth/error",
      session: true,
    })(req, res, next);
  },
  oauthCallback
);

router.get("/error", authError);
router.post("/login", authRateLimit(), localLogin);
router.post("/register", authRateLimit(), register);
router.post("/refresh", authRateLimit(), refresh);
router.get("/logout", auth(), logout);

export default router;
