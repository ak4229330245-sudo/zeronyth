# Phase 4 Test Environment — Quantum Wallet v2 UI Browser E2E

Local-only environment. Nothing here touches the VPS or production.

> **Chain ID was changed 912772 → 912701 (2026-11-05).** The wallet v2 UI
> hardcodes `CHAIN_ID = 912701n` (`~/workspace/qwallet-v2/src/app/session.mjs`,
> line 49) for its connection check and for signing, so the original
> chainId-912772 test chain would have rejected every UI send. The chain was
> therefore rebuilt with chainId **912701** (same validator, same funded
> genesis accounts, same ports). The old 912772 chain was disposable (its
> Phase 2 role is done); its artifacts are preserved as `besu-912772.log`,
> `chain/genesis-912772.json` and `chain/data-912772/`. An early failed start
> (Falcon key path) is kept as `besu-failed-912701.log`.

> **CORS enabled (2026-11-05).** The Besu node was relaunched in place (same
> genesis, same data dir — chain state continued across the restart) with the
> additional option `--rpc-http-cors-origins="*"`, because Besu's default CORS
> rejected the wallet UI origin (`http://127.0.0.1:18080`) with
> `403 CORS Rejected - Invalid origin`, which would have blocked every wallet
> RPC call from the browser. Verified after relaunch: POST `eth_chainId` with
> that Origin → `200` + `access-control-allow-origin: http://127.0.0.1:18080`,
> OPTIONS preflight → `204`; height resumed past the pre-restart block 82 and
> keeps advancing at 1 block/s; the ML-DSA test account balance was identical
> before/after (`0x33b2e3c91ef43ae2b68f000` wei). Besu PID changed
> 3582 → **4137** (`besu.pid` updated; log appended to the same `besu.log`).
> The UI server (PID in `http.pid`) was not touched. Wildcard CORS is fine
> here — this is a disposable local test node; do not copy it to production.

> **Rebound to 0.0.0.0 for external browser access (2026-11-05).** The Muse
> browser runs outside this VM's loopback and got connection refused on
> 127.0.0.1, so both services were restarted listening on all interfaces:
> the UI server now runs `python3 -m http.server 18080 --bind 0.0.0.0`
> (PID 3092 → **5176**) and Besu was relaunched with the single change
> `--rpc-http-host=0.0.0.0` — every other parameter identical, including
> `--rpc-http-cors-origins="*"` (PID 4137 → **5248**; same genesis/data,
> chain state continued: height resumed past the pre-restart block 372 and
> the ML-DSA test account balance was again identical,
> `0x33b2e3c91ef43ae2b68f000` wei). External URLs: UI
> `http://198.19.0.2:18080/`, RPC `http://198.19.0.2:18545`
> (198.19.0.2 is this VM's `host0` interface address). Verified over
> loopback after the rebind: UI → HTTP 200, title "ZERONYTH Quantum
> Wallet"; RPC `eth_chainId` with `Origin: http://198.19.0.2:18080` → 200,
> `access-control-allow-origin: http://198.19.0.2:18080`, result
> `0xded3d`; chain advancing at 1 block/s, `eth_syncing` false.
> **Caveat:** reachability of 198.19.0.2 could NOT be confirmed from inside
> the VM — in-VM `curl http://198.19.0.2:18080/` and `:18545` connect via
> the virtual-network peer 198.19.0.1 and are then reset by the peer
> (`curl: (56) Recv failure: Connection reset by peer`, HTTP 000), even
> though `ss` shows both services listening on `0.0.0.0:18080` /
> `*:18545` and both answer correctly on loopback. This looks like a
> sandbox hairpin limitation on the VM's own external address, not a
> service problem; confirm from the browser side. These 0.0.0.0 bindings
> are for this local sandbox only — do not copy them to production.

## Services (both left running, detached via nohup)

| Service | URL / Port | PID | PID file | Log file |
|---|---|---|---|---|
| Besu test chain (single-validator Falcon QBFT) | RPC `http://127.0.0.1:18545` / external `http://198.19.0.2:18545`, P2P `127.0.0.1:41445` | see `besu.pid` | `~/workspace/qwallet-v2/evidence/phase4/besu.pid` | `~/workspace/qwallet-v2/evidence/phase4/besu.log` |
| Static server for wallet UI (`qwallet-v2/dist/`) | `http://127.0.0.1:18080/` / external `http://198.19.0.2:18080/` | see `http.pid` | `~/workspace/qwallet-v2/evidence/phase4/http.pid` | `~/workspace/qwallet-v2/evidence/phase4/http.log` |

Stop commands (unchanged):

```bash
kill $(cat ~/workspace/qwallet-v2/evidence/phase4/besu.pid)   # stop the test chain
kill $(cat ~/workspace/qwallet-v2/evidence/phase4/http.pid)   # stop the UI server
```

If the chain is ever restarted by hand, the Falcon consensus key is NOT in
the data path — Besu must be launched with
`BESU_FALCON1024_KEY_FILE=~/workspace/qwallet-v2/evidence/phase4/chain/falcon1024.key`
in its environment (that is how both incarnations of this chain were started).

Chain data dir (persistent, safe to delete when done):
`~/workspace/qwallet-v2/evidence/phase4/chain/data`
Genesis: `~/workspace/qwallet-v2/evidence/phase4/chain/genesis.json`
Validator (Falcon-1024 QBFT): `0x456a00a742f07d9e109d68a6913579298b6a00d1`,
key file `~/workspace/qwallet-v2/evidence/phase4/chain/falcon1024.key` (test-only, generated locally).

## Chain facts

- Chain ID: **912701** (`0xded3d`) — verified live via `eth_chainId`
- `pqTxActivationBlock`: **5**
- Block period: 1 s, single validator
- Activation status: head passed block 5; **PQ probe PASSED** on this chain —
  a native ML-DSA-65 (type `0x7f`) transfer signed with PortE2ETool
  (chainId 912701) was accepted and mined:
  tx `0xce39a556bbfca25222c6b51e6d6f032ca3809dc77709e3980613bbe313e75b18`,
  block 26, status `0x1`, gasUsed **147176** (exact ML-DSA intrinsic gas).
  (The previous 912772 chain's probe was tx
  `0x69aa119b8b516c278b5c25003289288d05d5ee821a2b849e57bec537d471c6c6`.)
- Besu binary: `~/workspace/besu-2611-recon/src/build/install/besu` (ported build,
  same as Phases 0–2), JDK `~/workspace/besu-2611-recon/work/jdk-25`.

## Genesis-funded test accounts (each funded with 0x33b2e3c9fd0803ce8000000 wei)

| Scheme | Address | Key file (path only) |
|---|---|---|
| ECDSA | `0xf86ef05acfaa18d67d58823b4b7166127ed55f93` | `~/workspace/besu-2611-recon/e2e/ecdsa-account.txt` |
| ML-DSA-65 | `0x504ad114d057e8bc918958776d4cba964db70a26` | `~/workspace/besu-2611-recon/e2e/mldsa-account.txt` |
| Falcon-1024 | `0x53d59ff2b6be683d485991761106dc695d5b4764` | `~/workspace/besu-2611-recon/e2e/falcon-sender.key.acct` |

## Funding helper (use this to fund wallet accounts created in the UI)

```bash
~/workspace/qwallet-v2/evidence/phase4/fund.sh <address> <znyAmount>
# example:
~/workspace/qwallet-v2/evidence/phase4/fund.sh 0xYourWalletAddress 100
```

It signs an ECDSA transfer from the genesis-funded ECDSA account above with
PortE2ETool `sign-ecdsa` (chainId **912701**), submits via
`eth_sendRawTransaction`, and prints the tx hash. Re-verified after the
chainId change: funded fresh address
`0x100aabec141e4dcaf90655f4d7fa281d4a52fce0` with 25 ZNYT —
tx `0x9d4aa41932e9db2902a99e7bf3e576f86a44cf79362a59ef17a98e5f3656e2b9`,
status `0x1`, balance exactly 25.0 ZNYT afterwards.

## ⚠️ Expected behavior: the UI faucet button will NOT work here

The wallet UI's faucet button calls the `zny_faucet` JSON-RPC method. That method
is answered by the production site gateway, **not** by a bare Besu node — this
test chain's RPC will return "method not found". **This is expected and is not a
bug.** Fund UI-created accounts with `fund.sh` above instead.

## Pointing the wallet at this chain

Open `http://127.0.0.1:18080/`, and in the wallet's settings set the RPC URL to
`http://127.0.0.1:18545`. The header should show chain 912701 as connected —
the wallet only accepts chain 912701 (hardcoded), which is exactly why this
test chain now runs that ID locally.

From a browser outside this VM's loopback, use the external addresses
instead: open `http://198.19.0.2:18080/` and set the RPC URL to
`http://198.19.0.2:18545` (both services now bind 0.0.0.0 — see the rebind
note at the top of this file, including the in-VM hairpin caveat).
