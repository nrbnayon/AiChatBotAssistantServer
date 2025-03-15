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
  })
);
router.get(
  "/google/callback",
  authRateLimit(),
  passport.authenticate("google", {
    failureRedirect: `${userController.getFrontendUrl}/login`,
    session: true,
  }),
  userController.googleCallback
);

router.get(
  "/microsoft",
  authRateLimit(),
  passport.authenticate("microsoft", { prompt: "select_account" })
);
router.get(
  "/microsoft/callback",
  authRateLimit(),
  passport.authenticate("microsoft", {
    failureRedirect: `${userController.getFrontendUrl}/login`,
    session: true,
  }),
  userController.microsoftCallback
);

router.get("/yahoo", authRateLimit(), passport.authenticate("yahoo"));
router.get(
  "/yahoo/callback",
  authRateLimit(),
  passport.authenticate("yahoo", {
    failureRedirect: `${userController.getFrontendUrl}/login`,
    session: true,
  }),
  userController.yahooCallback
);

router.post("/login", authRateLimit(), userController.localLogin);
router.post("/register", authRateLimit(), userController.register);

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
