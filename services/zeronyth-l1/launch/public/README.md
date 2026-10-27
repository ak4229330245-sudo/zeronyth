# Public-launch package (prepared, NOT applied)
- `public-genesis.config.json` — inputs (placeholders `0xREPLACE_*`; builder refuses until replaced)
- `build-public-genesis.mjs` — builds `out/genesis.json` + `manifest.json`; predeploys EmissionPool (30M) and DevVesting (13M) with patched immutables
- `launch-deploy.mjs` — day-0: opsDeployer nonce 0 deploys ZnytEconomy (= EmissionPool.beneficiary), wires and starts the pool
- `gen-server-key.mjs` — new faucet/coordinator hot key in `secrets/` (0600, gitignored, never printed)
- `rehearse.mjs` — isolated box rehearsal (ports 33301-4/11545/11787/11780, throwaway keys) → `rehearsal-result.txt`
- `public.env.example` — gateway + faucet abuse limits
- `fullnode-join.md`, `CHECKLIST.ja.md` — JA ops docs
- Cloudflare tunnel files: `../../deploy/box-primary/cloudflare/`; VPS ufw: `../../deploy/box-primary/vps/ufw-bootnode.sh`
