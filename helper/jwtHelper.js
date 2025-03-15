//helper\jwtHelper.js
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";

const defaultConfig = {
  jwt: {
    secret: process.env.JWT_SECRET || "your-secret-key",
    refresh_secret:
      process.env.REFRESH_TOKEN_SECRET || "your-refresh-secret-key",
    expire_in: process.env.JWT_EXPIRE_IN || "24h",
    refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
};

// Custom API Error class
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
  if (!defaultConfig.jwt.secret) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "JWT secret is not defined"
    );
  }
  return createToken(
    payload,
    defaultConfig.jwt.secret,
    defaultConfig.jwt.expire_in
  );
};

const createRefreshToken = (payload) => {
  if (!defaultConfig.jwt.refresh_secret) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "JWT refresh secret is not defined"
    );
  }
  return createToken(
    payload,
    defaultConfig.jwt.refresh_secret,
    defaultConfig.jwt.refresh_expires_in
  );
};

export const jwtHelper = {
  createToken,
  verifyToken,
  createAccessToken,
  createRefreshToken,
};
