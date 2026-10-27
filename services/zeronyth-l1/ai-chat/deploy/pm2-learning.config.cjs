// pm2 apps for the chat AI's learning (start with: pm2 start deploy/pm2-learning.config.cjs && pm2 save)
// Both run at the lowest CPU/IO priority, never restart on their own, and exit when done.
const AI = '/workspace/zeronyth-primary/services/zeronyth-l1/ai-chat';
module.exports = { apps: [
  { name: 'zeronyth-ai-learner', script: '/usr/bin/nice', args: `-n 19 ionice -c3 node ${AI}/learner.mjs run`, interpreter: 'none', cwd: AI,
    cron_restart: '*/30 * * * *', autorestart: false, max_memory_restart: '300M', time: true },
  { name: 'zeronyth-ai-finetune', script: '/usr/bin/nice', args: `-n 19 ionice -c3 sh ${AI}/finetune/nightly.sh`, interpreter: 'none', cwd: AI,
    cron_restart: '30 3 * * *', autorestart: false, time: true, env: { ZERONYTH_FT_STEPS: '60' } },
] };
