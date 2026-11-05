# ZERONYTH Quantum Wallet v2

**v12 (multi-chain)** — the wallet now operates on 16 networks: ZERONYTH
912701 (all three schemes below), five EVM testnets (Base / Ethereum /
Arbitrum Sepolia, Robinhood, Arc — ECDSA only, wZNYT on the four bridge
chains), and Solana / Bitcoin / XRP / Sui / Aptos mainnet+testnet engines
(one recovery phrase restores every account in this wallet). PQ accounts
stay gated to ZERONYTH in the UI and the session layer. Also in v12:
in-wallet ZERONYTH AMM swap (all 3 schemes), the security-hardening set
(idle auto-lock, escalating unlock backoff, clipboard auto-clear,
send-safety review — see `SECURITY.md`), and build version stamping.
The full resume record is `CHECKPOINT-multichain.md`; live evidence is
under `evidence/multichain/`.

A three-scheme web wallet for ZERONYTH chain 912701. One vault holds
accounts of all three native signature schemes, selectable per account:

| Scheme | Tx type | Secret material in vault | Address |
|---|---|---|---|
| ECDSA | legacy / EIP-155 | 32-byte secp256k1 private key | `keccak256(pub[1:])[12:]` |
| Falcon-1024 | `0x7E` | 48-byte seed | `keccak256(pubkey)[12:]` |
| ML-DSA-65 | `0x7F` | 32-byte seed | `keccak256(pubkey)[12:]` |

PQ accounts are scheme-bound by construction: an account's secret can only
ever produce its own scheme's signatures, mirroring the chain's
sender-derivation rule. This wallet replaces the v1 Quantum Wallet, whose
source was lost (only a built, ML-DSA-only bundle survives) — v2 is
source-available from day one. Design and phase plan:
`~/workspace/qwallet-fix/wallet-v2-plan.md` (phases 0–5; this repo currently
implements **Phase 1 (vault + migration), Phase 2 (signing/RPC core) and
Phase 3 (full UI)** — deployment remains Phase 5, owner-gated).

## Crypto pin — read this before touching dependencies

`@noble/post-quantum` is pinned to **exactly 0.7.1** (with
`@noble/curves` / `@noble/hashes` 2.4.0). Its `falcon1024` module
implements **NIST round-3 Falcon**, which is what chain 912701 verifies
(BouncyCastle round-3). It is *not* FIPS 206 FN-DSA, and the noble falcon
API is expected to change incompatibly when FN-DSA finalizes — **never
upgrade the pin**, and use only the **unpadded** `falcon1024` export (the
padded variant is a different wire format; the chain rejects it, error
-32002). Phase 0 proved noble↔chain compatibility in both directions and
with a live test-chain transfer (gas exactly 103,080):
`~/workspace/qwallet-fix/phase0/PHASE0-REPORT.md`.

The `node_modules/` tree in this workspace is a byte-for-byte copy of the
Phase 0 vendored tree (itself copied from the VPS `jsdeps`). Before any
public release, vendor the pinned `@noble` tree into the repository
proper (do not rely on a registry fetch of a pre-FIPS-206 version).

## Vault format

- localStorage key: **`zeronyth-vault-v1`** (unchanged from v1, so the
  existing reset tooling and user habits keep working). The blob's
  internal `version` is 2.
- Envelope (v1 parameters): WebCrypto PBKDF2-SHA256, 600,000 iterations →
  AES-256-GCM; 16-byte salt, 12-byte IV, fresh on every save; fields are
  canonical `0x`-hex, exactly as v1 wrote them.
- v2 AAD: `"ZERONYTH/VAULT/V2"`; v2 plaintext is JSON
  `{accounts: [{id, scheme, secret, label, createdAt}]}`.
- v1 AAD was `"ZERONYTH/VAULT/V1/ML-DSA-65"` and its plaintext was the raw
  32-byte ML-DSA seed. The v1 reader in `src/core/vault.mjs` is a faithful
  port of the v1 bundle's vault code (strict header/length checks and
  error strings preserved).

### v1 → v2 migration

On unlock, a v1 blob is decrypted with the v1 envelope and the 32-byte
seed is carried **verbatim** into a v2 ML-DSA account — same keypair, same
address, funds untouched. Before the main key is overwritten, the original
v1 blob string is preserved under **`zeronyth-vault-v1-backup`** (written
only after the password has been proven, and never overwritten once set).
A wrong password leaves storage completely untouched.

## Stack deviation (documented per plan)

The plan suggested React + Vite + TypeScript to mirror v1. Phase 1 uses
**zero-dependency vanilla ES modules** instead:

- The deliverable of this phase is the vault core and migration
  correctness; a framework-free core is directly unit-testable in Node
  (`node --test`) with no build step and no transpiler between the tested
  code and the shipped code.
- The pinned noble tree must be used byte-for-byte, offline. A
  zero-dependency toolchain guarantees that; the only build step
  (`build.mjs`) copies files and rewrites the import map.
- Nothing in the gateway contract, reset tooling, or user habits depends
  on React. Phase 3 confirmed the choice: the UI is plain DOM rendering
  over a framework-free session controller, so the exact code the unit
  tests exercise in Node is what ships to the browser.

## Phase 3 UI

- **Screens**: create vault (password ≥ 12 + confirmation, first account
  with a 3-scheme picker and plain-language notes), unlock (v1 migration
  runs transparently; a banner states the address is unchanged and the
  old vault backup was kept), accounts (scheme badges, per-account RPC
  balances, total, add-account, per-account Send / Receive / Faucet),
  send (to + amount + optional calldata behind an "advanced" toggle;
  review screen with gas per the `gas.mjs` policy; sign → broadcast →
  tx hash + Blockscout link + receipt polling to a final status),
  receive (address + copy), settings (RPC URL), Lock button. No idle
  auto-lock — v1 semantics: locks on Lock or reload only.
- **reset-wallet v3, ported in-app** (`src/app/session.mjs`): the unlock
  screen carries the v3 "forgot password" affordance with an in-page
  confirmation that deletes the vault key + `zeronyth-tokens:*` + the
  legacy autounlock key (the v1-migration backup key is kept, exactly as
  v3 kept it). **Password handling (security fix, 2026-11-05):** v3's
  stay-unlocked behavior was removed — the unlock password is never
  persisted anywhere; an unlocked session is memory-only and a reload
  or tab close locks the wallet. The legacy `zeronyth.qwallet.autounlock`
  key written by earlier builds is scrubbed at startup.
- **i18n ×4** (ja default, en, zh-CN, ko): `src/i18n.mjs` carries all 56
  v1 dictionary keys verbatim (7 copy-corrected where v1 said
  "ML-DSA-only" things that are no longer true) plus Phase 3 keys —
  99 keys × 4 languages, every UI string routed through `t()`. Language
  persists as v1 did: code under `zeronyth.language.v1`, index under
  `zeronyth.qwallet.lang` (both written).
- **RPC**: default `https://zeronyth.dpdns.org/rpc` (plain
  `eth_sendRawTransaction`; the public gateway accepts PQ raw txs since
  the 2026-11-05 `pqRawTxSender` fix). Overridable in settings, stored
  under `zeronyth.qwallet.rpc`; the header shows connection / wrong-
  chain (≠ 912701) / offline state.
- **Falcon UX**: Falcon operations take ~1 s, so every slow action shows
  a busy label (creating / deriving / signing / broadcasting) rendered
  *before* the synchronous keygen starts, and account summaries are
  cached per unlock session. Deviation from the plan's letter: derived
  keypairs/secrets are *not* cached outside the vault — the vault itself
  holds the secrets in memory while unlocked and zeroizes on lock;
  caching keypairs elsewhere would duplicate secret material for no
  user-visible gain.
- **PWA**: `sw.js` (cache **`zeronyth-qwallet-912701v7`** — v1 ended at
  v6) precaches the app shell, deletes older caches on activate, and
  never intercepts non-GET or cross-origin traffic (RPC passes through).
  **Deploy rule:** bump the cache name on *every* asset-changing deploy
  and bump the gateway's `index.html?v=N` in lockstep. Icons are
  generated by `tools/gen-icons.mjs` (dependency-free PNG encoder).

### Phase 3 deviations / non-goals

- Reset confirmation is an inline panel (v3 used a floating overlay);
  semantics identical.
- No QR code on Receive: no dependency-free QR generator was vendored;
  address + copy covers the flow. Revisit only with a pinned library.
- No ERC-20 token list UI (v1 had one; the plan's Phase 3 scope does not
  include it). The wipe still clears `zeronyth-tokens:*` for parity.
- No dApp provider shim (`window.ethereum`-style injection); the wallet
  is standalone, as v1's Quantum Wallet was.

## Secret recovery (master seed, phrase, encrypted backup)

New wallets are **master-seed wallets**: one random 32-byte master seed
is the single root of every account.

- **Derivation** (`src/core/hd.mjs`): per-account secrets are derived
  deterministically with domain separation —
  `block(i) = keccak256(utf8(domain) ‖ 0x00 ‖ master ‖ uint32BE(index) ‖ uint8(i))`,
  concatenated and truncated to the scheme's secret size (Falcon's
  48-byte seed spans two blocks). Domains:
  `ZERONYTH/WALLET/V2/MLDSA`, `ZERONYTH/WALLET/V2/FALCON`,
  `ZERONYTH/WALLET/V2/ECDSA`. Once the per-scheme secret exists, the
  usual keygen/address rules apply unchanged.
- **Recovery phrase** (`src/core/bip39.mjs` + `bip39-wordlist.mjs`):
  the master seed encoded as a 24-word mnemonic with the standard
  BIP39 entropy→mnemonic construction (SHA-256 checksum, official
  English 2048-word list vendored with a provenance note). The list is
  used **purely as an encoding** — no BIP39 seed derivation (PBKDF2 /
  "BIP39 seed") is involved anywhere. Decoding validates wordlist
  membership and the checksum.
- **Vault shape**: master wallets keep the v2 envelope (version 2,
  `MULTI`, AAD `ZERONYTH/VAULT/V2`) but the plaintext payload is
  `{ kind: "master", master: "<hex>", accounts: [{ id, scheme, index,
  label, createdAt }] }` — descriptors only; per-account secrets are
  re-derived in memory on unlock and never stored. Legacy v2 payloads
  (`{ accounts: [{ …, secret }] }`) and v1 vaults unlock exactly as
  before; nothing is force-migrated.
- **Create flow**: show the 24 words → confirm 3 randomly chosen word
  positions → set password → index-0 accounts for all three schemes.
- **Restore flow** (no-vault screen): enter the phrase → validate →
  set a NEW password → materialize index-0 for all schemes, then probe
  indices 1..4 per scheme via the configured RPC (balance or nonce > 0)
  and materialize those too. If the RPC is unreachable, restore is
  index-0 only and the UI says so.
- **Reveal**: settings → password re-entry → phrase shown (master
  wallets only; legacy wallets are told no phrase exists for them).
- **Encrypted backup (any wallet)**: export encrypts the wallet's
  secrets under a user-chosen **backup password** (independent of the
  wallet password) as `{ format: "zeronyth-wallet-backup", version: 1,
  … }` with AAD `ZERONYTH/VAULT/BACKUP/V1`; import on the no-vault
  screen takes the backup password plus a new wallet password. This is
  the recovery path for pre-phrase (legacy) wallets.
- **Security**: the phrase and master seed never leave the device, are
  never logged, and are never stored unencrypted; the create-flow
  phrase lives only in page memory until the wallet exists.

Tests: `test/recovery.test.mjs` (BIP39 official vectors, derivation
known-answer addresses, vault/backup round trips, session-level
create/restore/reveal) and `test/recovery-browser.mjs` (full UI E2E on
the local Phase 4 chain: phrase create → wipe → restore → send →
backup import).

## Layout

```
index.html          app shell (header, import map, styles)
main.mjs            entry point — boots src/ui/app.mjs
build.mjs           -> dist/ static bundle (src + PWA shell + vendor/@noble)
sw.js               service worker (cache-name discipline documented inside)
manifest.webmanifest  PWA manifest
icon-192.png / icon-512.png  generated by tools/gen-icons.mjs
src/i18n.mjs        dictionary (99 keys × ja/en/zh-CN/ko) + language runtime
src/app/
  session.mjs       framework-free session controller (vault lifecycle,
                    v3 reset, memory-only unlock, balances, faucet,
                    send pipeline)
src/ui/
  app.mjs           DOM UI over the session controller
src/core/
  bytes.mjs         canonical hex (v1-compatible) + UTF-8 helpers
  crypto.mjs        per-scheme keygen + chain address derivation
  vault.mjs         vault v2, v1 reader, migration
  storage.mjs       Storage-like adapters (localStorage / in-memory)
  rlp.mjs           RLP encode/decode
  tx.mjs            signTransaction / signWithVault / decodeRawTransaction
  gas.mjs           per-scheme intrinsic gas policy
  rpc.mjs           minimal JSON-RPC client (injectable fetch)
  amount.mjs        strict ZNYT decimal <-> wei + address/data validators
tools/
  gen-icons.mjs     dependency-free PWA icon generator
test/
  vault.test.mjs    vault/crypto/migration suite
  tx.test.mjs       signing engines + known-answer vectors
  ui.test.mjs       Phase 3: i18n, amount, session controller (fake RPC)
  e2e.chain.test.mjs  live test-chain E2E (chain 912772 harness)
  smoke.mjs         build + serve dist/ + assert all assets 200
  fixtures.mjs      known-answer vectors + a genuine v1 bundle fixture
  gen-v1-fixture.mjs  provenance tool that produced the v1 fixture
  crosscheck-cli.mjs  optional live cross-check against pq-wallet.mjs
```

## Develop

```
npm test        # headless suites (vault, tx, UI/session, chain E2E)
npm run build   # -> dist/
npm run smoke   # build + serve dist/ locally + assert all assets 200
npm run dev     # serve the project root on http://127.0.0.1:5173
```

Not yet built (later phases): Phase 4 — test-chain E2E driven through
the UI layer in a real browser (fresh profile per run to avoid the v1
service-worker trap); Phase 5 — deployment to the live dashboard path,
which requires the owner's final approval and the SW cache-bump +
gateway `?v=` bump described above. Nothing in this repository is
deployed; the live wallet is untouched.
