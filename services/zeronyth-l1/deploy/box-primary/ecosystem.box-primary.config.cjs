// 2026-10-27 20:05 JST: box runs ONLY validator 1; validators 2,3,4 run on the VPS (VPS holds quorum while the box is paused).
// NEVER set ZERONYTH_NODES back to include 2/3 here while the VPS runs them (double-signing).
// ZERONYTH PRIMARY chain (migrated from VPS YOUR_VPS_IP on 2026-10-27, history + validator keys preserved).
// Runs on the shared box under pm2, niced, all ports loopback-only. Box test chains use 8545/3030x/22673/8801 — no overlap.
const home = "/workspace/zeronyth-primary";
const nice = ["-n", "10"];
module.exports = { apps: [
  { name: "zeronyth-primary", script: "/usr/bin/nice", interpreter: "none",
    args: [...nice, "node", home + "/services/zeronyth-l1/scripts/start-replit.mjs"],
    cwd: home + "/artifacts/zeronyth", autorestart: true, restart_delay: 15000, kill_timeout: 20000, max_restarts: 20,
    out_file: home + "/generated-artifacts/pm2-logs/primary.out.log", error_file: home + "/generated-artifacts/pm2-logs/primary.err.log",
    env: { PORT: "22780", ZERONYTH_LISTEN_HOST: "127.0.0.1",
      ZERONYTH_RPC_PORT: "9545", ZERONYTH_P2P_BASE: "31302", ZERONYTH_ADMIN_BASE: "9644",
      ZERONYTH_FAUCET_PORT: "9797", ZERONYTH_SIGNAL_PORT: "9798", ZERONYTH_PQ_PORT: "9799", ZERONYTH_ECON_PORT: "9801", ZERONYTH_AI_CHAT_PORT: "9803",
      ZERONYTH_TRUST_CF: "1", ZERONYTH_RPC_RPS: "30", ZERONYTH_READ_CACHE_MS: "500",
      ZERONYTH_SWAPLAB: "0", ZERONYTH_NODES: "1", ZERONYTH_MIN_PEERS: "1", ZERONYTH_REQUIRE_LIVE: "0",
      ZERONYTH_JAVA_OPTS: "-Xms64m -Xmx512m -XX:MaxMetaspaceSize=192m -XX:ReservedCodeCacheSize=64m -XX:MaxDirectMemorySize=64m -XX:+UseSerialGC -Xss512k -XX:ActiveProcessorCount=2" } },
  { name: "zeronyth-primary-api", script: "/usr/bin/nice", interpreter: "none",
    args: [...nice, "node", "--enable-source-maps", home + "/artifacts/api-server/dist/index.mjs"],
    cwd: home + "/artifacts/api-server", autorestart: true,
    out_file: home + "/generated-artifacts/pm2-logs/primary-api.out.log", error_file: home + "/generated-artifacts/pm2-logs/primary-api.err.log",
    env: { PORT: "5100", HOST: "127.0.0.1", NODE_ENV: "production" } },
  // Chat AI (item 5): loopback 9803 -> Ollama 127.0.0.1:11434 (pm2 app zeronyth-ai-ollama, nice 19). VPS reaches it via tunnel 8803.
  { name: "zeronyth-ai-chat", script: "/usr/bin/nice", interpreter: "none",
    args: ["-n", "15", "node", home + "/services/zeronyth-l1/ai-chat/chat-server.mjs"], cwd: home + "/services/zeronyth-l1/ai-chat",
    autorestart: true, restart_delay: 5000, max_memory_restart: "300M",
    out_file: home + "/generated-artifacts/pm2-logs/ai-chat.out.log", error_file: home + "/generated-artifacts/pm2-logs/ai-chat.err.log",
    env: { ZERONYTH_AI_CHAT_PORT: "9803", OLLAMA_URL: "http://127.0.0.1:11434", ZERONYTH_AI_MODEL: "znyt-chat", ZERONYTH_AI_TIER_KEY_FILE: "/workspace/zeronyth-access/tier.key" } },
  // Persistent box<->VPS P2P link for validator 4 (on the VPS). Same port numbers on both ends:
  // box 127.0.0.1:31304-31306 -> VPS node2-4; VPS 127.0.0.1:31303 -> box node1. No inbound firewall change on the VPS.
  { name: "zeronyth-p2p-tunnel", script: home + "/scripts/p2p-tunnel.sh", interpreter: "/bin/bash",
    autorestart: true, restart_delay: 2000, min_uptime: 1000, max_restarts: 1000000,
    env: { ZT_LOCAL_PORTS: "31304 31305 31306", ZT_REMOTE_VALIDATOR_PORTS: "31303" },
    out_file: home + "/generated-artifacts/pm2-logs/tunnel.out.log", error_file: home + "/generated-artifacts/pm2-logs/tunnel.err.log" },
  // Box-side V1 watchdog: restarts zeronyth-primary (pm2 restart, no --update-env) only if V1 is stuck >180 s while the
  // VPS validators (reference via tunnel 18545) are ahead. Rate limit 1/5 min, doubling backoff; grace after VM resume.
  { name: "zeronyth-v1-watchdog", script: home + "/scripts/chain-watchdog.py", interpreter: "/usr/bin/python3",
    autorestart: true, restart_delay: 5000, max_memory_restart: "60M",
    out_file: home + "/generated-artifacts/pm2-logs/v1-watchdog.out.log", error_file: home + "/generated-artifacts/pm2-logs/v1-watchdog.err.log",
    env: { TZ: "Asia/Tokyo", TARGET_APP: "zeronyth-primary", LOCAL_RPCS: "node1=http://127.0.0.1:9545", REF_RPCS: "vps=http://127.0.0.1:18545",
      LOCAL_QUORUM: "0", STALL_SEC: "180", MIN_GAP_SEC: "300", MAX_GAP_SEC: "3600", GRACE_SEC: "120",
      PM2_BIN: "/home/box/.local/bin/pm2", PM2_HOME: "/home/box/.pm2", PM2_PATH: "/home/box/.local/bin:/usr/local/bin:/usr/bin:/bin",
      ACTION_LOG: home + "/generated-artifacts/pm2-logs/v1-watchdog-actions.jsonl" } },
] };
