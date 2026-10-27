// Box pm2 app for the 10-day plan access service (box TEST chain at 127.0.0.1:8545; loopback only).
const econ = __dirname + "/..";
module.exports = { apps: [
  { name: "zeronyth-access", script: "/usr/bin/nice", interpreter: "none",
    args: ["-n", "15", "node", econ + "/access/access-service.mjs"], cwd: econ,
    autorestart: true, restart_delay: 5000, max_memory_restart: "250M",
    env: { ACCESS_PORT: "8805", RPC_URL: "http://127.0.0.1:8545", ECON_NETWORK: "box", ACCESS_CHAT_URL: "http://127.0.0.1:9803",
      ACCESS_STATE_DIR: "/workspace/zeronyth-access", ACCESS_VPS_BACKEND: "podman" } },
] };
