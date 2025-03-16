// config/passport.js
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Strategy as YahooStrategy } from "passport-yahoo-oauth";
import dotenv from "dotenv";
import User from "../models/User.js";
import { generateTokens } from "../controllers/authController.js";

dotenv.config();

// Session serialization and deserialization
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    console.error("Deserialize User Error:", error.message);
    done(error, null);
  }
});

/**
 * Get profile picture from provider-specific profile object
 * @param {Object} profile - The OAuth provider profile
 * @param {String} provider - The OAuth provider name
 * @returns {String|null} Profile picture URL or null
 */
const getProfilePicture = (profile, provider) => {
  try {
    switch (provider) {
      case "google":
        return profile.photos && profile.photos.length > 0
          ? profile.photos[0].value
          : null;
      case "microsoft":
        return profile._json.photo || profile._json.picture || null;
      case "yahoo":
        return profile._json.profile_image || null;
      default:
        return null;
    }
  } catch (error) {
    console.error(
      `Error extracting profile picture for ${provider}:`,
      error.message
    );
    return null;
  }
};

/**
 * Get email from provider-specific profile object
 * @param {Object} profile - The OAuth provider profile
 * @param {String} provider - The OAuth provider name
 * @returns {String|null} Email address or null
 */
const getEmail = (profile, provider) => {
  try {
    if (provider === "microsoft") {
      return profile._json.mail || profile._json.userPrincipalName;
    } else if (profile.emails && profile.emails.length > 0) {
      return profile.emails[0].value;
    }
    return null;
  } catch (error) {
    console.error(`Error extracting email for ${provider}:`, error.message);
    return null;
  }
};

/**
 * Common OAuth callback handler for all providers
 */
const oauthCallback = async (
  accessToken,
  refreshToken,
  profile,
  done,
  provider
) => {
  try {
    // Extract and validate email
    const email = getEmail(profile, provider);
    if (!email) {
      return done(
        new Error(`Unable to extract email from ${provider} profile`),
        null
      );
    }

    console.log(`[INFO] ${provider} OAuth login attempt for: ${email}`);

    // Define provider-specific field mappings
    const providerFields = {
      google: {
        idField: "googleId",
        accessTokenField: "googleAccessToken",
        refreshTokenField: "googleRefreshToken",
      },
      microsoft: {
        idField: "microsoftId",
        accessTokenField: "microsoftAccessToken",
        refreshTokenField: "microsoftRefreshToken",
      },
      yahoo: {
        idField: "yahooId",
        accessTokenField: "yahooAccessToken",
        refreshTokenField: "yahooRefreshToken",
      },
    };

    // Ensure provider is valid
    if (!providerFields[provider]) {
      return done(new Error(`Unsupported provider: ${provider}`), null);
    }

    const { idField, accessTokenField, refreshTokenField } =
      providerFields[provider];
    const profilePicture = getProfilePicture(profile, provider);

    // Find or create user
    let user = await User.findOne({ email });

    if (user) {
      // Update existing user with new auth info
      user[idField] = profile.id;
      user[accessTokenField] = accessToken;
      user[refreshTokenField] = refreshToken;
      user.authProvider = provider;
      user.verified = true;
      user.lastSync = new Date();

      if (profilePicture) {
        user.profilePicture = profilePicture;
      }

      await user.save();
      console.log(
        `[INFO] Updated existing user for ${email} with ${provider} credentials`
      );
    } else {
      // Create new user
      user = await User.create({
        email,
        name: profile.displayName || email.split("@")[0],
        [idField]: profile.id,
        [accessTokenField]: accessToken,
        [refreshTokenField]: refreshToken,
        authProvider: provider,
        verified: true,
        profilePicture: profilePicture,
        subscription: { plan: "free", dailyTokens: 100 },
        lastSync: new Date(),
      });
      console.log(
        `[INFO] Created new user for ${email} with ${provider} credentials`
      );
    }

    // Generate JWT tokens for our application
    const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
      generateTokens(user);

    // Store refresh token
    user.refreshToken = jwtRefreshToken;
    await user.save();

    // Complete authentication
    return done(null, user, {
      accessToken: jwtAccessToken,
      refreshToken: jwtRefreshToken,
    });
  } catch (error) {
    console.error(`[ERROR] ${provider} OAuth callback failed:`, error.message);
    return done(error, null);
  }
};

// Define OAuth strategies
const strategies = {
  google: {
    options: {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.GOOGLE_LIVE_REDIRECT_URI
          : process.env.GOOGLE_REDIRECT_URI,
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.compose",
      ],
    },
    Strategy: GoogleStrategy,
  },
  microsoft: {
    options: {
      clientID: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.MICROSOFT_LIVE_REDIRECT_URI
          : process.env.MICROSOFT_REDIRECT_URI,
      scope: ["user.read", "mail.read", "mail.readwrite", "mail.send"],
      tenant: "common",
    },
    Strategy: MicrosoftStrategy,
  },
  yahoo: {
    options: {
      consumerKey: process.env.YAHOO_CLIENT_ID,
      consumerSecret: process.env.YAHOO_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.YAHOO_REDIRECT_URI
          : process.env.YAHOO_DEV_REDIRECT_URI,
      scope: ["profile", "email", "mail-r", "mail-w"],
    },
    Strategy: YahooStrategy,
  },
};

// Register all strategies
Object.entries(strategies).forEach(([provider, { options, Strategy }]) => {
  passport.use(
    new Strategy(options, (accessToken, refreshToken, profile, done) =>
      oauthCallback(accessToken, refreshToken, profile, done, provider)
    )
  );
});

export default passport;
