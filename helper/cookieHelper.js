// helper/cookieHelper.js
const defaultConfig = {
  cookies: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" ? true : false,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  },
};

const getBaseOptions = () => ({
  httpOnly: defaultConfig.cookies.httpOnly,
  secure: defaultConfig.cookies.secure,
  sameSite: defaultConfig.cookies.sameSite,
  path: defaultConfig.cookies.path,
});

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
      res.cookie(name, value, options);
      console.log(`Cookie '${name}' set successfully`);
    } catch (error) {
      console.error(`Failed to set cookie '${name}':`, error.message);
      const simpleOptions = { ...options };
      delete simpleOptions.domain;
      res.cookie(name, value, simpleOptions);
      console.log(`Cookie '${name}' set with fallback options`);
    }
  },

  clear: (res, name, options) => {
    try {
      res.clearCookie(name, options);
      console.log(`Cookie '${name}' cleared successfully`);
    } catch (error) {
      console.error(`Failed to clear cookie '${name}':`, error.message);
      const simpleOptions = { ...options };
      delete simpleOptions.domain;
      res.clearCookie(name, simpleOptions);
      console.log(`Cookie '${name}' cleared with fallback options`);
    }
  },
};