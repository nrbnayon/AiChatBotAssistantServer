import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Strategy as YahooStrategy } from "passport-yahoo-oauth";
import dotenv from "dotenv";
import User, { DEFAULT_IMPORTANT_KEYWORDS } from "../models/User.js";
import { generateTokens } from "../controllers/authController.js";

dotenv.config();

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

const oauthCallback = async (
  accessToken,
  refreshToken,
  profile,
  done,
  provider
) => {
  try {
    const email = getEmail(profile, provider);
    if (!email) {
      return done(
        new Error(`Unable to extract email from ${provider} profile`),
        null
      );
    }

    console.log(`[INFO] ${provider} OAuth login attempt for: ${email}`);

    const providerFields = {
      google: {
        idField: "googleId",
        accessTokenField: "googleAccessToken",
        refreshTokenField: "googleRefreshToken",
        expiryField: "googleAccessTokenExpires",
      },
      microsoft: {
        idField: "microsoftId",
        accessTokenField: "microsoftAccessToken",
        refreshTokenField: "microsoftRefreshToken",
        expiryField: "microsoftAccessTokenExpires",
      },
      yahoo: {
        idField: "yahooId",
        accessTokenField: "yahooAccessToken",
        refreshTokenField: "yahooRefreshToken",
        expiryField: "yahooAccessTokenExpires",
      },
    };

    if (!providerFields[provider]) {
      return done(new Error(`Unsupported provider: ${provider}`), null);
    }

    const { idField, accessTokenField, refreshTokenField, expiryField } =
      providerFields[provider];
    const profilePicture = getProfilePicture(profile, provider);

    let user = await User.findOne({ email });

    if (user) {
      user[idField] = profile.id;
      user[accessTokenField] = accessToken;
      user[refreshTokenField] = refreshToken || user[refreshTokenField];
      user[expiryField] = Date.now() + 24 * 3600 * 1000; // Default 1-day expiry
      user.authProvider = provider;
      user.verified = true;
      user.lastSync = new Date();

      if (profilePicture) {
        user.profilePicture = profilePicture;
      }

      if (
        !user.userImportantMailKeywords ||
        user.userImportantMailKeywords.length === 0
      ) {
        user.userImportantMailKeywords = [...DEFAULT_IMPORTANT_KEYWORDS];
      }

      await user.save();
      console.log(
        `[INFO] Updated existing user for ${email} with ${provider} credentials`
      );
    } else {
      user = await User.create({
        email,
        name: profile.displayName || email.split("@")[0],
        [idField]: profile.id,
        [accessTokenField]: accessToken,
        [refreshTokenField]: refreshToken,
        [expiryField]: Date.now() + 3600 * 1000,
        authProvider: provider,
        verified: true,
        profilePicture: profilePicture,
        subscription: { plan: "free", dailyTokens: 100 },
        lastSync: new Date(),
        userImportantMailKeywords: [...DEFAULT_IMPORTANT_KEYWORDS],
      });
      console.log(
        `[INFO] Created new user for ${email} with ${provider} credentials`
      );
    }

    const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
      generateTokens(user);

    user.refreshToken = jwtRefreshToken;
    await user.save();

    return done(null, user, {
      accessToken: jwtAccessToken,
      refreshToken: jwtRefreshToken,
    });
  } catch (error) {
    console.error(`[ERROR] ${provider} OAuth callback failed:`, error.message);
    return done(error, null);
  }
};

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
      accessType: "offline",
      prompt: "consent",
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
      scope: [
        "offline_access",
        "User.Read",
        "Mail.Read",
        "Mail.ReadWrite",
        "Mail.Send",
      ],
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

Object.entries(strategies).forEach(([provider, { options, Strategy }]) => {
  passport.use(
    new Strategy(options, (accessToken, refreshToken, profile, done) =>
      oauthCallback(accessToken, refreshToken, profile, done, provider)
    )
  );
});

export default passport;
