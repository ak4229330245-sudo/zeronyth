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

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
