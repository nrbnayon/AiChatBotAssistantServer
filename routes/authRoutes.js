// routes\authRoutes.js
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

/**
 * ╔═══════════════════════════════════════╗
 * ║    OAuth Authentication Providers     ║
 * ╚═══════════════════════════════════════╝
 * @description Manages OAuth authentication for multiple providers
 * @route GET /oauth/:provider
 * @access Public
 * @param {string} provider - Authentication provider (google, microsoft)
 */
router.get(
  "/oauth/:provider",
  // authRateLimit(), // Uncomment if rate limiting is desired
  (req, res, next) => {
    const { provider } = req.params;
    const redirectUrl = req.query.redirect || "/dashboard";
    req.session.redirectUrl = redirectUrl; // Store redirect URL in session

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
        options: { accessType: "offline", prompt: "consent" },
      },
      microsoft: {
        strategy: "microsoft",
        scope: [
          "offline_access",
          "User.Read",
          "Mail.Read",
          "Mail.ReadWrite",
          "Mail.Send",
        ],
        options: { prompt: "select_account" },
      },
    };

    if (!providers[provider]) {
      return res.status(400).json({ message: "Invalid provider" });
    }
    const { strategy, scope, options = {} } = providers[provider];

    passport.authenticate(strategy, { scope, ...options })(req, res, next);
  }
);

/**
 * ╔═══════════════════════════════════════╗
 * ║    OAuth Callback Handling            ║
 * ╚═══════════════════════════════════════╝
 * @description Handles OAuth provider callback
 * @route GET /:provider/callback
 * @access Public
 * @param {string} provider - Authentication provider
 */
router.get(
  "/:provider/callback",
  (req, res, next) => {
    console.log("Session ID:", req.sessionID);
    console.log("Full Session Data:", JSON.stringify(req.session, null, 2)); 
    const { provider } = req.params;
    const state = req.query.state;
    console.log("Get state", state);
    passport.authenticate(provider, { session: true }, (err, user, info) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        const errorMessage =
          info && info.message ? info.message : "Authentication failed";
        return res.redirect(
          `/api/v1/auth/error?message=${encodeURIComponent(errorMessage)}`
        );
      }
      req.authInfo = info;
      next();
    })(req, res, next);
  },
  oauthCallback
);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Authentication Error Handling      ║
 * ╚═══════════════════════════════════════╝
 * @description Provides error information for authentication failures
 * @route GET /error
 * @access Public
 */
router.get("/error", authError);

/**
 * ╔═══════════════════════════════════════╗
 * ║    Authentication Management Routes   ║
 * ╚═══════════════════════════════════════╝
 * @description Routes for local authentication and account management
 * @access Public/Authenticated
 */
// Local user login
router.post("/login", authRateLimit(), localLogin);

// User registration
router.post("/register", authRateLimit(), register);

// Token refresh
router.post("/refresh", refresh);

// User logout (requires authentication)
router.get("/logout", auth(), logout);

export default router;
