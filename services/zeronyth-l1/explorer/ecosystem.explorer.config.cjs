// pm2: ZERONYTH Scan (standalone read-only explorer). Public via the VPS Cloudflare tunnel -> ssh -R 22815 -> 127.0.0.1:9815.
// The process lowers its own CPU priority (nice 19); SQLite data lives outside the repo.
module.exports = {
  apps: [{
    name: 'zeronyth-explorer',
    cwd: __dirname,
    script: 'explorer-service.mjs',
    node_args: '--max-old-space-size=160',
    env: {
      EXPLORER_PORT: '9815', EXPLORER_HOST: '127.0.0.1', EXPLORER_RPC: 'http://127.0.0.1:9545',
      EXPLORER_DATA: '/workspace/zeronyth-explorer', EXPLORER_BRIDGE_API: 'http://127.0.0.1:9811/api/bridge/transfers',
      EXPLORER_PUBLIC_ORIGIN: 'https://scan.zeronyth.dpdns.org', EXPLORER_REDIRECT_HOSTS: 'zeronyth.dpdns.org',
    },
    max_memory_restart: '250M',
    kill_timeout: 5000,
    time: true,
  }],
};
