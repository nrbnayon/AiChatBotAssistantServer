import { ApiError, catchAsync } from "../utils/errorHandler.js";
import { StatusCodes } from "http-status-codes";
import AiModel from './../models/AiModel';

const createSystemMessage = catchAsync(async (req, res, next) => {
  const { content } = req.body;
  if (!content) {
    throw new ApiError("Content is required", 400);
  }
  const newSystemMessage = new AiModel({
    type: "system_message",
    content,
  });
  await newSystemMessage.save();
  res.status(201).json({ success: true, data: newSystemMessage });
});