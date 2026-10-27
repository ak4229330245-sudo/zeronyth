# ZERONYTH Local Testnet

Runs the uploaded ZERONYTH L1 kit as a private, four-validator Besu development chain with its original explorer and faucet.

## Run & Operate

- Start `artifacts/zeronyth: web` for the live explorer at `/`.
- Read `services/zeronyth-l1/REPLIT.md` for native runtime setup, liveness checks and data-safety boundaries.
- Public deployment is not configured. Do not publish the example faucet key or expose raw validator RPC.

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

- `services/zeronyth-l1/` — imported starter-kit source; its `dashboard/` is the live UI.
- `services/zeronyth-l1/scripts/start-replit.mjs` — native process lifecycle and fail-closed startup.
- `artifacts/zeronyth/` — managed preview registration and launch scripts, not the UI source.
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
