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
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ email: profile.emails[0].value });
        const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
          generateTokens(user || {});
        if (user) {
          user.googleId = profile.id;
          user.googleAccessToken = accessToken;
          user.googleRefreshToken = refreshToken;
          user.authProvider = "google";
          user.refreshToken = jwtRefreshToken;
          await user.save();
        } else {
          user = await User.create({
            email: profile.emails[0].value,
            name: profile.displayName,
            googleId: profile.id,
            googleAccessToken: accessToken,
            googleRefreshToken: refreshToken,
            authProvider: "google",
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
    }
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
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile._json.mail || profile._json.userPrincipalName;
        let user = await User.findOne({ email });
        const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
          generateTokens(user || {});
        if (user) {
          user.microsoftId = profile.id;
          user.microsoftAccessToken = accessToken;
          user.microsoftRefreshToken = refreshToken;
          user.authProvider = "microsoft";
          user.refreshToken = jwtRefreshToken;
          await user.save();
        } else {
          user = await User.create({
            email,
            name: profile.displayName,
            microsoftId: profile.id,
            microsoftAccessToken: accessToken,
            microsoftRefreshToken: refreshToken,
            authProvider: "microsoft",
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
    }
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
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ email: profile.emails[0].value });
        const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
          generateTokens(user || {});
        if (user) {
          user.yahooId = profile.id;
          user.yahooAccessToken = accessToken;
          user.yahooRefreshToken = refreshToken;
          user.authProvider = "yahoo";
          user.refreshToken = jwtRefreshToken;
          await user.save();
        } else {
          user = await User.create({
            email: profile.emails[0].value,
            name: profile.displayName,
            yahooId: profile.id,
            yahooAccessToken: accessToken,
            yahooRefreshToken: refreshToken,
            authProvider: "yahoo",
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
    }
  )
);

export default passport;
