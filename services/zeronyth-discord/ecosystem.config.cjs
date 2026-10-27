const home = '/home/solbot/zeronyth-discord';
module.exports = { apps: [{
  name: 'zeronyth-discord', script: home + '/bot.mjs', cwd: home, interpreter: 'node',
  node_args: '--env-file=' + home + '/.env --max-old-space-size=96',
  max_memory_restart: '150M', autorestart: true, restart_delay: 10000, max_restarts: 1000,
  out_file: home + '/logs/out.log', error_file: home + '/logs/err.log', time: true,
  env: { NODE_ENV: 'production' },
}] };
