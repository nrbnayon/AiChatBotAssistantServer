// config\passport.js
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Strategy as YahooStrategy } from "passport-yahoo-oauth";
import dotenv from "dotenv";
import User from "../models/User.js";
import { generateTokens } from "../controllers/authController.js";

dotenv.config();

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

const oauthCallback = async (
  accessToken,
  refreshToken,
  profile,
  done,
  provider
) => {
  try {
    const email =
      provider === "microsoft"
        ? profile._json.mail || profile._json.userPrincipalName
        : profile.emails[0].value;
    let user = await User.findOne({ email });

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

    const { idField, accessTokenField, refreshTokenField } =
      providerFields[provider];
    const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
      generateTokens(user || {});

    if (user) {
      user[idField] = profile.id;
      user[accessTokenField] = accessToken;
      user[refreshTokenField] = refreshToken;
      user.authProvider = provider;
      user.verified = true;
      user.refreshToken = jwtRefreshToken;
      await user.save();
    } else {
      user = await User.create({
        email,
        name: profile.displayName,
        [idField]: profile.id,
        [accessTokenField]: accessToken,
        [refreshTokenField]: refreshToken,
        authProvider: provider,
        verified: true,
        refreshToken: jwtRefreshToken,
      });
    }

    return done(null, user, {
      accessToken: jwtAccessToken,
      refreshToken: jwtRefreshToken,
    });
  } catch (error) {
    return done(error, null);
  }
};

passport.use(
  new GoogleStrategy(
    {
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
      ],
    },
    (accessToken, refreshToken, profile, done) =>
      oauthCallback(accessToken, refreshToken, profile, done, "google")
  )
);

passport.use(
  new MicrosoftStrategy(
    {
      clientID: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.MICROSOFT_LIVE_REDIRECT_URI
          : process.env.MICROSOFT_REDIRECT_URI,
      scope: ["user.read", "mail.read"],
      tenant: "common",
    },
    (accessToken, refreshToken, profile, done) =>
      oauthCallback(accessToken, refreshToken, profile, done, "microsoft")
  )
);

passport.use(
  new YahooStrategy(
    {
      consumerKey: process.env.YAHOO_CLIENT_ID,
      consumerSecret: process.env.YAHOO_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.YAHOO_REDIRECT_URI
          : process.env.YAHOO_DEV_REDIRECT_URI ||
            "http://localhost:4000/api/v1/auth/yahoo/callback",
      scope: ["profile", "email", "mail-r"],
    },
    (accessToken, refreshToken, profile, done) =>
      oauthCallback(accessToken, refreshToken, profile, done, "yahoo")
  )
);

export default passport;
