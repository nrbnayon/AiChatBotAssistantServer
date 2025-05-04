// ecosystem.config.cjs - PM2 config file
module.exports = {
  apps: [
    {
      name: "email-ai-assistant",
      script: "index.js",
      watch: false,
      instances: "max", // Use max to utilize all available CPU cores
      exec_mode: "cluster", // Run in cluster mode for better performance
      autorestart: true,
      max_restarts: 10, // Keep a reasonable number
      min_uptime: "30s", // Increased to prevent restart loops
      restart_delay: 5000, // 5 second delay between restarts
      max_memory_restart: "1G", // Increased for better performance
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      merge_logs: true,
      // Required for proper ESM support
      node_args: "--experimental-specifier-resolution=node",
      // Increase timeout for long-running operations
      kill_timeout: 15000,
      // Wait before forcing shutdown
      shutdown_with_message: true,
      // Use the server monitor you've already created
      wait_ready: true,
      listen_timeout: 45000,
    },
  ],
};
