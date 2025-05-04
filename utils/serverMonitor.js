// utils/serverMonitor.js - Enhanced version with PM2 integration
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Server Monitor - Ensures the server keeps running no matter what
 * @param {Express} app - Express application instance
 * @param {number} port - Port to listen on
 * @param {string} ipAddress - IP address to bind to
 * @param {number} restartDelay - Delay in ms before attempting restart
 * @returns {Object} - Server controller with start and stop methods
 */
const serverMonitor = (app, port, ipAddress, restartDelay = 1000) => {
  let server = null;
  let isShuttingDown = false;
  let restartAttempts = 0;
  const MAX_RESTART_ATTEMPTS = 100; // Increased for high resilience

  // Create logs directory if it doesn't exist
  const logsDir = path.join(path.dirname(__dirname), "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Log function
  const logToFile = (message) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(path.join(logsDir, "server-monitor.log"), logMessage);
  };

  // Start the server
  const start = () => {
    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server from Express app
        server = createServer(app);

        // Set large timeout value
        server.timeout = 300000; // 5 minutes

        // Error handling for server
        server.on("error", (error) => {
          console.error("💥 SERVER ERROR:", error);
          logToFile(`SERVER ERROR: ${error.message} (${error.code})`);

          if (error.code === "EADDRINUSE") {
            console.error(
              `⚠️ Port ${port} is already in use. Trying again in ${
                restartDelay / 1000
              } seconds...`
            );
            logToFile(
              `Port ${port} is already in use. Trying again in ${
                restartDelay / 1000
              } seconds.`
            );
          }

          // Only attempt restart if not deliberately shutting down
          if (!isShuttingDown) {
            attemptRestart();
          }
        });

        // PM2 integration - signal ready
        server.listen(port, ipAddress, () => {
          restartAttempts = 0; // Reset counter on successful start
          const message = `Server launched successfully on ${ipAddress}:${port}`;
          console.log(`
          ╔═════════════════════════════════════╗
          ║  🚀 Server launched successfully!   ║
          ║  🌐 Running on:${ipAddress}:${port.toString().padEnd(10, " ")} ║
          ╚═════════════════════════════════════╝
          `);
          logToFile(message);

          // Signal to PM2 that we're ready (for wait_ready option)
          if (process.send) {
            process.send("ready");
          }

          resolve(server);
        });

        // Handle graceful shutdown signals from PM2
        process.on("SIGINT", () => handleTermination("SIGINT"));
        process.on("SIGTERM", () => handleTermination("SIGTERM"));

        // Listen for PM2 message to shutdown gracefully
        process.on("message", (msg) => {
          if (msg === "shutdown") {
            handleTermination("PM2-shutdown");
          }
        });
      } catch (err) {
        console.error("💥 FAILED TO START SERVER:", err);
        logToFile(`FAILED TO START SERVER: ${err.message}`);
        reject(err);
        attemptRestart();
      }
    });
  };

  // Gracefully stop the server
  const stop = () => {
    return new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }

      isShuttingDown = true;
      console.log("🛑 Shutting down server gracefully...");
      logToFile("Shutting down server gracefully");

      // Close all connections
      server.close(() => {
        console.log("✅ Server stopped successfully");
        logToFile("Server stopped successfully");
        server = null;
        isShuttingDown = false;
        resolve();
      });

      // Force close after timeout
      setTimeout(() => {
        if (server) {
          console.log("⚠️ Forcing server shutdown after timeout...");
          logToFile("Forcing server shutdown after timeout");
          server = null;
          isShuttingDown = false;
          resolve();
        }
      }, 15000); // Increased timeout to 15s for graceful shutdown
    });
  };

  // Handle termination signals
  const handleTermination = async (signal) => {
    console.log(`\n🛑 Received ${signal} signal. Shutting down gracefully...`);
    logToFile(`Received ${signal} signal. Shutting down gracefully`);

    await stop();

    // If it's a PM2 shutdown, let PM2 handle the process exit
    if (signal !== "PM2-shutdown") {
      process.exit(0);
    }
  };

  // Attempt to restart the server with exponential backoff
  const attemptRestart = async () => {
    if (isShuttingDown) return;

    restartAttempts++;

    if (restartAttempts > MAX_RESTART_ATTEMPTS) {
      const message = `Maximum restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Please check your application for issues.`;
      console.error(`❌ ${message}`);
      logToFile(message);
      return;
    }

    console.log(
      `🔄 Attempting server restart (${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`
    );
    logToFile(
      `Attempting server restart (${restartAttempts}/${MAX_RESTART_ATTEMPTS})`
    );

    // Close server if it exists
    if (server) {
      await stop();
    }

    // Calculate delay with exponential backoff (capped at 30 seconds)
    const calculatedDelay = Math.min(
      restartDelay * Math.pow(1.5, restartAttempts - 1),
      30000
    );

    // Wait before restarting
    setTimeout(async () => {
      try {
        await start();
      } catch (err) {
        console.error("💥 Restart attempt failed:", err);
        logToFile(`Restart attempt failed: ${err.message}`);
      }
    }, calculatedDelay);
  };

  // Enhanced health check function
  const healthCheck = () => {
    return {
      status: server ? "UP" : "DOWN",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
      restartAttempts,
      serverInfo: {
        port,
        ipAddress,
        environment: process.env.NODE_ENV || "development",
      },
    };
  };

  return {
    start,
    stop,
    attemptRestart,
    healthCheck,
    get isRunning() {
      return !!server;
    },
    get restartCount() {
      return restartAttempts;
    },
  };
};

export default serverMonitor;
