// helper\cookieHelper.js
const defaultConfig = {
  cookies: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: undefined,
  },
};

// Create base options function to reduce duplication
const getBaseOptions = () => {
  const options = {
    httpOnly: defaultConfig.cookies.httpOnly,
    secure: defaultConfig.cookies.secure,
    sameSite: defaultConfig.cookies.sameSite,
    path: defaultConfig.cookies.path,
  };

  if (defaultConfig.cookies.domain) {
    return { ...options, domain: defaultConfig.cookies.domain };
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
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  }),
};

export const safeCookie = {
  set: (res, name, value, options) => {
    try {
      res.cookie(name, value, options);
      console.log(`Cookie '${name}' set successfully`);
    } catch (error) {
      console.error(
        `Failed to set cookie '${name}':`,
        error instanceof Error ? error.message : String(error)
      );

      try {
        const simpleOptions = { ...options };
        delete simpleOptions.domain;
        res.cookie(name, value, simpleOptions);
        console.log(`Cookie '${name}' set with fallback options`);
      } catch (fallbackError) {
        console.error(
          `Critical: Failed to set cookie '${name}' even with fallback:`,
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        );
      }
    }
  },

  clear: (res, name, options) => {
    try {
      res.clearCookie(name, options);
      console.log(`Cookie '${name}' cleared successfully`);
    } catch (error) {
      console.error(
        `Failed to clear cookie '${name}':`,
        error instanceof Error ? error.message : String(error)
      );

      try {
        const simpleOptions = { ...options };
        delete simpleOptions.domain;
        res.clearCookie(name, simpleOptions);
        console.log(`Cookie '${name}' cleared with fallback options`);
      } catch (fallbackError) {
        console.error(
          `Critical: Failed to clear cookie '${name}' even with fallback:`,
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        );
      }
    }
  },
};
