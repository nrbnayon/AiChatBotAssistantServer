// helper/cookieHelper.js
import dotenv from "dotenv";
import os from "os";
dotenv.config();

const getFrontendDomain = () => {
  const frontendUrl =
    process.env.NODE_ENV === "production"
      ? process.env.FRONTEND_LIVE_URL
      : process.env.FRONTEND_URL;

  try {
    const url = new URL(frontendUrl);
    return url.hostname;
  } catch (e) {
    console.error("Could not parse frontend URL:", e);
    return null;
  }
};

const isLocalhost = () => {
  const hostname = process.env.HOSTNAME || os.hostname();
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    return true;
  }
  if (
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    (hostname.startsWith("172.") &&
      parseInt(hostname.split(".")[1]) >= 16 &&
      parseInt(hostname.split(".")[1]) <= 31)
  ) {
    return true;
  }
  if (process.env.ALLOW_LOCAL_NETWORK === "true") {
    return true;
  }

  return false;
};

const shouldUseSecure = () => {
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  if (isLocalhost()) {
    return false;
  }
  return false;
};

const getSameSiteSetting = () => {
  if (process.env.NODE_ENV === "production") {
    return "none";
  }
  if (process.env.ALLOW_LOCAL_NETWORK === "true") {
    return "none";
  }
  return "lax";
};

const getDomainSetting = () => {
  if (process.env.NODE_ENV === "production") {
    return process.env.COOKIE_DOMAIN || getFrontendDomain();
  }

  if (process.env.ALLOW_LOCAL_NETWORK === "true") {
    return undefined;
  }
  return undefined;
};

const defaultConfig = {
  cookies: {
    httpOnly: true,
    secure: shouldUseSecure(),
    sameSite: getSameSiteSetting(),
    path: "/",
    domain: getDomainSetting(),
  },
};

const getBaseOptions = () => {
  const options = {
    httpOnly: defaultConfig.cookies.httpOnly,
    secure: defaultConfig.cookies.secure,
    sameSite: defaultConfig.cookies.sameSite,
    path: defaultConfig.cookies.path,
  };
  if (defaultConfig.cookies.domain) {
    options.domain = defaultConfig.cookies.domain;
  }

  return options;
};

export const cookieHelper = {
  getAccessTokenOptions: () => ({
    ...getBaseOptions(),
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  }),

  getRefreshTokenOptions: () => ({
    ...getBaseOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  }),
};

export const safeCookie = {
  set: (res, name, value, options) => {
    try {
      const modifiedOptions = { ...options };
      if (isLocalhost() || process.env.ALLOW_LOCAL_NETWORK === "true") {
        modifiedOptions.secure = false;
        if (process.env.ALLOW_LOCAL_NETWORK === "true") {
          modifiedOptions.sameSite = "none";
          if (process.env.FORCE_SECURE_COOKIES === "true") {
            modifiedOptions.secure = true;
          }
        }
      }

      // Set cookie with modified options
      res.cookie(name, value, modifiedOptions);
      console.log(
        `Cookie '${name}' set successfully with options:`,
        modifiedOptions
      );
    } catch (error) {
      console.error(`Failed to set cookie '${name}':`, error.message);
      const simpleOptions = {
        httpOnly: options.httpOnly || true,
        secure: false,
        path: options.path || "/",
        maxAge: options.maxAge,
      };

      res.cookie(name, value, simpleOptions);
      console.log(`Cookie '${name}' set with fallback options:`, simpleOptions);
    }
  },
  clear: (res, name, options) => {
    try {
      const modifiedOptions = { ...options };
      if (isLocalhost() || process.env.ALLOW_LOCAL_NETWORK === "true") {
        modifiedOptions.secure = false;
        if (process.env.ALLOW_LOCAL_NETWORK === "true") {
          modifiedOptions.sameSite = "none";
          if (process.env.FORCE_SECURE_COOKIES === "true") {
            modifiedOptions.secure = true;
          }
        }
      }

      res.clearCookie(name, modifiedOptions);
      console.log(
        `Cookie '${name}' cleared successfully with options:`,
        modifiedOptions
      );
    } catch (error) {
      console.error(`Failed to clear cookie '${name}':`, error.message);

      const simpleOptions = {
        httpOnly: options.httpOnly || true,
        secure: false,
        path: options.path || "/",
      };

      res.clearCookie(name, simpleOptions);
      console.log(
        `Cookie '${name}' cleared with fallback options:`,
        simpleOptions
      );
    }
  },
};