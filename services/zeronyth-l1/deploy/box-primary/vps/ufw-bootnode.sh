#!/bin/bash
# PREPARED, NOT APPLIED. Makes the VPS a public ZERONYTH bootnode later. Needs the owner's sudo password.
# Review first:  sudo ufw status numbered
# Effect: allow P2P 30303 tcp+udp from anywhere; nothing else changes (8545/5000/8797-8801 stay loopback-only).
set -eu
sudo ufw allow 30303/tcp comment 'zeronyth p2p'
sudo ufw allow 30303/udp comment 'zeronyth discovery'
sudo ufw status verbose
# Then expose node4's P2P publicly (currently loopback 31306 via the box tunnel) — edit ecosystem.zeronyth.config.cjs:
#   add a public listener: a full (non-validator) node on 0.0.0.0:30303 with --p2p-host=YOUR_VPS_IP, or
#   run validator4 with --p2p-interface=0.0.0.0 --p2p-port=30303 --p2p-host=YOUR_VPS_IP (keep the box tunnel peers).
# Public bootnode enode: enode://<node pubkey>@YOUR_VPS_IP:30303   (pubkey = node-data/nodeN/key.pub, safe to share)
# Rollback: sudo ufw delete allow 30303/tcp && sudo ufw delete allow 30303/udp
