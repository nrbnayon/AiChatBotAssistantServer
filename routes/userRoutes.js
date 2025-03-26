import express from "express";
import {
  getMe,
  updateProfile,
  updateSubscription,
  deleteMe,
  getAllUsers,
  updateKeywords,
  createUser,
  deleteUser,
  addInbox,
  getIncome,
  getUserStats,
  approveWaitingList,
  rejectWaitingList,
} from "../controllers/userController.js";
import auth, { setRefreshedTokenCookie } from "../middleware/authMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import WaitingList from "../models/WaitingList.js";

const router = express.Router();

router.post("/add-to-waiting-list", async (req, res) => {
  const { email, name, inbox, description } = req.body;
  try {
    const entry = new WaitingList({ email, name, inbox, description });
    await entry.save();
    res.status(201).json({ message: "Added to waiting list" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get(
  "/me",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  getMe
);
router.put(
  "/profile",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateProfile
);
router.put(
  "/subscription",
  auth("user"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateSubscription
);
router.delete(
  "/me",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  deleteMe
);
router.get(
  "/admin/users",
  auth("admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware({ max: 1000 }),
  getAllUsers
);
router.put(
  "/keywords",
  auth("user"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  updateKeywords
);
router.post(
  "/admin/users",
  auth("admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  createUser
);
router.delete(
  "/admin/users/:id",
  auth("admin"),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  deleteUser
);
router.post(
  "/add-inbox",
  auth(),
  setRefreshedTokenCookie,
  rateLimitMiddleware(),
  addInbox
);
router.get("/income", auth("admin"), getIncome);
router.get("/stats", auth("admin"), getUserStats);
router.post("/waiting-list/approve", auth("admin"), approveWaitingList);
router.post("/waiting-list/reject", auth("admin"), rejectWaitingList);

export default router;
