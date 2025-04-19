// utils\errorHandler.js

/**
 * Custom error class with status code
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Enhanced API error class with emoji and fun text
 */
class ApiError extends Error {
  constructor(statusCode, message, clientFacing = true) {
    const numericStatusCode =
      typeof statusCode === "number" ? statusCode : parseInt(statusCode) || 500;

    // Only add emoji and funny message for non-client-facing errors (e.g., logs)
    if (!clientFacing) {
      const emoji = getErrorEmoji(numericStatusCode);
      const funMessage = getFunnyErrorMessage(numericStatusCode);
      super(`${emoji} ${message} ${funMessage}`);
    } else {
      super(message); // Use plain message for client-facing errors
    }

    this.statusCode = numericStatusCode;
    this.status = `${numericStatusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Get emoji based on status code
 */
const getErrorEmoji = (statusCode) => {
  const statusMap = {
    400: "🤦‍♂️",
    401: "🔐",
    403: "🚫",
    404: "🔍",
    500: "💥",
    503: "⏳",
  };

  return statusMap[statusCode] || "⚠️";
};

/**
 * Async function wrapper to catch errors and pass to next()
 * @param {Function} fn - Async controller function
 * @returns {Function} - Express middleware function
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Fun error messages for developers
 */
const devErrorMessages = {
  400: [
    "🤦‍♂️ Bad request? More like bad code! Just kidding... maybe?",
    "🧩 You've got a 400! Apparently the code is playing hard to get.",
    "🔍 Error 400: Your request is like my morning coffee - not properly formed.",
  ],
  401: [
    "🔐 Authentication failed. Your code needs an ID card!",
    "🕵️‍♂️ Who ARE you? The server would like to know!",
    "🚫 Access denied! Try bribing the server with cookies next time.",
  ],
  403: [
    "🛑 The server knows who you are, it just doesn't like you.",
    "🔒 Forbidden! Did you forget to say 'please'?",
    "🚷 Error 403: You shall not pass! 🧙‍♂️",
  ],
  404: [
    "🏜️ 404: Got lost in the backend wilderness!",
    "👻 This resource is playing hide and seek... and winning.",
    "🔭 Looking for something? It's not here. Not even under the couch.",
  ],
  500: [
    "💥 Server crashed harder than my motivation on Monday morning.",
    "🤯 Error 500: Server had a meltdown. Get it some ice cream!",
    "🔥 The server is on fire! Not the good kind of fire.",
  ],
  503: [
    "🛌 Service unavailable. The server decided to take a nap.",
    "⏳ The server is experiencing an existential crisis. Try again later.",
    "🚑 Error 503: Service temporarily down for emotional support.",
  ],
  default: [
    "🤷‍♂️ Something broke. Have you tried turning it off and on again?",
    "🧙‍♂️ Mysterious error appeared! Quick, capture it in a Pokéball!",
    "🎲 Random error. The backend gods are not pleased with your offerings.",
  ],
};

/**
 * Get a random fun message based on status code
 */
const getFunnyErrorMessage = (statusCode) => {
  const messages = devErrorMessages[statusCode] || devErrorMessages.default;
  return messages[Math.floor(Math.random() * messages.length)];
};

/**
 * Global error handler middleware
 */
const globalErrorHandler = (err, req, res, next) => {
  try {
    err = handleMongoErrors(err);

    err.statusCode =
      typeof err.statusCode === "number"
        ? err.statusCode
        : parseInt(err.statusCode) || 500;
    err.status = err.status || "error";

    // Strip emojis and funny messages from the error message
    let cleanMessage = err.message;
    if (err instanceof ApiError) {
      cleanMessage = cleanMessage.replace(/[^\w\s.,!?]/g, ""); // Remove emojis
      cleanMessage = cleanMessage.replace(/🔐.*$/, "").trim(); // Remove funny message
    }

    if (process.env.NODE_ENV === "development") {
      handleDevelopmentError(err, res);
    } else {
      handleProductionError({ ...err, message: cleanMessage }, res);
    }
  } catch (handlerError) {
    console.error("Error in error handler:", handlerError);
    res.status(500).json({
      success: false,
      statusCode: err.statusCode,
      status: "error",
      message: "Internal server error occurred",
    });
  }
};

/**
 * Development error handler with full details and funny messages
 */
const handleDevelopmentError = (err, res) => {
  const funnyMessage = getFunnyErrorMessage(err.statusCode);

  console.log("\n");
  console.log("⛔️ ERROR ENCOUNTERED ⛔️");
  console.log("------------------------");
  console.log(`${funnyMessage}`);
  console.log("------------------------\n");

  return res.json({
    success: false,
    status: err.status,
    statusCode: err.statusCode,
    message: err.message,
    funnyMessage: funnyMessage,
    // stack: err.stack,
    error: err,
  });
};

/**
 * Production error handler with limited details
 */
const handleProductionError = (err, res) => {
  if (err.isOperational) {
    return res.json({
      success: false,
      status: err.status,
      statusCode: err.statusCode,
      message: err.message,
      funnyMessage: funnyMessage,
    });
  }

  console.error("ERROR 💥", err);
  return res.status(500).json({
    success: false,
    status: "error",
    message: "Something went wrong",
  });
};

/**
 * Handle specific MongoDB errors with humorous messages
 */
const handleMongoErrors = (err) => {
  if (err.name === "CastError") {
    return new AppError(
      `Invalid ${err.path}: ${err.value}. Please provide a valid ID. 🧐`,
      400
    );
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return new AppError(
      `Duplicate field value: ${field}. This value is already taken! Be more creative. 🎨`,
      400
    );
  }
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((el) => el.message);
    return new AppError(
      `Invalid input data: ${errors.join(
        ". "
      )}. Your data failed the vibe check. 🔍`,
      400
    );
  }
  if (err.name === "JsonWebTokenError") {
    return new AppError("Invalid token. Are you trying to hack us? 🕵️‍♂️", 401);
  }
  if (err.name === "TokenExpiredError") {
    return new AppError(
      "Your token has expired! Time flies when you're coding. ⏰",
      401
    );
  }
  return err;
};

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  logErrorWithStyle(err);

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

/**
 * Log error with fun ASCII art based on severity
 */
const logErrorWithStyle = (err) => {
  const isServerError = err.statusCode >= 500;

  if (isServerError) {
    console.log(`
    ╔═════════════════════════════════╗
    ║    SERVER ERROR DETECTED! 😱    ║
    ╚═════════════════════════════════╝
    `);
  } else {
    console.log(`
    ╔═════════════════════════════════╗
    ║    CLIENT ERROR DETECTED! 🤔    ║
    ╚═════════════════════════════════╝
    `);
  }

  console.error(err);
};

export {
  AppError,
  ApiError,
  catchAsync,
  errorHandler,
  globalErrorHandler,
  handleMongoErrors,
  logErrorWithStyle,
};
