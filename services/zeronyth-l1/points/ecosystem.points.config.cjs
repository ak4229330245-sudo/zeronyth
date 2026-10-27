// pm2 start services/zeronyth-l1/points/ecosystem.points.config.cjs   (run from the primary copy)
const path = require('path');
module.exports = { apps: [{ name: 'zeronyth-points', cwd: __dirname, script: path.join(__dirname, 'points-service.mjs'), node_args: '--max-old-space-size=256',
  env: { ZERONYTH_POINTS_PORT: '9807', ZERONYTH_POINTS_DIR: '/workspace/zeronyth-points', ZERONYTH_POINTS_CONFIG: path.join(__dirname, 'points.config.json') },
  max_memory_restart: '300M', time: true }] };
