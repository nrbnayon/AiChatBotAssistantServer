// config\passport.js
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import dotenv from "dotenv";
import axios from "axios"; // Add axios for making HTTP requests
import User, { DEFAULT_IMPORTANT_KEYWORDS } from "../models/User.js";
import { generateTokens } from "../controllers/authController.js";
import WaitingList from "../models/WaitingList.js";
import { encrypt } from "../utils/encryptionUtils.js";
import { sendFirstLoginConfirmation } from "../helper/notifyByEmail.js";

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

const getProfilePicture = async (profile, provider, accessToken) => {
  try {
    switch (provider) {
      case "google":
        return profile.photos && profile.photos.length > 0
          ? profile.photos[0].value
          : null;
      case "microsoft":
        // For Microsoft, we need to make a separate API call to get the profile picture
        if (accessToken) {
          try {
            // Get the profile picture using Microsoft Graph API
            const response = await axios.get(
              "https://graph.microsoft.com/v1.0/me/photo/$value",
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
                responseType: "arraybuffer",
              }
            );

            // Convert the binary data to a base64 string
            if (response.data) {
              const base64Image = Buffer.from(response.data).toString("base64");
              return `data:image/jpeg;base64,${base64Image}`;
            }
          } catch (err) {
            // If there's an error fetching the profile picture, log it but continue
            console.log(
              "Error fetching Microsoft profile picture:",
              err.message
            );
            // Try fallback methods if available
            return profile._json.photo || profile._json.picture || null;
          }
        }
        return null;
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
    // ----- waitingListEntry check email ------
    const waitingListEntry = await WaitingList.findOne({
      email,
    });

    if (!waitingListEntry) {
      return done(null, false, {
        message: `Access denied: The email ${email} is not found in our waiting list. Please join the waiting list first to proceed.`,
      });
    }

    if (waitingListEntry.status !== "approved") {
      return done(null, false, {
        message: `Access denied: The email ${email} is registered but not yet approved. Please wait for admin approval.`,
      });
    }

    // ----- waitingListEntry check email ------

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
    };

    if (!providerFields[provider]) {
      return done(new Error(`Unsupported provider: ${provider}`), null);
    }

    const { idField, accessTokenField, refreshTokenField, expiryField } =
      providerFields[provider];

    // Get profile picture - now with async support
    const profilePicture = await getProfilePicture(
      profile,
      provider,
      accessToken
    );

    // Encrypt sensitive tokens
    // const encryptedAccessToken = encrypt(accessToken);
    // const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : null;
    // Non Encrypt sensitive tokens
    const encryptedAccessToken = (accessToken);
    const encryptedRefreshToken = refreshToken ? (refreshToken) : null;

    let user = await User.findOne({ email });

    if (user) {
      user[idField] = profile.id;
      user[accessTokenField] = encryptedAccessToken;
      user[refreshTokenField] =
        encryptedRefreshToken || user[refreshTokenField];
      user[expiryField] = Date.now() + 24 * 3600 * 1000;
      user.authProvider = provider;
      user.verified = true;
      user.lastSync = new Date();

      if (
        !user.inboxList.includes(waitingListEntry.inbox) &&
        !user.inboxList.includes(email)
      ) {
        user.inboxList.push(waitingListEntry.inbox || email);
      }

      if (profilePicture) user.profilePicture = profilePicture;

      if (
        !user.userImportantMailKeywords ||
        user.userImportantMailKeywords.length === 0
      ) {
        user.userImportantMailKeywords = [...DEFAULT_IMPORTANT_KEYWORDS];
      }

      await user.save();

      if (user.firstLogin) {
        await sendFirstLoginConfirmation(user);
        user.firstLogin = false;
        await user.save();
      }
    } else {
      user = await User.create({
        email,
        name: profile.displayName || email.split("@")[0],
        [idField]: profile.id,
        [accessTokenField]: encryptedAccessToken,
        [refreshTokenField]: encryptedRefreshToken,
        [expiryField]: Date.now() + 24 * 3600 * 1000,
        authProvider: provider,
        verified: true,
        profilePicture,
        subscription: {
          plan: "free",
          dailyQueries: 5,
          remainingQueries: 5,
          status: "active",
          startDate: new Date(),
          endDate: new Date().setFullYear(new Date().getFullYear() + 10),
        },
        lastSync: new Date(),
        inboxList: [email || waitingListEntry.inbox],
        userImportantMailKeywords: [...DEFAULT_IMPORTANT_KEYWORDS],
      });
    }

    const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
      generateTokens(user);
    user.refreshToken = jwtRefreshToken;
    await user.save();

    if (user.firstLogin) {
      await sendFirstLoginConfirmation(user);
      user.firstLogin = false;
      await user.save();
    }

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
      // prompt: "consent",
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
        "user.read", // Add this scope to access profile information
      ],
      tenant: "common",
    },
    Strategy: MicrosoftStrategy,
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

// // config\passport.js
// import passport from "passport";
// import { Strategy as GoogleStrategy } from "passport-google-oauth20";
// import { Strategy as MicrosoftStrategy } from "passport-microsoft";
// import dotenv from "dotenv";
// import User, { DEFAULT_IMPORTANT_KEYWORDS } from "../models/User.js";
// import { generateTokens } from "../controllers/authController.js";
// import WaitingList from "../models/WaitingList.js";
// import { encrypt } from "../utils/encryptionUtils.js";
// import { sendFirstLoginConfirmation } from "../helper/notifyByEmail.js";

// dotenv.config();

// passport.serializeUser((user, done) => done(null, user.id));

// passport.deserializeUser(async (id, done) => {
//   try {
//     const user = await User.findById(id);
//     done(null, user);
//   } catch (error) {
//     console.error("Deserialize User Error:", error.message);
//     done(error, null);
//   }
// });

// const getProfilePicture = (profile, provider) => {
//   try {
//     switch (provider) {
//       case "google":
//         return profile.photos && profile.photos.length > 0
//           ? profile.photos[0].value
//           : null;
//       case "microsoft":
//         return profile._json.photo || profile._json.picture || null;
//       default:
//         return null;
//     }
//   } catch (error) {
//     console.error(
//       `Error extracting profile picture for ${provider}:`,
//       error.message
//     );
//     return null;
//   }
// };

// const getEmail = (profile, provider) => {
//   try {
//     if (provider === "microsoft") {
//       return profile._json.mail || profile._json.userPrincipalName;
//     } else if (profile.emails && profile.emails.length > 0) {
//       return profile.emails[0].value;
//     }
//     return null;
//   } catch (error) {
//     console.error(`Error extracting email for ${provider}:`, error.message);
//     return null;
//   }
// };

// const oauthCallback = async (
//   accessToken,
//   refreshToken,
//   profile,
//   done,
//   provider
// ) => {
//   try {
//     const email = getEmail(profile, provider);
//     if (!email) {
//       return done(
//         new Error(`Unable to extract email from ${provider} profile`),
//         null
//       );
//     }
//     // ----- waitingListEntry check email ------
//     const waitingListEntry = await WaitingList.findOne({
//       email,
//     });

//     // console.log(`[INFO] Waiting list entry for ${email}:`, waitingListEntry);

//     if (!waitingListEntry) {
//       return done(null, false, {
//         message: `Access denied: The email ${email} is not found in our waiting list. Please join the waiting list first to proceed.`,
//       });
//     }

//     if (waitingListEntry.status !== "approved") {
//       return done(null, false, {
//         message: `Access denied: The email ${email} is registered but not yet approved. Please wait for admin approval.`,
//       });
//     }

//     // console.log(`[INFO] ${provider} OAuth login attempt for: ${email}`);

//     // ----- waitingListEntry check email ------

//     const providerFields = {
//       google: {
//         idField: "googleId",
//         accessTokenField: "googleAccessToken",
//         refreshTokenField: "googleRefreshToken",
//         expiryField: "googleAccessTokenExpires",
//       },
//       microsoft: {
//         idField: "microsoftId",
//         accessTokenField: "microsoftAccessToken",
//         refreshTokenField: "microsoftRefreshToken",
//         expiryField: "microsoftAccessTokenExpires",
//       },
//     };

//     if (!providerFields[provider]) {
//       return done(new Error(`Unsupported provider: ${provider}`), null);
//     }

//     const { idField, accessTokenField, refreshTokenField, expiryField } =
//       providerFields[provider];
//     const profilePicture = getProfilePicture(profile, provider);

//     // Encrypt sensitive tokens
//     const encryptedAccessToken = encrypt(accessToken);
//     const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : null;

//     let user = await User.findOne({ email });

//     if (user) {
//       user[idField] = profile.id;
//       user[accessTokenField] = encryptedAccessToken;
//       user[refreshTokenField] =
//         encryptedRefreshToken || user[refreshTokenField];
//       user[expiryField] = Date.now() + 24 * 3600 * 1000;
//       user.authProvider = provider;
//       user.verified = true;
//       user.lastSync = new Date();

//       if (
//         !user.inboxList.includes(waitingListEntry.inbox) &&
//         !user.inboxList.includes(email)
//       ) {
//         user.inboxList.push(waitingListEntry.inbox || email);
//       }

//       if (profilePicture) user.profilePicture = profilePicture;

//       if (
//         !user.userImportantMailKeywords ||
//         user.userImportantMailKeywords.length === 0
//       ) {
//         user.userImportantMailKeywords = [...DEFAULT_IMPORTANT_KEYWORDS];
//       }

//       await user.save();

//       if (user.firstLogin) {
//         await sendFirstLoginConfirmation(user);
//         user.firstLogin = false;
//         await user.save();
//       }
//       // console.log(
//       //   `[INFO] Updated existing user for ${email} with ${provider} credentials`
//       // );
//     } else {
//       user = await User.create({
//         email,
//         name: profile.displayName || email.split("@")[0],
//         [idField]: profile.id,
//         [accessTokenField]: encryptedAccessToken,
//         [refreshTokenField]: encryptedRefreshToken,
//         [expiryField]: Date.now() + 24 * 3600 * 1000,
//         authProvider: provider,
//         verified: true,
//         profilePicture,
//         subscription: {
//           plan: "free",
//           dailyQueries: 5,
//           remainingQueries: 5,
//           status: "active",
//           startDate: new Date(),
//           endDate: new Date().setFullYear(new Date().getFullYear() + 10),
//         }, // Changed: Free plan for new users
//         lastSync: new Date(),
//         inboxList: [email || waitingListEntry.inbox],
//         userImportantMailKeywords: [...DEFAULT_IMPORTANT_KEYWORDS],
//       });
//       // console.log(
//       //   `[INFO] Created new user for ${email} with ${provider} credentials`
//       // );
//     }

//     const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken } =
//       generateTokens(user);
//     user.refreshToken = jwtRefreshToken;
//     await user.save();

//     if (user.firstLogin) {
//       await sendFirstLoginConfirmation(user);
//       user.firstLogin = false;
//       await user.save();
//     }

//     return done(null, user, {
//       accessToken: jwtAccessToken,
//       refreshToken: jwtRefreshToken,
//     });
//   } catch (error) {
//     console.error(`[ERROR] ${provider} OAuth callback failed:`, error.message);
//     return done(error, null);
//   }
// };

// const strategies = {
//   google: {
//     options: {
//       clientID: process.env.GOOGLE_CLIENT_ID,
//       clientSecret: process.env.GOOGLE_CLIENT_SECRET,
//       callbackURL:
//         process.env.NODE_ENV === "production"
//           ? process.env.GOOGLE_LIVE_REDIRECT_URI
//           : process.env.GOOGLE_REDIRECT_URI,
//       scope: [
//         "profile",
//         "email",
//         "https://www.googleapis.com/auth/gmail.readonly",
//         "https://www.googleapis.com/auth/gmail.modify",
//         "https://www.googleapis.com/auth/gmail.send",
//         "https://www.googleapis.com/auth/gmail.compose",
//       ],
//       accessType: "offline",
//       prompt: "consent",
//     },
//     Strategy: GoogleStrategy,
//   },
//   microsoft: {
//     options: {
//       clientID: process.env.MICROSOFT_CLIENT_ID,
//       clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
//       callbackURL:
//         process.env.NODE_ENV === "production"
//           ? process.env.MICROSOFT_LIVE_REDIRECT_URI
//           : process.env.MICROSOFT_REDIRECT_URI,
//       scope: [
//         "offline_access",
//         "User.Read",
//         "Mail.Read",
//         "Mail.ReadWrite",
//         "Mail.Send",
//       ],
//       tenant: "common",
//     },
//     Strategy: MicrosoftStrategy,
//   },
// };

// Object.entries(strategies).forEach(([provider, { options, Strategy }]) => {
//   passport.use(
//     new Strategy(options, (accessToken, refreshToken, profile, done) =>
//       oauthCallback(accessToken, refreshToken, profile, done, provider)
//     )
//   );
// });

// export default passport;
