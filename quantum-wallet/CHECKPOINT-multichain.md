# CHECKPOINT — Quantum Wallet multi-chain build (v12) — PAUSED

Written 2026-11-05 ~22:00 JST on the owner's stop order (zk-STARK workstream
takes priority; this build is paused until further notice). This file is the
resume point. Everything below describes the state **at the moment of the
stop**, including where the evidence is weaker than interim reports suggested.
The working tree in this directory is the truth; nothing here was committed
locally (local git HEAD is still `bd0000d`, the Phase-2 commit) and nothing
was pushed.

Scope that was in flight (owner approvals 2026-11-05 21:38 / 21:39 / 21:41 /
21:44 JST): (a) EVM multi-chain network support (ZERONYTH + Base Sepolia,
Ethereum Sepolia, Arbitrum Sepolia, Robinhood Testnet, Arc Testnet) with
wZNYT on the four bridge remotes; (b) non-EVM engines for SOL / BTC / XRP /
SUI / APT; (c) security-hardening pass (idle auto-lock, unlock backoff,
clipboard hygiene, send-safety review, custom-RPC caution, backup-password
≥12, build-version transparency, secret-retention minimization, SECURITY.md);
(d) in-wallet swap (ZERONYTH AMM; Solana/Jupiter verify-gated).

---

## 1. What is implemented (code on disk)

### Core — written by the lead agent, syntax-checked, NOT yet exercised by the full suite
- `src/core/enc.mjs` (NEW) — base58 / base58check (incl. XRP alphabet),
  bech32 BIP-173 encode/decode/segwit, `ecdsaDerEncode`. Bech32 verified
  against the BIP-173 text itself (testnet P2WPKH example
  `tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx` is reproduced exactly).
- `src/core/crypto.mjs` (EXTENDED) — SCHEMES gains `solana`, `bitcoin`,
  `xrp`, `sui`, `aptos` (32-byte secrets each); `EVM_SCHEMES`,
  `CHAIN_FAMILIES`, `isEvmScheme`, `isChainFamily`; `publicKeyFromSecret`,
  `hash160`, per-family `addressFromPublicKey` (solana base58; bitcoin
  bech32 bc1; xrp base58check XRP alphabet; sui blake2b-256(0x00‖pub);
  aptos sha3-256(pub‖0x00)).
- `src/core/hd.mjs` (EXTENDED) — KDF domains added: `…/SOLANA`, `…/SUI`,
  `…/APTOS`, `…/XRP`, `…/BTC` under `ZERONYTH/WALLET/V2/`, same construction
  + account index as the existing three domains.
- `src/core/tx.mjs` (EDITED) — `signTransaction` throws "Not an EVM scheme"
  for chain-family schemes. `src/core/gas.mjs` (EDITED) — `check()` uses
  `isEvmScheme`. `src/core/amount.mjs` (EDITED) — generic
  `parseAmount`/`formatAmount(text, decimals)` added; ZNYT wrappers unchanged.
- `src/core/networks.mjs` (NEW) — registry of 16 networks: `zeronyth`
  (912701, all 3 schemes, faucet), `base-sepolia` 84532,
  `ethereum-sepolia` 11155111, `arbitrum-sepolia` 421614
  (corsProxy `/remote-rpc/421614`), `robinhood-testnet` 46630,
  `arc-testnet` 5042002 (USDC, 18 dp); `solana-mainnet`/`solana-devnet`,
  `bitcoin-mainnet`/`bitcoin-testnet`, `xrp-mainnet` (corsProxy
  `/remote-rpc/xrp-mainnet`) / `xrp-testnet` (corsProxy
  `/remote-rpc/xrp-testnet`), `sui-mainnet`/`sui-testnet`,
  `aptos-mainnet`/`aptos-testnet`. wZNYT `0xe2c03e92e5850375aE5c563CbB2C1Fdc99A3E8e2`
  registered on the four bridge remotes only (not Arc). Helpers: getNetwork,
  findNetwork, networkPersistKey, schemeAllowedOn, explorerTxUrlFor,
  erc20 calldata builders.
- `src/core/swap.mjs` (NEW) — faithful port of `~/workspace/amm-pq/amm-pq.mjs`:
  selectors, constant-product quote with 0.3% fee
  (`out = a·997·rOut / (rIn·1000 + a·997)`), slippage min-out (default
  100 bps), reserve fetching with token0-order resolution, approve/swap call
  builders for ZnytAmmRouter paths.

### Session / hardening — written by the lead agent, NOT yet UI-wired, NOT yet test-covered as a suite
- `src/app/session.mjs` (FULLY REWRITTEN; the v11 ZERONYTH path preserved) —
  network state persisted at `zeronyth.qwallet.network`; per-network RPC
  overrides at `zeronyth.qwallet.rpcByChain` (legacy `zeronyth.qwallet.rpc`
  still honoured as the 912701 entry); unlock backoff (persisted counter
  `zeronyth.qwallet.unlockFails`, delays 0 below 3 fails then 5·2^(n−3) s
  capped 300 s, error "Too many attempts — wait Ns"); sent-address history
  (`zeronyth.qwallet.sentTo`, addresses only, cap 500, `isFirstSendTo` /
  `recordSentTo`); `prepareSend` dispatch: ZERONYTH = original logic +
  defensive contract-recipient detection via `getCode`; remote EVM =
  eth_chainId verified FIRST (mismatch throws), estimateGas +20%,
  eth_gasPrice, native or wZNYT token sends; chain families = engine plan
  passthrough; `assertSchemeOperable` throws "PQ accounts can only send on
  the ZERONYTH network" off-912701; `executeSend` (chain path zeroes the
  exported secret copy after signing); per-kind `pollReceipt` /
  `refreshBalances` (+ wZNYT balances on remotes); faucet throws off-ZERONYTH;
  swap session API (`getSwapManifest` via `/api/points/rules` → `.amm`,
  `quoteSwap`, `prepareSwap`, `executeSwap` re-preparing each step fresh and
  polling to success).
- `src/app/idle.mjs` (NEW) — IdleTracker decision machine (activity /
  hidden>60 s / visible / shouldLock), prefs `zeronyth.qwallet.autolock`
  (default on) and `…autolockMin` (1/5/15, default 5),
  `createIdleLockController` wiring helper. Unit-testable, not yet wired
  into the UI.
- `src/app/clipboard.mjs` (NEW) — `scheduleClipboardClear`: clears after
  30 s only if the clipboard still equals exactly the copied text.
- `src/i18n.mjs` (EXTENDED) — ~40 new keys × ja/en/zh-CN/ko appended
  (networkSelect, testnetSuffix, connectedGeneric, zeronythOnly,
  pqOnlyOnZeronyth, chainIdMismatch, per-chain add-account notes,
  phraseRestoresAll, destTag, swap vocabulary, firstSendWarn/firstSendAck,
  contractWarn, tooManyAttempts, rpcCaution, autoLock*, buildVersion,
  backupPwNote/backupPwShort, feeEstimate, router, pair, …).

### Non-EVM engines — written by child subagents to the shared interface
`deriveAddress / validateAddress / create*Client(apiBase, {fetchImpl}) →
{ checkConnection, getBalance→bigint, prepareSend→plan, executeSend→{hash},
getTxStatus }`. Files: `src/core/chains/{solana,bitcoin,xrp,sui,aptos}.mjs`,
tests `test/chains-{solana,bitcoin,xrp,sui,aptos}.test.mjs`, live scripts +
outputs `evidence/multichain/{chain}-live.mjs` / `…-live-output.json`.
Per-chain status is in §2/§3 — read it before trusting any engine.

### NOT started / not done
- **UI rework (`src/ui/app.mjs`, `index.html`)**: NOT begun. app.mjs on disk
  is still the v11 UI (hardcoded 912701 rendering); only re-read for
  planning. No network selector, no swap screen, no review-screen upgrades,
  no settings additions, no idle/clipboard wiring in the UI. index.html
  untouched by this task (its `M` in git status predates the task).
- `src/build-info.mjs` + build.mjs version baking: NOT created (build.mjs
  unmodified by this task; its `M` status also predates the task).
- `SECURITY.md`: NOT written.
- New tests for session/multichain/hardening/swap: NOT written (only the
  five `chains-*.test.mjs` from the engine children exist).
- `package.json` test script: NOT updated — still lists only the original
  five files (vault, tx, ui, recovery, e2e.chain). The chains-*.test.mjs
  files are not yet part of `npm test`.
- `test/smoke.mjs`: NOT updated for v12/new modules.
- Gateway/CSP/proxy work: NOT done (see §4). Jupiter (Solana swap): probed
  only, no code, no ship decision (see §3).

---

## 2. Test status at the stop moment

- **Baseline suite (`npm test`, the original 5 files): 75/75 PASS** —
  confirmed by a full run that completed during this task (145 s, exit 0).
  This run predates some session.mjs surgery landing in the tree, so on
  resume the suite MUST be re-run before anything else is trusted.
- Chain engine unit tests (run standalone by the children, NOT via npm test):
  - bitcoin: **16/16 pass** (child's final report). KATs: BIP-173 address
    vectors cross-checked against an independent Python implementation;
    BIP-143 worked-example sighash matched (transcribed from the BIP text).
  - xrp: **15/15 pass** (child's final report). Codec KATs reproduce two
    xrpl.js ripple-binary-codec fixtures byte-for-byte.
  - sui: **12/12 pass** (child's final report, confirmed after the stop).
  - solana: **8 test cases** in file; pass state NOT confirmed — the child
    was still running when stopped (see §3) and was closed mid-flight.
  - aptos: **13 test cases** in file; pass state NOT confirmed — child still
    running when stopped; closed mid-flight.
- No multichain session tests, no hardening tests, no swap tests, no new
  browser E2E, no CSP boot test were run. The local harness (Besu chainId
  912701 at http://127.0.0.1:18545, static server :18080 serving dist/) was
  up earlier in the task; processes may not survive — verify on resume
  (see `evidence/phase4/ENV.md`).

### Live-network proof per chain — AS THE EVIDENCE FILES ACTUALLY STAND
Interim summaries during the task claimed more than the final files support
(two claimed txids — a BTC testnet send and an APT testnet transfer — are
**not present** in the current evidence JSONs; treat those claims as
unproven). What the files on disk actually show:

- **Bitcoin** (`evidence/multichain/bitcoin-live-output.json`): mainnet
  read-only OK (tip 974,669; genesis address stats read via esplora —
  note the `/utxo` listing endpoint refuses that address with HTTP 400,
  stats endpoint used instead; derived bc1 address matches the crypto
  module, balance 0). Testnet = **testnet4** via blockstream.info/testnet
  (tip 5,300,295). Faucets probed were captcha-gated HTML — no programmatic
  funding; a synthetic broadcast (spending an output the key does not
  control) was rejected by esplora **as designed**. → NO confirmed testnet
  spend yet. Engine as built: BIP-143 signing, tx version 2, sequence
  0xffffffff, locktime 0 (child's final report — supersedes an interim
  note mentioning 0xfffffffd/BIP-125; verify in code on resume), fee rate
  from /fee-estimates at target 3 blocks with '3'→'1' fallback and 1.0
  sat/vB floor, dust 546 sat, largest-first coin selection.
- **XRP** (`…/xrp-live-output.json`): altnet connection OK; altnet faucet
  account funded 100 XRP and its balance read back through the engine
  (100,000,000 drops); derived unfunded account correctly returns
  actNotFound; a send from it is rejected `terNO_ACCOUNT` and the engine
  surfaces "The source account does not exist." cleanly; base reserve read
  live = **1,000,000 drops = 1 XRP on both altnet and mainnet** (engine
  read and the earlier server_info probe agree). Explorer URL probes
  (xrpscan mainnet + testnet) HTTP 200.
  → No funded send from a wallet-derived account yet (faucet keys are not
  ours; funding a derived account ≥ reserve is the remaining live step).
  TWO spec conflicts were resolved in favour of the live ledger during
  the build — do not reintroduce them: (1) canonical XRPL UInt type codes
  are UInt16 = 1, UInt32 = 2 (the brief's table said 3; proven wrong by
  the xrpl.js fixtures); (2) the signing form INCLUDES the real
  SigningPubKey and excludes only TxnSignature (the brief's
  empty-SigningPubKey form is the multi-signing form and rippled rejected
  it live with "Invalid signature"); the engine's serialization matched
  ripple-binary-codec byte-for-byte after the fix. Also recorded: fee
  falls back to 12 drops if the fee RPC fails; lastLedgerSequence =
  sequence + 20; an unfunded destination below reserve throws before any
  submit.
- **Sui** (`…/sui-live-output.json`): GraphQL testnet connection OK
  (chainIdentifier `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`,
  reference gas price 1000 MIST); hand-built PTB **simulation parses
  end-to-end** (server returns an insufficient-funds error, not a BCS
  deserialization error); tx-status lookups against real recent digests
  return success; suiscan explorer probe 200. Funded read through the
  engine's own routes proven (framework address 0x…02: totalBalance
  79,842,461,738 MIST). Testnet faucet BLOCKED: `POST
  https://faucet.testnet.sui.io/v2/gas` → "CI compatibility is disabled"
  (legacy /gas and /v1/gas also 404); the faucet now requires a
  browser-completed proof-of-work — no programmatic route found. → No
  funded send yet, but the live script's funded branch (send 1,000,000
  MIST → poll → record digest) is already wired: fund idx0
  `0xb1dfefd160a9b2838f1cfd4d053a9b9eb3471664679411ca7bca33fcd9146406`
  via the browser faucet and re-run `evidence/multichain/sui-live.mjs`.
- **Solana** (`…/solana-live-output.json`): devnet connection OK, balance
  reads OK (0). **Airdrop BLOCKED**: `requestAirdrop` → HTTP 410 "The RPC
  faucet is closed on this cluster" ×6 attempts. No send attempted. The
  child was still exploring alternate funding when stopped.
- **Aptos** (`…/aptos-live-output.json`): testnet chain_id 2 reachable;
  **testnet faucet is no longer programmatically usable** (legacy
  faucet.testnet.aptoslabs.com/mint host times out; current
  faucet-e2.testnet.aptoslabs.com/fund requires a Google Firebase ID token
  from human sign-in). Devnet faucet shape verified
  (`POST https://faucet.devnet.aptoslabs.com/fund {address,amount}` → 200
  `{txn_hashes:[…]}`), BUT the file ends with an unresolved engine error:
  devnet submit → HTTP 400 "Failed to deserialize input into
  SignedTransaction: DeserializationError with Ed25519PublicKey". The
  `mainnet` section of this run is empty. → Aptos has an open signing/
  serialization bug to fix first on resume. (An earlier Aptos TS SDK
  Ed25519 HD KAT is cited in the test file.)

---

## 3. Verified external parameters (probed live during this task)

### Arc Testnet — VERIFIED
- chainId **5042002** (`eth_chainId` → 0x4cef52) via
  https://rpc.testnet.arc.network; gasPrice 25 gwei at probe time.
- Native currency **USDC with 18 decimals** (chain registry + RPC behaviour).
- Explorer: **https://explorer.testnet.arc.io/tx/<hash>** is canonical
  (https://testnet.arcscan.app 301-redirects there; /tx/ path returns 200).

### Robinhood Testnet — VERIFIED
- chainId 46630 via https://rpc.testnet.chain.robinhood.com.
- Explorer **https://explorer.testnet.chain.robinhood.com/tx/<hash>** → 200.
  (Explorer ships enabled — the brief's fallback to null is not needed.)

### CORS from origin https://zeronyth.dpdns.org (browser-context probes)
- DIRECT OK: Base Sepolia https://sepolia.base.org (echoes origin),
  Ethereum Sepolia publicnode (*), Robinhood (*), Arc (echoes),
  Solana mainnet (*) + devnet (echoes), blockstream.info (* — mainnet and
  /testnet are the same origin), Sui GraphQL (*), Aptos fullnodes (echo).
- **NO CORS → gateway proxy required** (planned, NOT implemented):
  Arbitrum Sepolia RPC https://sepolia-rollup.arbitrum.io,
  https://s1.ripple.com:51234, https://s.altnet.rippletest.net:51234.
  Planned pinned routes in gateway-only.mjs: `/remote-rpc/421614`,
  `/remote-rpc/xrp-mainnet`, `/remote-rpc/xrp-testnet` (already referenced
  as `corsProxy` in networks.mjs; the routes do not exist yet).

### Sui interface finding
- **JSON-RPC is dead**: public fullnodes and publicnode return
  "deprecated" errors. **GraphQL is the live interface** and is what the
  engine uses: https://graphql.mainnet.sui.io/graphql (chainIdentifier
  `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`), testnet
  https://graphql.testnet.sui.io/graphql (chainIdentifier above), ACAO `*`.

### Other endpoints
- Aptos: mainnet chain_id 1, testnet chain_id 2
  (fullnode.*.aptoslabs.com/v1). Solana api.mainnet-beta / api.devnet live.
  BTC esplora live; fee-estimates at probe ≈1.914 sat/vB (target 1),
  ≈1.11 (target 3). XRP endpoints live (see reserve note in §2).
- **Jupiter**: `quote-api.jup.ag/v6` returns nothing (dead/key-gated);
  **lite-api.jup.ag/swap/v1 works** — CORS echoes the origin, sane quote
  observed (0.1 SOL → 9.522885 USDC). No swap implementation written; the
  verify-gate (defensible pre-sign validation of the built transaction)
  was not yet designed. Ship/skip decision still open.

### ZERONYTH AMM reference data (for the swap work)
- Production manifest: VPS `~/zeronyth-falcon-912701/deployments/main-amm.json`
  (copy at /tmp/main-amm.json — ephemeral, re-fetch on resume). The wallet
  fetches the same manifest at runtime from `GET /api/points/rules` → `.amm`
  (gateway answers it; verified live, same shape).
- WZNYT 0x3Faa5f9Fcc51C561c7bdE7D4c4E6AD3ea86B5B34; 11 pools: 7 native
  (ZnytAmmRouter) ZNYT/{zETH,zUSDT,zUSDC,zBTC,zSOL,zBNB,zMON} + 4
  token↔token (ZnytTokenRouter). Token↔token ships ONLY if proven in the
  local harness, else excluded. ZNYT/zUSDT pool: pair
  0x54973beCCe8a9DC7c57cA52673627EC0C64A7066, router
  0x447B3b3a3c5200B8292542fC05D31aC80FcCBE9B.

---

## 4. PRODUCTION STATE — NOTHING WAS DEPLOYED

Explicit, complete list for this task:

- **No wallet deploy**: production still serves **SW
  `zeronyth-qwallet-912701v11`** with gateway 302 → `index.html?v=11`.
  Local `sw.js` still has `CACHE = 'zeronyth-qwallet-912701v11'` (comment
  says "next: v12"). `dist/` is the v11 build — NOT rebuilt during this task.
- **No VPS changes of any kind**: no SSH edits, no gateway file changes
  (neither `gateway-only.mjs`, nor the CSP in `replit-gateway.mjs` /
  `zeronyth-edge.mjs` — the *.bak-premultichain backups were never taken
  because the edits were never started), no /wallet2/ mirror updates.
- **No pm2 restarts** (falcon912701-site / zeronyth-edge untouched).
- **No GitHub push**: repo HEAD remains `bc98686` (v11). No local commits
  either (local HEAD `bd0000d`; 41 working-tree entries, mostly pre-existing
  v11-era state plus this task's new files).
- **No production transactions**: the planned ≤1 ZNYT live swap proof
  through the wallet code path was NOT executed. No owner's accounts were
  touched (never planned). All live-network activity in this task was on
  public testnets/devnets/mainnet-read-only as detailed in §2.
- The two still-running engine children (Solana, Aptos) were **closed by
  the lead agent at the stop**; Bitcoin/XRP/Sui children had completed.
- Consequence: **the live wallet is exactly v11 and fully consistent.**
  There is no half-done deploy to unwind. The owner's existing wallet
  needs no action (and would need none for v12 either — no vault change).

---

## 5. What remains, in order (resume plan)

1. **Re-verify the base**: re-run `npm test` (baseline must be 75/75 with
   the rewritten session.mjs in tree); run each `test/chains-*.test.mjs`
   standalone and record real counts; fix fallout before anything else.
2. **Finish engine live proofs**: Aptos — fix the devnet
   Ed25519PublicKey deserialization error, then complete a funded devnet
   transfer through the engine. Solana — find a working devnet funding
   route (RPC faucet closed; try faucet.solana.com API alternatives) or
   record the blocker and ship with balance-read proof. Sui — obtain
   testnet SUI despite the disabled faucet endpoint (alternate faucet
   host/auth) and execute one PTB transfer. XRP — fund a derived altnet
   account ≥ reserve (faucet account flow) and complete one Payment incl.
   a DestinationTag case. BTC — find any programmatic testnet4 funding or
   record the captcha blocker as final.
3. **Add the new tests to package.json** and write the missing suites:
   multichain session tests (registry invariants; remote EIP-155 v via
   decodeRawTransaction; chainId-mismatch rejection with fake RPC;
   PQ-send rejection off-912701; wZNYT calldata/balanceOf), hardening
   tests (backoff with fake clock, IdleTracker, first-send decision,
   contract detection with stub getCode, clipboard stub, no-secret-logging
   scan of src/), swap quote-math tests vs amm-pq fixtures.
4. **UI rework** in `src/ui/app.mjs` + `index.html` (CSS badges for the
   five chain families, disabled-card styling): grouped network selector
   with localized testnet suffix; greyed PQ/chain accounts with
   "ZERONYTH only" notes; token balances; remote-EVM asset selector
   (native vs wZNYT); XRP DestinationTag field; review screen with
   network name + chainId, FULL recipient, amount, fee in asset units,
   first-send warning + explicit ack checkbox gating Approve,
   contract-recipient warning; settings: per-network RPC field +
   custom-RPC caution, auto-lock toggle + 1/5/15 min, build version line;
   add-account panel for the 5 chain families; phrase copy stating the
   phrase restores ALL accounts in this wallet only; Swap screen
   (ZERONYTH pools; "not available on this network" state elsewhere);
   clipboard-clear + idle-controller wiring; localized error mapping
   (too-many-attempts with {seconds}, PQ gate, chain mismatch);
   backup-password <12 localized explanation.
5. **Build version**: create `src/build-info.mjs` placeholder; build.mjs
   bakes SW generation + git short hash (+dirty `+`) into dist; settings
   shows "Quantum Wallet v12 · build <hash>+".
6. **SECURITY.md** at repo root of qwallet-v2 (JA primary, EN after):
   model as implemented + honest limits (compromised device / phishing
   out of scope; official origin https://zeronyth.dpdns.org only; backoff
   is a speed bump — a storage holder can wipe the counter; custom RPC
   can mislead balances but cannot sign).
7. **Browser E2E on the local harness**: (a) second Besu chainId 84532
   (RPC 18546) as fake Base Sepolia via RPC override — switch, ECDSA
   balance, PQ disabled, native send with correct chainId, switch back,
   ML-DSA send at gas 147,176; (b) SOL devnet create→balance→send in UI
   if funding is solved; (c) swap E2E with a locally deployed minimal AMM
   (WZNYT + zUSDT + pair + router, driven with the wallet's own ECDSA
   engine; static server must also answer /api/points/rules with the
   local manifest) — ECDSA + ML-DSA swaps through the real UI;
   (d) boot test under the EXACT production CSP (extended connect-src) —
   no violations beyond known local cross-origin RPC noise.
8. **Live proofs**: one tiny production swap through the WALLET code path
   (throwaway wallet, ≤1 ZNYT, ML-DSA) with tx hash; Jupiter ship/skip
   decision with the pre-sign validation design (or documented skip).
9. **VPS changes**: backups `*.bak-premultichain-20261105` first; extend
   the wallet-branch CSP connect-src in BOTH `replit-gateway.mjs` and
   `zeronyth-edge.mjs` with all shipped origins (sepolia.base.org,
   ethereum-sepolia-rpc.publicnode.com, sepolia-rollup.arbitrum.io,
   rpc.testnet.chain.robinhood.com, rpc.testnet.arc.network,
   api.mainnet-beta.solana.com, api.devnet.solana.com, blockstream.info,
   s1.ripple.com:51234, s.altnet.rippletest.net:51234,
   graphql.mainnet.sui.io, graphql.testnet.sui.io,
   fullnode.mainnet.aptoslabs.com, fullnode.testnet.aptoslabs.com,
   lite-api.jup.ag only if Jupiter ships); add the 3 pinned /remote-rpc
   proxy routes to gateway-only.mjs; sync local master
   `~/workspace/qwallet-fix/replit-gateway.mjs`; restart falcon912701-site
   + zeronyth-edge; verify public CSP on /quantum-wallet/ vs an unchanged
   non-wallet page.
10. **Deploy v12**: sw.js CACHE → `zeronyth-qwallet-912701v12`, gateway
    redirect → `index.html?v=12`; backup deployed tree to
    `~/quantum-wallet-v2-prev11-20261105.tgz`; PRESERVE provider.js in the
    deploy tree; rsync gateway→primary; update /wallet2/ mirrors
    (gateway+primary — not covered by sync); verify edge auto-sync;
    restart falcon912701-site once; public verification (302 target,
    sw.js v12, new modules 200).
11. **GitHub push** from a FRESH clone (quantum-wallet/ dir; multi-chain
    commit message), verify via public API.
12. **Final report** per the original brief (network table, CORS/proxy,
    per-chain vectors + live txids or exact blockers, test counts + E2E
    evidence, hardening items 1–9 individually, swap section, deploy +
    commit, explicit "owner's wallet needs no action", honest partials).

Standing constraints for whoever resumes: production deploy of the wallet
is within the owner's agreed scope; never edit ~/MEMORY.md from this
workstream; NEVER advise clearing Safari website data for
zeronyth.dpdns.org (deletes the vault); verify wallet changes through the
real serving path including CSP headers.
