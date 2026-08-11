module.exports = {
  apps: [
    {
      // 名称与部署脚本（deploy.sh）中的 pm2 delete/logs 命令保持一致
      name: "kec-server",
      script: "src/server.js",
      cwd: "./server",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      // 使用 pm2- 前缀，避免与 winston 写入的 server/logs/error.log 互相覆盖
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
