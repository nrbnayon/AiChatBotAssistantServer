import { google } from "googleapis";
import User from "../models/User.js";

/**
 * Refreshes the Google OAuth2 access token when it expires
 * @param {Object} user - User object containing Google OAuth credentials
 * @returns {Object} Object containing new access token and refresh token
 */
export async function refreshGoogleToken(user) {
  try {
    // If the token is still valid, return the existing token
    const now = Date.now();
    if (
      user.googleAccessToken &&
      user.googleAccessTokenExpires &&
      now < user.googleAccessTokenExpires - 60000 // 1 minute buffer
    ) {
      return {
        accessToken: user.googleAccessToken,
        refreshToken: user.googleRefreshToken,
      };
    }

    // Configure OAuth2 client with credentials
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.NODE_ENV === "production"
        ? process.env.GOOGLE_LIVE_REDIRECT_URI
        : process.env.GOOGLE_REDIRECT_URI
    );

    // Set refresh token
    oauth2Client.setCredentials({
      refresh_token: user.googleRefreshToken,
    });

    // Get new access token
    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update user with new tokens
    user.googleAccessToken = credentials.access_token;
    user.googleAccessTokenExpires = Date.now() + credentials.expires_in * 1000;

    // Save user to database
    await User.findByIdAndUpdate(user._id, {
      googleAccessToken: credentials.access_token,
      googleAccessTokenExpires: Date.now() + credentials.expires_in * 1000,
      lastSync: new Date(),
    });

    console.log(`[INFO] Refreshed Google token for user ${user.email}`);

    return {
      accessToken: credentials.access_token,
      refreshToken: user.googleRefreshToken,
    };
  } catch (error) {
    console.error(`[ERROR] Failed to refresh Google token: ${error.message}`);
    throw new Error(`Failed to refresh Google token: ${error.message}`);
  }
}
