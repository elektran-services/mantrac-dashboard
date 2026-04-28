/**
 * PM2 Process Manager Configuration
 * Manages both Next.js server and monitoring service
 * 
 * Usage:
 *   pm2 start ecosystem.config.js          # Start both services
 *   pm2 stop all                           # Stop all services
 *   pm2 restart all                        # Restart all services
 *   pm2 logs                               # View logs from both services
 *   pm2 status                             # Check status
 *   pm2 monit                              # Real-time monitoring
 *   pm2 save                               # Save current process list
 *   pm2 startup                            # Generate startup script (auto-start on boot)
 */

module.exports = {
  apps: [
    {
      name: 'nextjs-server',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      error_file: './logs/nextjs-error.log',
      out_file: './logs/nextjs-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000
    },
    {
      name: 'monitoring-service',
      script: './monitoringService.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'development'
      },
      error_file: './logs/monitoring-error.log',
      out_file: './logs/monitoring-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,
      // Wait for Next.js server to be ready before starting
      wait_ready: true,
      listen_timeout: 30000
    }
  ]
};
