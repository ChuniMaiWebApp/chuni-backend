// =============================================================================
// PM2 process definition for the API.
//
//   pm2 start ecosystem.config.js        # first time
//   pm2 startOrReload ecosystem.config.js --update-env
//   pm2 save                             # persist across reboots
//
// One repo, one process. Single instance on purpose: cluster mode would run
// the daily song refresh cron in every worker, and while the Redis lock in
// song-data.scheduler.ts keeps that correct, the CHUNITHM-NET rate limiter is
// global to the *instance*, not to the machine. N workers would mean N token
// buckets pointed at SEGA — which is how a server IP gets banned.
// =============================================================================

const { join } = require('node:path');

module.exports = {
  apps: [
    {
      name: 'chuni-backend',
      // Absolute: `pm2 reload` can be invoked from anywhere, and a relative cwd
      // that resolves differently is how the API ends up unable to find .env.
      cwd: __dirname,
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      // The API holds serialised CHUNITHM-NET requests; give an in-flight one
      // a chance to finish before SIGKILL.
      kill_timeout: 10000,
      listen_timeout: 20000,
      exp_backoff_restart_delay: 200,
      time: true,
      merge_logs: true,
      error_file: join(__dirname, 'logs', 'error.log'),
      out_file: join(__dirname, 'logs', 'out.log'),
      // Everything else comes from .env, which ConfigModule reads. Duplicating
      // secrets here would put them in `pm2 describe` output.
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
