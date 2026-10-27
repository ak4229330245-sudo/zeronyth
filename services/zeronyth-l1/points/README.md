# ZERONYTH testnet points (テストネット参加ポイント)

Points for testnet participants (node uptime, validator operation, test swaps/LP, check-ins ...).
**Points are for testing only and have no value. Bots/automated farming and other abuse are banned and forfeit points.**
Public pages and the API describe only how points are earned and the rules; they make no statement about future uses. The public Japanese pages are `/points.html` (my points, leaderboard, snapshots),
`/points-rules.html` (rules and live weights) and `/amm.html` (test-token faucet, swap, LP).

## Pieces

| Piece | Where | Runs as |
|---|---|---|
| Points service (indexer, ledger, API) | `points-service.mjs`, loopback `127.0.0.1:9807` | pm2 `zeronyth-points` (`ecosystem.points.config.cjs`) |
| Scoring config (hot-reloaded) | `points.config.json` | — |
| Admin CLI | `points-admin.mjs` | box only |
| Test-token AMM contracts | `amm/ZnytAmm.sol`, `amm/ZnytTokenRouter.sol`, reused `experiments/swap-lab/SwapLab.sol` (SwapLabPair) | chain 9127 |
| Token and pool list (single source of truth) | `amm/tokens.json` | — |
| AMM deployer (idempotent) | `amm/deploy-main-amm.mjs` → `deployments/main-amm.json` | one-shot |
| Price keeper for all z tokens (real ETH/BTC/SOL/BNB/MON USD; zUSDT/zUSDC pegged at 1 USD) | `amm/price-keeper.mjs` → `deployments/main-amm-prices.json` | pm2 `zeronyth-amm-keeper` (`amm/ecosystem.keeper.config.cjs`) |
| Gateway routes | `scripts/replit-gateway.mjs`: `/api/points/{health,rules,leaderboard,me,checkin,snapshots,snapshot,proof}`, buckets `pts` 10/s and `pts-ci` 10/min | in-process in `zeronyth-primary` |

State lives outside git in `ZERONYTH_POINTS_DIR` (default `/workspace/zeronyth-points`): `ledger.jsonl`
(append-only, each entry hash-chained to the previous), `state.json`, `snapshots/`, `admin.token`, `ip.salt`.
Raw client IPs are never stored; only salted hashes are kept.

## Tuning (`points.config.json`)

All weights, daily caps, the anti-sybil limits and the swap/LP/tx formulas are in this file. The service reloads it
when the file (or `deployments/main-amm.json`) changes. No restart is needed.
`loadConfig` refuses a config that breaks the ordering **validator > node > swap+LP+tx combined**. The node must stay
the single biggest earner for non-validators, and the rules page shows the ordering live.

- Swap: `2·min(n,5) + 0.5·max(0,n−5) + 4·√(ZNYT volume)`, capped per day. Anything below `minZnyt` scores 0.
  Reversing a swap on the same pool within `roundTripWindowSec` at ±`roundTripTolerance` scores 0 (anti-wash).
- LP: hourly, `0.5·√(min(start,end) position value in ZNYT)`, summed across pools, minimum position size, daily cap.
- Tx: per successful tx from the wallet. Self-sends, dust transfers, transfers inside the same IP cluster and system
  contracts score 0.
- Everything is valued in ZNYT using `testPriceZnyt` from `amm/tokens.json` (1 ZNYT = `znytUsdTest` test-USD).
  Tokens with a `priceSource` (all z tokens) use the keeper's live price when it is less than 1 h old.
- Faucet-only wallets get the `faucetOnlyFactor` weight until they are established.

## Adding a test token or pool

1. Add the token (symbol, name, decimals, claimPerDay, testPriceZnyt or priceSource) and its pools to
   `amm/tokens.json`. Use `"auto"` for one seed side to value-match it.
2. Build and deploy from the primary copy:
   `node amm/compile.mjs && ZERONYTH_AMM_KEEPER=<keeper address> node amm/deploy-main-amm.mjs`.
   Only missing tokens and pools are deployed. Native pools (ZNYT/zX) use ZnytAmmRouter; token pools (zX/zY) use
   ZnytTokenRouter.
3. The points service and `/amm.html` pick the new pools up from the manifest automatically.

Note: the first token/token pools used `SwapLabRouter`, whose `swapExactInput` asks the pair for the input token as
output, so every token→token swap reverted. Those pools were retired (seeds withdrawn, see `retired[]` in the
manifest) and redeployed with `ZnytTokenRouter`, which fixes only that line.

## Price keeper

Every `keeper.intervalSec` (600 s) the keeper fetches the USD price (CoinGecko, falling back to Binance) for each
token with a `priceSource`. It writes `deployments/main-amm-prices.json`. If a tracked pool is off by more than
`deadbandPct`, it makes one bounded corrective swap from its own wallet (at most `maxSwapPctOfReserve` of the
reserve and 90% of its inventory). It also claims zUSDC from the faucet daily.
Use `node amm/price-keeper.mjs --once [--dry-run]` for a single tick. Stop the pm2 process first, so the two runs do
not race on nonces. The key is at `ZERONYTH_AMM_KEEPER_KEY` (default `~/.zeronyth-secrets/amm-keeper-key.json`,
0600) and is never printed or committed.

## Admin CLI

```
node points-admin.mjs grant <address> <points> "<reason>"   # logged in the ledger with the reason
node points-admin.mjs ban|unban|zero|hold|clear <address> "<reason>"
node points-admin.mjs flags | status | verify | wallet <address>
node points-admin.mjs snapshot [YYYY-MM-DD]                  # today = partial snapshot, root published on chain
node points-admin.mjs fund-publisher [ZNYT=2]
```

## Hooks

- AI accepted-feedback (stub): append `{"itemId","address","acceptedAt"}` lines to `ZERONYTH_POINTS_AI_ACCEPTED_FILE`
  (default `<DIR>/ai-accepted.jsonl`). Each itemId earns `aiFeedback` once.
- Gateway anti-sybil hook: on faucet claims and economy provider calls, the gateway makes a fire-and-forget
  `POST /internal/seen {address, ip, src}` (at most once per address+IP per hour). New wallets beyond the per-IP limit
  are put on hold.
- Login reuses the access service's wallet-signature session (`/api/access/auth/challenge` → `personal_sign` →
  `/auth/verify`). Keys are never requested.

### Real-price tracking (all z tokens)
- `tokens.json` `priceSource`: `{coingecko, binance}` (zETH, zBTC, zSOL, zBNB), `{coingecko, coinbase}` (zMON; no Binance MON market), or `{fixedUsd: 1}` (zUSDT, zUSDC peg).
  ZNYT has no market price and stays at the labeled test rate `znytUsdTest` (1 ZNYT = 10 test-USD; was 100 until 2026-10-27).
- The keeper fetches all CoinGecko prices in one call per tick, falls back per token to Binance/Coinbase, and skips only the pools of a token whose price is unavailable.
- Bounds per pool per tick: deadband 1.5 %, swap ≤ 10 % of the input-side reserve, ≤ 90 % of keeper inventory, keep ≥ 1 ZNYT.
- Inventory: the keeper claims every token's public faucet once per 24 h (same cap as anyone) plus `keeperInventory` minted at token deploy.
  Corrections that make a token cheaper only need that token; making a token dearer vs ZNYT needs keeper ZNYT.


## Anti-bot (BAN)

Rule (shown on points-rules.html): ボットや自動スクリプトで取引を繰り返してポイントを稼ぐ行為は BAN 対象。ポイントは没収。異議は管理者へ。

- Detection is score-based and explainable (`antiBot` in points.config.json, hot-reloaded). Per wallet, over `windowSec`
  (since the last unban): tx frequency (per hour / per day), machine-regular intervals (CV of the last N tx gaps),
  near-identical small sizes (tx or swap), ping-pong swaps, LP add→remove cycles, and cluster signals (same first funder,
  same IP hash, linked wallet already suspended). Cluster signals alone never suspend.
- Score ≥ `suspendScore` → ledger `suspend` entry (hash-chained, with signals + linked wallets): accrual stops, hidden from
  the leaderboard, excluded from snapshots, status `BAN（審査中）`. Score ≥ `flagScore` → one `flag` entry per day.
- Team / system / deployer / keeper addresses are never scored.
- Admin (loopback only):
  - `node points-admin.mjs bot-flags`: thresholds, suspended, banned, flags, top live scores
  - `node points-admin.mjs bot-score <addr>`: score, signals, linked wallets, recent events
  - `node points-admin.mjs confirm-ban <addr> [--cluster] "<reason>"`: permanent ban, forfeits all points, excluded from
    snapshots; `--cluster` also bans linked wallets (role addresses skipped)
  - `node points-admin.mjs unban <addr> "<reason>"`: lifts suspension/ban (forfeited points are not restored); scoring restarts from now
