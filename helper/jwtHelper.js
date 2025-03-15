// helpers/jwtHelper.js
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

const createToken = (payload, secret, expireTime) => {
  const options = { expiresIn: expireTime };
  return jwt.sign(payload, secret, options);
};

const verifyToken = (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid token");
  }
};

const createAccessToken = (payload) => {
  if (!process.env.JWT_SECRET) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "JWT secret is not defined"
    );
  }
  return createToken(payload, process.env.JWT_SECRET, "1d");
};

const createRefreshToken = (payload) => {
  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "JWT refresh secret is not defined"
    );
  }
  return createToken(payload, process.env.REFRESH_TOKEN_SECRET, "30d");
};

export const jwtHelper = {
  createToken,
  verifyToken,
  createAccessToken,
  createRefreshToken,
};
