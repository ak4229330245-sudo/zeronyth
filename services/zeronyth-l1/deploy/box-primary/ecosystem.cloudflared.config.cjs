// Started by cloudflare/setup.sh after the tunnel exists. Not started before the domain/login.
module.exports = { apps: [
  { name: "zeronyth-cloudflared", script: "/home/box/.local/bin/cloudflared", interpreter: "none",
    args: ["tunnel", "--config", "/workspace/zeronyth-primary/cloudflare/config.yml", "run", "zeronyth"],
    autorestart: true, restart_delay: 5000,
    out_file: "/workspace/zeronyth-primary/generated-artifacts/pm2-logs/cloudflared.out.log",
    error_file: "/workspace/zeronyth-primary/generated-artifacts/pm2-logs/cloudflared.err.log" },
] };
