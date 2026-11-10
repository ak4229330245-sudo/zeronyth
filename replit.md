# ZERONYTH — chain 912701 public repository

This repository publishes the network parameters, documentation, and whitepaper for the live
ZERONYTH network (chain ID 912701). The node software is in
[zeronyth-falcon-node](https://github.com/ak4229330245-sudo/zeronyth-falcon-node);
network services (site, gateway, faucet) run from the operator's deployment, not from this repo.
The retired chain-9127 codebase was removed from this repository in November 2026.

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `WHITEPAPER.md` — design and verification evidence for chain 912701.
- `network/` — current network parameters (chain 912701).
- `services/zeronyth-discord/` — Discord bot.
- `generated-artifacts/` — ignored downloads and runtime logs; never commit or deploy.

## Architecture decisions

- Chain 912701 is the **production** network (Falcon-1024 QBFT, ML-DSA-65 finality); chain 9127 is retired and its codebase was removed — do not reintroduce it.
- This repository is the public record (whitepaper, network parameters, engineering docs, published service source). Live services run from the operator's deployment, not from this tree.
- PQ transaction types are Besu-level extensions (`0x7E` Falcon-1024, `0x7F` ML-DSA-65, `0x7D` ZK); the reconstructed production source lives in `besu-912701/`.

## Product

The public documentation and verification surface for ZERONYTH: the whitepaper, wallet-ready network parameters (`network/`), the engineering record (`docs/`), the AI VPS market source (`ai-vps-market/`), and the Discord bot (`services/zeronyth-discord/`). The chain, explorer, and wallet are served at zeronyth.dpdns.org.

## User preferences

- Never commit secrets (keys, tokens, seed phrases) — see `.gitleaks.toml`.
- ZNYT has no monetary value; keep that wording intact wherever it appears.
- Chain 912701 must never be described as a testnet.

## Gotchas

- The GitHub repo description/topics still say "testnet" (owner-only setting; cannot be changed from this workspace).
- Engineering docs written before 2026-11-05 may describe pre-deployment plans — check for dated completion banners before treating a plan as still pending.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
