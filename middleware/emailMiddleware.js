// middleware/emailMiddleware.js
import { StatusCodes } from "http-status-codes";

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

const emailAuth = async (req, res, next) => {
  try {
    const { authProvider } = req.user;
    if (!["google", "microsoft", "yahoo"].includes(authProvider)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Unsupported auth provider for email operations"
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

export default emailAuth;
