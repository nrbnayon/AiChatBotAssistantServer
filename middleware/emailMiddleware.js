// middleware/emailMiddleware.js
import { StatusCodes } from "http-status-codes";
import { ApiError, catchAsync } from "../utils/errorHandler.js";

const emailAuth = catchAsync(async (req, res, next) => {
  const { authProvider } = req.user;

  if (!["google", "microsoft", "yahoo"].includes(authProvider)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Unsupported auth provider for email operations"
    );
  }

  next();
});

export default emailAuth;
