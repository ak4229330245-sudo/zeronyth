// ZERONYTH on the VPS: since 2026-10-27 20:05 JST runs validators 2, 3 and 4 of the 4-validator QBFT chain (same chain, no
// reset) so the always-on VPS alone holds quorum (3/4) while the box sleeps. Validator 1 stays on the box (primary).
// Box tunnel: box 127.0.0.1:31304-31306 -> VPS node2-4; VPS 127.0.0.1:31303 -> box node1; VPS 8797/8798/8799/8801/8803 -> box services.
// RPC: node2 127.0.0.1:8545 (explorer http://YOUR_TAILSCALE_IP:22673/), node3 :8647, node4 :8648 (loopback, ZERONYTH_ADMIN_RPC=1).
// 2026-10-27 20:05 JST: validators 2,3,4 run HERE (VPS alone holds QBFT quorum 3/4); the box runs ONLY validator 1.
// NEVER run a validator on both machines. Box side: ZERONYTH_NODES "1" in /workspace/zeronyth-primary/ecosystem.box-primary.config.cjs.
const home = "/home/solbot/zeronyth";
module.exports = { apps: [
  { name: "zeronyth-testnet", script: home + "/services/zeronyth-l1/scripts/start-replit.mjs",
    cwd: home + "/artifacts/zeronyth", interpreter: "node", autorestart: true, restart_delay: 15000,
    kill_timeout: 20000, max_restarts: 1000,
    out_file: home + "/generated-artifacts/pm2-logs/testnet.out.log", error_file: home + "/generated-artifacts/pm2-logs/testnet.err.log",
    env: { PORT: "22673", ZERONYTH_READ_CACHE_MS: "500", ZERONYTH_TIP_FLOOR_WEI: "1000000000", ZERONYTH_LISTEN_HOST: "YOUR_TAILSCALE_IP", ZERONYTH_FAUCET_PORT: "8797", ZERONYTH_SIGNAL_PORT: "8798",
      ZERONYTH_NODES: "2,3,4", ZERONYTH_ADMIN_RPC: "1", ZERONYTH_P2P_BASE: "31302", ZERONYTH_MIN_PEERS: "1", ZERONYTH_REQUIRE_LIVE: "0",
      ZERONYTH_FAUCET: "0", ZERONYTH_SIGNAL: "0", ZERONYTH_PQ_FINALITY: "0", ZERONYTH_SWAPLAB: "0",
      ZERONYTH_JAVA_OPTS: "-Xms64m -Xmx256m -XX:MaxMetaspaceSize=160m -XX:ReservedCodeCacheSize=64m -XX:MaxDirectMemorySize=64m -XX:+UseSerialGC -Xss512k -XX:ActiveProcessorCount=2" } },
  { name: "zeronyth-api", script: home + "/artifacts/api-server/dist/index.mjs", cwd: home + "/artifacts/api-server",
    interpreter: "node", node_args: "--enable-source-maps", autorestart: true,
    out_file: home + "/generated-artifacts/pm2-logs/api.out.log", error_file: home + "/generated-artifacts/pm2-logs/api.err.log",
    env: { PORT: "5000", HOST: "127.0.0.1", NODE_ENV: "production" } },
] };
