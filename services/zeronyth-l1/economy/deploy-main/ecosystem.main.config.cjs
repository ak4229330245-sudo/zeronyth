// MAIN public testnet (chain 9127, box primary RPC 127.0.0.1:9545) economy services, loopback only.
// Runs from the box primary copy (/workspace/zeronyth-primary, exported from committed code), not from the repo work tree.
//   zeronyth-econ-main   coordinator  127.0.0.1:9801  -> gateway /api/econ/*   (VPS tunnel 8801 -> box 9801)
//   zeronyth-access-main plans/access 127.0.0.1:9805  -> gateway /api/access/* + /plans.html
// Addresses: economy/deployments/main.json. Role keys: economy/.secrets/main-keys.json (0600, never in git).
const home = "/workspace/zeronyth-primary";
const econ = home + "/services/zeronyth-l1/economy";
const common = { ECON_NETWORK: "main", RPC_URL: "http://127.0.0.1:9545", ECON_GAS_PRICE_WEI: "1000000000", ECON_CONTRACT: "ZnytEconomy",
  DEBUG_RPC_URL: "http://127.0.0.1:9545" };  // primary exposes no debug API: supply proof is reported as unavailable, never from another chain
module.exports = { apps: [
  { name: "zeronyth-econ-main", script: "/usr/bin/nice", interpreter: "none",
    args: ["-n", "12", "node", econ + "/coordinator.mjs"], cwd: econ,
    autorestart: true, restart_delay: 5000, max_memory_restart: "300M",
    out_file: home + "/generated-artifacts/pm2-logs/econ-main.out.log", error_file: home + "/generated-artifacts/pm2-logs/econ-main.err.log",
    env: { ...common, ECON_PORT: "9801", ECON_HOST: "127.0.0.1", ECON_EPOCH_MS: "300000", ECON_LOCAL_THREADS: "1" } },
  { name: "zeronyth-access-main", script: "/usr/bin/nice", interpreter: "none",
    args: ["-n", "15", "node", econ + "/access/access-service.mjs"], cwd: econ,
    autorestart: true, restart_delay: 5000, max_memory_restart: "250M",
    out_file: home + "/generated-artifacts/pm2-logs/access-main.out.log", error_file: home + "/generated-artifacts/pm2-logs/access-main.err.log",
    env: { ...common, ACCESS_PORT: "9805", ACCESS_CHAT_URL: "http://127.0.0.1:9803", ACCESS_STATE_DIR: "/workspace/zeronyth-access-main",
      ACCESS_VPS_BACKEND: "podman", ACCESS_PODMAN: home + "/scripts/podman-main.sh", ACCESS_MAX_VPS: "3" } },
] };
