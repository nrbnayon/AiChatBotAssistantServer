// controllers/chatController.js
import Chat from "../models/Chat.js";
import { catchAsync } from "../utils/errorHandler.js";

export const createChat = async (req, res) => {
  const userId = req.user.id;
  const { name } = req.body; 
  const defaultName = `untitled - ${
    new Date().toISOString().split("T")[0]
  }`;
  const chatName = name || defaultName; 
  const newChat = new Chat({ userId, name: chatName });
  await newChat.save();
  res.status(201).json({ success: true, data: newChat });
};

export const getChats = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const chats = await Chat.find({ userId }).sort({ updatedAt: -1 });
  res.json({ success: true, data: chats });
});

export const getChatById = catchAsync(async (req, res) => {
  const chatId = req.params.id;
  const userId = req.user.id;
  const chat = await Chat.findOne({ _id: chatId, userId });
  if (!chat) {
    return res.status(404).json({ success: false, message: "Chat not found" });
  }
  res.json({ success: true, data: chat });
});

export const updateChat = catchAsync(async (req, res) => {
  const chatId = req.params.id;
  const userId = req.user.id;
  const { name } = req.body;
  const chat = await Chat.findOneAndUpdate(
    { _id: chatId, userId },
    { name },
    { new: true }
  );
  if (!chat) {
    return res.status(404).json({ success: false, message: "Chat not found" });
  }
  res.json({ success: true, data: chat });
});

export const deleteChat = catchAsync(async (req, res) => {
  const chatId = req.params.id;
  const userId = req.user.id;
  const chat = await Chat.findOneAndDelete({ _id: chatId, userId });
  if (!chat) {
    return res.status(404).json({ success: false, message: "Chat not found" });
  }
  res.json({ success: true, message: "Chat deleted successfully" });
});
