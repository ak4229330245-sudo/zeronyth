#!/bin/bash
# Run AFTER `~/.local/bin/cloudflared tunnel login` has been completed by the domain owner (writes ~/.cloudflared/cert.pem).
# Usage: ./setup.sh zeronyth.example.com
set -eu
D=${1:?domain}; CF=$HOME/.local/bin/cloudflared; DIR=$(cd "$(dirname "$0")" && pwd)
[ -f "$HOME/.cloudflared/cert.pem" ] || { echo "Run: $CF tunnel login  (needs the Cloudflare account owner)"; exit 1; }
$CF tunnel list | grep -q ' zeronyth ' || $CF tunnel create zeronyth
ID=$($CF tunnel list | awk '$2=="zeronyth"{print $1}')
sed -e "s/<TUNNEL_ID>/$ID/g" -e "s/<DOMAIN>/$D/g" "$DIR/config.yml.template" > "$DIR/config.yml"
$CF tunnel --config "$DIR/config.yml" ingress validate
$CF tunnel route dns zeronyth "$D"
export PATH=$HOME/.local/bin:$PATH
pm2 start "$DIR/../ecosystem.cloudflared.config.cjs" && pm2 save
echo "Published https://$D/  -> 127.0.0.1:22780"
