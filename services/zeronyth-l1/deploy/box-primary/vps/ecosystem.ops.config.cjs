// VPS ops apps (pm2 default daemon ~/.pm2, user solbot). Separate from ~/zeronyth/ecosystem.zeronyth.config.cjs.
module.exports = { apps: [
  { name: "zeronyth-v4-watchdog", script: "/home/solbot/zeronyth-ops/vps-chain-watchdog.py", interpreter: "/usr/bin/python3",
    autorestart: true, restart_delay: 5000, max_memory_restart: "60M",
    out_file: "/home/solbot/zeronyth-ops/logs/watchdog.out.log", error_file: "/home/solbot/zeronyth-ops/logs/watchdog.err.log",
    env: { TZ: "Asia/Tokyo", TARGET_APP: "zeronyth-testnet",
      LOCAL_RPCS: "node2=http://127.0.0.1:8545,node3=http://127.0.0.1:8647,node4=http://127.0.0.1:8648", REF_RPCS: "box=http://127.0.0.1:22781/rpc",
      LOCAL_QUORUM: "1", STALL_SEC: "120", QUORUM_STALL_SEC: "180", MIN_GAP_SEC: "300", MAX_GAP_SEC: "3600" } },
  // Standby ML-DSA-65 PQ finality signer on the VPS (same seeds as box node-data; code identical).
  // Keeps certifying blocks while the box is paused. Local only (127.0.0.1:9799); public /api/pq stays on box.
  { name: "zeronyth-pq-finality-vps", script: "scripts/pq-finality.mjs", cwd: "/home/solbot/zeronyth/services/zeronyth-l1",
    interpreter: "node", node_args: "--max-old-space-size=64", autorestart: true, restart_delay: 5000, max_memory_restart: "160M",
    out_file: "/home/solbot/zeronyth-ops/logs/pq-vps.out.log", error_file: "/home/solbot/zeronyth-ops/logs/pq-vps.err.log",
    env: { TZ: "Asia/Tokyo", RPC_URL: "http://127.0.0.1:8545/", PORT: "9799", LISTEN_HOST: "127.0.0.1", PQ_VALIDATORS: "4" } },
  // Edge for cloudflared: pass-through to the box gateway/scan via the reverse tunnel; local fallback when the box
  // is paused (synced static site, /rpc -> VPS validators with gateway policy, /api/pq -> 9799, maintenance notice).
  { name: "zeronyth-edge", script: "/home/solbot/zeronyth-ops/zeronyth-edge.mjs", interpreter: "node",
    node_args: "--max-old-space-size=48", autorestart: true, restart_delay: 2000, max_memory_restart: "128M",
    out_file: "/home/solbot/zeronyth-ops/logs/edge.out.log", error_file: "/home/solbot/zeronyth-ops/logs/edge.err.log",
    env: { TZ: "Asia/Tokyo", EDGE_MAIN_PORT: "22790", EDGE_SCAN_PORT: "22791", ZERONYTH_RPC_RPS: "30", ZERONYTH_RPC_TX_PER_MIN: "30" } },
] };
