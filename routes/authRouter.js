import express from "express";
import passport from "../config/passport.js";
import userController from "../controllers/authController.js";
import { authenticate, restrictTo } from "../middleware/auth.js";
import { rateLimit, authRateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

router.get(
  "/google",
  authRateLimit(),
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    state: Buffer.from(JSON.stringify({ redirect: "/" })).toString("base64"),
  })
);
router.get(
  "/google/callback",
  authRateLimit(),
  passport.authenticate("google", {
    failureRedirect: "/api/v1/auth/error",
    session: true,
  }),
  userController.googleCallback
);

router.get(
  "/microsoft",
  authRateLimit(),
  passport.authenticate("microsoft", {
    prompt: "select_account",
    state: Buffer.from(JSON.stringify({ redirect: "/" })).toString("base64"),
  })
);
router.get(
  "/microsoft/callback",
  authRateLimit(),
  passport.authenticate("microsoft", {
    failureRedirect: "/api/v1/auth/error",
    session: true,
  }),
  userController.microsoftCallback
);

router.get(
  "/yahoo",
  authRateLimit(),
  passport.authenticate("yahoo", {
    state: Buffer.from(JSON.stringify({ redirect: "/" })).toString("base64"),
  })
);
router.get(
  "/yahoo/callback",
  authRateLimit(),
  passport.authenticate("yahoo", {
    failureRedirect: "/api/v1/auth/error",
    session: true,
  }),
  userController.yahooCallback
);

router.get("/error", userController.authError);
router.post("/login", authRateLimit(), userController.localLogin);
router.post("/register", authRateLimit(), userController.register);
router.post("/refresh", authRateLimit(), userController.refresh);

router.get("/me", authenticate, rateLimit(), userController.getMe);
router.put("/profile", authenticate, rateLimit(), userController.updateProfile);
router.put(
  "/subscription",
  authenticate,
  rateLimit(),
  userController.updateSubscription
);
router.delete("/me", authenticate, rateLimit(), userController.deleteMe);
router.get("/logout", authenticate, userController.logout);

router.get(
  "/admin/users",
  authenticate,
  restrictTo("ADMIN"),
  rateLimit({ max: 1000 }),
  userController.getAllUsers
);

export default router;
