// helpers/jwtHelper.js
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { ApiError } from "../utils/errorHandler.js";

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
  return createToken(
    payload,
    process.env.JWT_SECRET,
    process.env.JWT_EXPIRE_IN || "1d"
  );
};

const createRefreshToken = (payload) => {
  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "JWT refresh secret is not defined"
    );
  }
  return createToken(
    payload,
    process.env.REFRESH_TOKEN_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN || "30d"
  );
};

// Helper function to convert JWT expiry format to milliseconds
function convertExpiryToMs(expiryString) {
  const unit = expiryString.slice(-1);
  const value = parseInt(expiryString.slice(0, -1));

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return 15 * 24 * 60 * 60 * 1000; // Default to 15 days
  }
}

// Convert JWT expiration time string to milliseconds for cookies
const getAccessTokenExpiryMs = () => {
  const expiry = process.env.JWT_EXPIRE_IN || "15d";
  return convertExpiryToMs(expiry);
};

const getRefreshTokenExpiryMs = () => {
  const expiry = process.env.JWT_REFRESH_EXPIRES_IN || "30d";
  return convertExpiryToMs(expiry);
};

export const jwtHelper = {
  createToken,
  verifyToken,
  createAccessToken,
  createRefreshToken,
  getAccessTokenExpiryMs,
  getRefreshTokenExpiryMs,
};
