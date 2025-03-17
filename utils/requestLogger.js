// utils/requestLogger.js
import colors from "colors";

// Configure colors
colors.setTheme({
  info: "blue",
  success: "green",
  warning: "yellow",
  error: "red",
  debug: "magenta",
});

/**
 * Middleware to log request and response details
 */
const requestLogger = (req, res, next) => {
  // Store original end method to intercept it
  const originalEnd = res.end;
  const startTime = Date.now();

  // Get the IP address
  const ip =
    req.headers["x-forwarded-for"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.connection.socket ? req.connection.socket.remoteAddress : null);

  // Format the start of the request
  console.log(
    colors.blue(`[${new Date().toISOString()}]`) +
      colors.yellow(` ${req.method}`) +
      ` ${req.originalUrl} - FROM IP:: ${ip}`
  );

  // Override res.end to capture and log response
  res.end = function (chunk, encoding) {
    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Get status code
    const statusCode = res.statusCode;

    // Choose color based on status code
    let statusColor;
    if (statusCode < 300) statusColor = colors.green(statusCode);
    else if (statusCode < 400) statusColor = colors.blue(statusCode);
    else if (statusCode < 500) statusColor = colors.yellow(statusCode);
    else statusColor = colors.red(statusCode);

    // Format and log the response
    console.log(
      colors.blue(`[${new Date().toISOString()}]`) +
        colors.yellow(` ${req.method}`) +
        ` ${req.originalUrl} ` +
        `${statusColor} ` +
        `${colors.magenta(responseTime + "ms")} ` +
        ` - FROM IP:: ${ip}`
    );

    // Call the original end method
    return originalEnd.apply(this, arguments);
  };

  next();
};

export default requestLogger;
