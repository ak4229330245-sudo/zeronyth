# ZERONYTH L1 Developer Kit v1.8.32-safetyfix-znyt

> **ZERONYTH / ZNYT unified test release:** New native-coin wallet settings,
> faucet response keys, security network ID, and AI / VPS simulated ledger
> identifiers consistently use **ZNYT**. This is separate from any previously
> published **QTM or QSH** asset. No token conversion, ERC-20 deployment, public faucet,
> public RPC, remote GPU/VPS rental, real validator reward or real AI billing
> has occurred. The EVM development chain still uses chain ID `9127` (`0x23a7`);
> the standalone ML-DSA / AI mock ledger uses a new `ZNYT_LAB_*` namespace,
> so old simulated balances and signatures are **not interchangeable**. See
> [brand migration and token boundaries](docs/ZERONYTH_ZNYT_MIGRATION.md).

> **New ZNYT visual identity:** The token emblem is separate from the creator's
> fox icon. Downloadable 512×512 PNG and editable SVG are included at
> `dashboard/assets/znyt-token.png` and `dashboard/assets/znyt-token.svg`.
> These are brand artwork, **not** evidence of a deployed token contract.

> **Wallet/RPC safety note:** the dashboard uses its same-origin `/rpc` proxy for its own read-only local view. Wallet network-add uses an explicitly configured `window.ZERONYTH_CONFIG.rpcUrl`; if none is configured, only a loopback dashboard may fall back to its local `:8545` endpoint. A remotely hosted page will no longer incorrectly tell a phone wallet to connect to the phone's own `127.0.0.1`. Do not publish an RPC URL until the operator has actually deployed, secured, and tested that endpoint. See `docs/AUDIT_FIXES_v1.8.32.md`.


> **Security boundary / v1.8 experimental lab:** All existing v1.6 Besu/EVM/QBFT
> and security features are retained. The added [`pq-native/`](pq-native/README.md)
> runs **separately** and demonstrates genuine ML-DSA-65 signed transfers,
> signed leader proposals and a 3-of-4 ML-DSA validator quorum across four local
> processes. It is **not a Besu fork**, not EVM execution, not networked QBFT,
> not publicly deployed and not production-ready. The existing Besu chain still
> uses ECDSA; do not claim it has been replaced or made quantum-safe.
>
> **Runtime requirement:** use Node.js 24 or newer for the PQ lab. From `pq-native/`, run `npm test`; a pretest check now stops early with a clear error on older Node versions. You can also run `node demo.mjs` and `node network-demo.mjs`. Node.js 22 does not support the required `ml-dsa-65` crypto key type and cannot validate this lab.

> **Performance/security update (v1.8.3 research add-on):** The PQ lab limits
> blocks to 1,536 transactions/16 MiB, caches only exact previously authenticated
> proposals on the same chain head and independently verified, exact signed
> transactions (with nonce/replay checks on every execution), persists local
> validator vote decisions before signing, and supports parallel ML-DSA-65
> signature admission and a bounded staged-block/hash-only vote and commit path.
> This version additionally fsync-persisted certified blocks and replays their
> ML-DSA signatures on node restart. Optional parallel account execution is
> guarded by **full serial-state cross-checks**. A valid three-of-four quorum
> is still required and no unsafe leader view-change is enabled. See
> [BFT safety design](pq-native/BFT_SAFETY_DESIGN.md).
> Earlier v1.8.2 four-process localhost tests measured about 601 TPS (single
> 1,500-tx block) and 581 TPS (four 1,000-tx blocks). These are historical
> local-lab results, not a certified benchmark for the current storage path.
> With fsync-backed persistence enabled in v1.8.3, the same four-process
> four-block/4,000-tx local test measured **about 507 TPS** inclusive of
> independent ML-DSA admission, block delivery and disk durability.
> **5,000 TPS is a long-term target, not a measured achievement.** Neither the
> baseline Besu ECDSA network nor the separate PQ lab is production-ready PQ consensus.

> **v1.8.4 research add-on:** ML-DSA-signed third-party node registration,
> three-of-four validator-signed capacity attestations, staked provider accounting,
> deterministic SHA-256 test jobs, independently checked results, escrowed
> **DEV-CREDIT** rewards/refunds and a 10-candidate/two-worker preverification
> queue. The compute job is a **local simulation, not remotely executed work**;
> the capacity certificate attests a claim, not measured hardware. No ZNYT is
> minted or transferred; no external node can join the network. Ten candidates
> can be checked ahead but block finalization remains **one block at a time**.
> See [node rewards lab](pq-native/NODE_REWARDS_DESIGN.md).

> **v1.8.5 multi-device lab:** Add portable, dependency-free participation
> policies for PC/desktop, server, phone and tablet, plus ML-DSA-signed device
> profiles and heartbeat status. Device-aware simulated job assignment requires
> valid opt-in capacity, recent signed availability and platform-safe energy
> limits. iOS/iPadOS use short-lived light/relay participation; rewarded local
> compute remains **disabled** pending platform compliance review. Android may
> simulate small foreground/charging/unmetered compute jobs. **There is not yet
> a runnable iOS/Android app or third-party network.** Read
> [multi-device design](pq-native/MULTIDEVICE_NODES.md).

> **v1.8.6 opt-in Web Node Lab:** the existing Explorer nav now links to the
> responsive local-only `/node.html` page. A consent-gated foreground Web Worker
> performs bounded SHA-256 work; the main thread independently verifies results.
> The screen shows start/stop, paused/active status, completed verifications,
> device policy, activity time and **local-only demo counters**, always **0 real
> ZNYT**. Hidden tabs stop workers; returning to the visible tab can resume only
> previously authorized work. There is **no real P2P connection or browser
> ML-DSA signing** and no publicly accessible mobile endpoint. See the
> [Web node lab guide](docs/WEB_NODE_LAB.md).

> **v1.8.7 experimental browser P2P:** Add real WebRTC encrypted data
> channels between consenting browsers in a private invitation room and a
> Docker-internal, in-memory SDP/ICE signaling service. Each browser can ask
> another for a bounded SHA-256 demo proof, then independently check it.
> This does **not** synchronize L1 blocks, operate a network validator,
> perform ML-DSA browser authentication, provide actual ZNYT compensation,
> deploy any public service or remove all reliance on physical servers.
> The existing fixed-validator Besu devnet and independent native PQ lab remain
> unchanged. A user's own PC may be off **only once other people host**
> the website/signaling/bootstrap and validators; currently all are local.
> Read [WebRTC P2P lab guide](docs/WEBRTC_P2P_LAB.md).

> **v1.8.8 opt-in distributed-validator kit:** Generate four private, per-host
> Besu/QBFT validator directories from a freshly initialized devnet, each
> configured to reconnect directly to the other three over stable private VPN
> addresses. Includes fail-closed export protection, separate key custody,
> bind-only-to-VPN TCP P2P, localhost-only RPC, durable per-host storage and a
> read-only liveness checker. If three independent validators remain online,
> they may keep blocks progressing while the founder's PC is off. No external
> machines were started or networks published, and neither native ML-DSA
> consensus nor real token rewards are integrated. See
> [independent validator P2P guide](docs/INDEPENDENT_VALIDATOR_P2P.md).

> **v1.8.9 experimental bottleneck analysis:** A new bounded and repeatable
> four-process localhost profiler compares sequential execution against the
> optional parallel execution **with full serial cross-check**. On a sample
> 1,152-transfer workload with two runs/mode, medians were ~562 and ~598
> **local research TPS** respectively, with material run-to-run noise and an
> earlier run favoring sequential mode. No automatic parallel mode change:
> safety invariants, independent ML-DSA signature verification and durable
> journals remain required. The separately hosted Besu validators were not
> benchmarked. See [performance audit](docs/PERFORMANCE_1_8_9.md).

> **v1.8.10 measured ML-DSA fast path:** Cache only the address calculated
> from an already validated canonical ML-DSA public key and the public SPKI
> belonging to a validated in-memory private signer. This removes repeated
> DER exports/address hashing and signer public-key extraction without caching
> or skipping ML-DSA signature verdicts, nonce checks, state verification,
> three-of-four votes or fsync commits. The local four-process research
> profiler's final two-run comparison measured ~599 TPS sequential and ~656
> TPS optional parallel; a separate three-run, two-signature-worker sequential
> sample measured ~761 TPS median.
> Results vary greatly by run/order/load and cannot be credited entirely to
> these changes. The existing optional parallel execution stays **OFF** by
> default; public network/Besu/EVM 5,000+ TPS remains unverified. See the
> [key path benchmark](docs/PERFORMANCE_1_8_10.md).

> **v1.8.11 safe 10-block lookahead lab:** the existing two-lane signed
> candidate admission pipeline has a new, opt-in `previewStates()` mode with
> bounded speculative workers. It calculates predicted *successive* heights
> and state roots for up to ten queued candidate blocks on a fully isolated
> in-memory fork. Each previewed block is still cross-checked against the
> canonical sequential execution result. A preview signs no vote, changes no
> authoritative ledger and grants no commitment rights. Stale previews must
> be recomputed after the real head changes; real blocks remain committed **one
> at a time with the existing full ML-DSA 3-of-4 quorum, state verification
> and durable journal**. Run `node pq-native/pipeline-demo.mjs` and read
> [pipeline research notes](docs/PIPELINE_1_8_11.md). This is *not* fully
> decoupled Monad-style consensus/execution, an EVM database replacement,
> public P2P validator deployment or a 5,000 TPS performance achievement.

> **v1.8.12 asynchronous ordering/state-delta research:** A new *independent*,
> opt-in ML-DSA-65 laboratory certifies transaction **order** with 3 of 4
> validator signatures and fsyncs an ordering journal *before* executing
> anything. A separate execution lane sequentially verifies signed transfers
> and appends **changed accounts only** to an independently durable delta WAL.
> After restart, signed orders are independently re-executed from genesis and
> compared with each stored state root to detect even a rehashed fraudulent
> WAL. Local tests exercise crash recovery, conflicting votes, forged/quorum
> signatures, journal tampering and concurrent-write rejection. Run
> `node pq-native/async-order-demo.mjs` and see
> [v1.8.12 design and safety boundaries](docs/ASYNC_ORDERING_1_8_12.md).
> **This is not a live P2P/Besu/EVM consensus upgrade; invalid ordered
> transactions can still halt deferred execution, and 5,000 TPS is NOT
> measured or achieved.** The v1.8.11 preview pipeline remains available.

> **v1.8.13 conflict-aware parallel transactions:** the separate deferred
> execution laboratory now uses up to two bounded CPU workers for sufficiently
> large transaction batches (configurable 0–8 workers). Transfers sharing a
> sender or recipient remain in canonical sequential order; only disjoint
> account groups may execute concurrently. **Every parallel result must match
> a full independent canonical sequential state root before the existing
> fsync-protected delta WAL advances.** Tests exercise 64 independent signed
> transfers, nonce-dependent fallback and malicious worker-root rejection.
> Run `node pq-native/parallel-transaction-demo.mjs` and read
> [parallel transaction safety and measured overhead](docs/PARALLEL_TRANSACTIONS_1_8_13.md).
> In one local 64-transfer sample, full cross-checking made parallel slower
> than serial (roughly 69 ms vs 21 ms); **no speedup or 5,000 TPS claim**.

> **v1.8.14 signature-worker pipeline:** the **separate research lab** now
> verifies every ML-DSA-65 transaction signature in bounded CPU workers,
> overlaps account-disjoint speculative execution with its independent
> canonical serial state check, can pre-warm workers, and pre-verifies exactly
> one *future certified* order while the previous order executes. The next
> order is **never executed or finalized early**. New tests reject fraudulent
> worker-supplied nonce/amount, invalid signatures and unsafe future-order
> execution. Three repeated **single-machine, execution-only**
> 1,536-transfer samples yielded a median **~4,882 executed tx/s** for the
> warmed prefetch path versus **~3,411 executed tx/s** serial; the median
> per-trial ratio was ~1.43×. This excludes signing, consensus, transport and
> worker cold start — **not actual network TPS, not sustained 5,000 TPS**.
> Run `node pq-native/signature-pipeline-demo.mjs` and see
> [v1.8.14 performance and safety notes](docs/SIGNATURE_PREFETCH_1_8_14.md).

> **v1.8.15 CPU-aware research speedup:** choose 1–4 native signature and
> execution workers automatically from reported CPU parallelism (manual
> overrides still allow 0–8). Reuse verified sender/nonce uniqueness for
> duplicate detection without redundant JSON/SHA-256 work, and separately
> measure signature/execution and fsync state-write phases. On a **9-logical-
> CPU** local host, three warmed four-worker 1,536-transfer execution-only
> samples measured **6,030 / 6,197 / 6,889 tx/s** with exact serial-state
> agreement (median ~6,197 tx/s versus ~3,381 serial, ratio ~1.85×).
> This **excludes signing, quorum ordering, real P2P, worker startup and
> public deployment**. It is not a sustained network 5,000 TPS result,
> and the owner's **2-core VPS will default to 2 workers** instead. Read
> [v1.8.15 hardware tuning and limitations](docs/CPU_FAST_PATH_1_8_15.md).

> **v1.8.16 direct local validator peers:** the separate ML-DSA-65 native
> laboratory can now optionally route a proposed block directly from the
> rotating leader to the other three local validator processes. Every peer
> independently verifies the full signed state transition, persists an
> anti-equivocation vote, checks the 3-of-4 quorum certificate and fsyncs its
> own committed block. All four acknowledgements must match. This mode uses
> **only 127.0.0.1**, is disabled by default, and is **not internet P2P or
> production fault-tolerant BFT**. One short 1,536-transfer trial measured
> **~610 admission+consensus+fsync TPS** (vs ~598 for the existing coordinator
> under a similar run). Single-run noise does **not** establish a sustained
> performance improvement; 5,000 distributed TPS remains unverified. Try
> `node pq-native/network-demo.mjs 512 --blocks 3 --senders 32 --direct-peer --preverify`
> and read [v1.8.16 direct validator peer safety/performance notes](docs/LOOPBACK_VALIDATOR_PEERS_1_8_16.md).

> **v1.8.28 ZERONYTH AI local testnet lab:** Adds a mobile-first AI chat
> interface, a real localhost Ollama generation adapter with ML-DSA-signed
> output receipts, ZNYT-LAB-only simulated escrow/payment after independent
> receipt validation and explicit test approval, and actual local AI responses
> for eligible mock-bonded node-provider free-quota requests. No real ZNYT,
> real on-chain testnet transfer, GPU hardware attestation or outbound prompt
> sending to third-party providers. Actual model availability still depends
> on a separately installed allowlisted Ollama runtime; tested with mock
> inference responses. [AI testnet status and guide](docs/AI_LOCAL_TESTNET_1_8_28.md).

> **v1.8.27 opt-in node discovery:** A volunteer host can create a local
> ML-DSA identity and sign a resource declaration with CPU, RAM, GPU discovery
> and proposed L1 / AI / rental resource shares. A loopback-only enrollment
> coordinator verifies nonces/signatures and journals claims; an admin-token-
> protected, iPhone-responsive dashboard shows claimed nodes and heartbeats.
> Enrollment is unlimited by a configured node-count cap, but it does **not**
> attest hardware, admit consensus validators, enforce allocations, mint ZNYT,
> run AI workloads or create rented VPS instances. The owner can operate the
> coordinator from an existing Linux VPS without a local PC, once the VPS is
> configured. See [v1.8.27 operator guide](docs/OPT_IN_NODE_DISCOVERY_1_8_27.md).

> **v1.8.26 opt-in hosted container/GPU/AI integration:** Adds an operator-
> controlled rootless Docker backend for bounded container environments,
> allowlisted NVIDIA GPU assignment and a localhost Ollama API adapter for
> model inference. Signed provider permits and renter requests bind each
> operation to a research rental; verified signed service receipts can unlock
> mutually approved ZNYT-LAB escrow settlement. **No Docker, NVIDIA GPU or
> Ollama was installed in the build environment: backend invocation passed
> mocked tests only; no physical VPS/GPU/AI service was proven. ZNYT is still
> simulated and Docker is not a full VM.** See
> [implementation status and operator safety guide](docs/HOSTED_VPS_GPU_AI_1_8_26.md).

> **v1.8.25 actual bounded CPU provider pilot:** A node agent accepts
> chain-bound, ML-DSA-65-signed provider permits and renter work orders
> on a strictly localhost HTTP server. A separate worker thread actually
> computes bounded SHA-256 work and produces a signed, independently
> verifiable result. In the opt-in `znyt.requireExecutionProof` setting,
> simulated VPS rental payment is not settled until verified work exists
> and both parties sign usage. **This is real CPU work, not an actual
> provisioned VPS, paid hosting, live ZNYT transfer, GPU task or AI model.**
> Run `node pq-native/lease-cpu-demo.mjs` and read the
> [real CPU node pilot and limits](docs/LEASE_CPU_NODE_1_8_25.md).

> **v1.8.24 one simulated ZNYT economy:** A new opt-in `znyt` configuration
> shares one `ZNYT_LAB_NOT_REAL_TOKEN` account balance across VPS/AI-GPU
> booking payments, validator rewards and hypothetical gas fees. Signed
> gas charges burn 20% by default and place the remaining 80% in a common
> validator reward pool. Node providers retain the signed mock AI access
> entitlement. Supply conservation is verified after rental, gas and
> reward activity. **No real ZNYT was minted or burned, no on-chain gas
> was executed, and no remote VPS or AI worker exists yet.** Try
> `node pq-native/unified-znyt-demo.mjs` and see
> [unified ZNYT economy research scope](docs/UNIFIED_ZNYT_1_8_24.md).

> **v1.8.23 partial gas fee burn accounting lab:** The isolated native
> ML-DSA-65 research toolkit includes a distinct simulated GAS-LAB fee
> ledger. A payer signs maximum permitted gas/price, a genesis validator
> signature quorum attests the same simulated usage, and the ledger
> **destroys 20% of the simulated amount by default** while assigning 80% to
> a network reward pool. Burn rate is configurable at construction; nonces,
> signatures, replay bounds and exact circulating-supply conservation are
> tested. **These are quorum-asserted hypothetical gas units, NOT actual
> measured L1 gas or real ZNYT/governance-token burns.** The existing Besu
> private network retains `zeroBaseFee: true` and the native execution chain
> still has no gas-priced transaction protocol. Run
> `node pq-native/gas-burn-demo.mjs` and read
> [v1.8.23 gas burn model and migration limits](docs/GAS_FEE_BURN_1_8_23.md).

> **v1.8.22 verified node-provider AI entitlement lab:** Every active,
> bonded, capacity-countersigned native compute provider can check eligibility
> for a **free research AI access quota**, without buying rental GOV-LAB
> credits or committing its entire node to AI training. Requests require a
> chain-scoped ML-DSA signature, unique request ID and current market nonce;
> duplicate IDs, impostors, stale/offline nodes and per-epoch quota overruns
> fail closed. Default: **20 mock access requests per 10 simulated blocks**.
> **These are access tickets only. No prompt is sent to a model, no generated
> answer exists yet, no actual inference quota/API, and no third-party hosting
> are available.** Read [node-provider AI access](docs/NODE_PROVIDER_AI_ACCESS_1_8_22.md).

> **v1.8.21 signed L1/AI/rental resource split:** Participating native
> compute node providers can explicitly reserve a configurable part of their
> claimed CPU/RAM to **future L1 transaction preverification and relay**, and
> another part of CPU/RAM plus an abstract fractional GPU duty cycle to
> **future community generative-AI training/fine-tuning/inference**. A suggested
> opt-in budget is **20% L1 + 20% AI + 60% otherwise available to rentals**.
> ML-DSA-authorized changes must preserve booked rental and job capacity;
> the allocated shares must not exceed 100% combined. A full GPU rental cannot
> overlap a partial AI GPU commitment unless enough other whole GPUs remain.
> **This reserves resources in a private simulation only: no remote workers,
> actual TPS increase, model learning or GPU time-slicing is implemented.**
> Read [v1.8.21 split design](docs/CHAIN_AI_RESOURCE_SPLIT_1_8_21.md).

> **v1.8.20 VPS + AI GPU + governance-token economy lab:** The private ML-DSA-65
> compute market now supports two separately signed research offers: a
> virtual-server (CPU/RAM/disk) reservation and an AI GPU (CPU/RAM/GPU/VRAM)
> reservation. Customers pay with a **separately pre-funded, non-transferable
> GOV-LAB test balance**, with locked escrow, anti-overbooking, dual-signed
> usage agreement and unused-balance refunds. Independently signed test rounds
> can distribute pre-funded GOV-LAB rewards to participating validators. The
> previous DEV-CREDIT compute job accounting is preserved unchanged.
> **No real governance token exists, no VPS is actually deployed, no GPU is
> exposed, claimed hardware and consensus round finality are not independently
> verified, no real money/ZNYT changes hands, and no public rental is ready.** Run
> `node pq-native/resource-rental-demo.mjs` and see
> [VPS/AI resource rental safety limits](docs/RESOURCE_RENTALS_1_8_20.md).

> **v1.8.19 elastic node participation lab:** the isolated native ML-DSA
> research chain can now start with an arbitrary **genesis committee size of
> four or more** (subject to a byte-bounded genesis and finite hardware), with
> `floor(2N/3)+1` verified validator signatures required. Signed research
> device/compute registration no longer has 128/64 total-node caps; devices
> can leave and rejoin using chain-bound signatures and advancing nonces.
> Local demonstrations ran **7 validators/5 votes** and **14 validators/10
> votes**, with matching durable states on all processes. **Important:** this
> does NOT allow validators to join or leave a running consensus committee:
> membership is fixed at genesis until a safe epoch-change protocol exists.
> The existing four-Besu-validator deployment and bounded WebRTC invitation
> rooms stay unchanged, and this is not live public decentralization.
> Run `node pq-native/network-demo.mjs 4 --blocks 2 --direct-peer --validators 14`
> and see [v1.8.19 architecture and limitations](docs/ELASTIC_NODES_1_8_19.md).

> **v1.8.18 secure single-pass quorum fast path:** the isolated ML-DSA-65
> four-process TLS validator lab can skip *redundant pre-admission HTTP
> requests* while retaining complete signed-transaction and state verification
> on **every** validator before voting. Exact-parent/height/state-root bound
> proposer execution reuse avoids duplicate work; mutated transactions,
> forged state roots and invalid signatures fail closed. Three short localhost
> repetitions measured **~755.5 median fully verified consensus+fsync TPS**
> against **~642.8 TPS** for extra preverification (~18% improvement). This is
> **not 5,000 TPS**, not sustained multi-host throughput and not a deployed
> production network. Run `node pq-native/quorum-benchmark.mjs 512 3 3` and
> read [v1.8.18 full methodology and safety limits](docs/QUORUM_FAST_PATH_1_8_18.md).

> **v1.8.17 private-VPN peer transport lab:** validator processes may now
> opt into **TLS 1.3 with mutual certificate authentication**, pinned
> per-genesis validator certificate SHA-256 fingerprints and fixed private-IP
> peer addresses. Client connections can safely be reused with verified pins.
> The old local-only coordinator, direct loopback mode and every other feature
> remain intact. Disposable OpenSSL tests confirm four independently executing
> ML-DSA validators agree and that a swapped CA-signed peer certificate is
> rejected. A short one-machine 1,536-transfer test measured **~538 TPS** for
> four-validator preverification + signed consensus + fsync, still nowhere near
> verified 5,000 sustained public network TPS. The secure transport itself
> still uses **classical** certificates, and no independent remote hosts or
> production network were launched. Run
> `node pq-native/private-peer-demo.mjs 512 3` and consult the
> [private peer setup and limits](docs/PRIVATE_TLS_VALIDATOR_PEERS_1_8_17.md).

A resale-ready **local/private EVM L1 developer kit** built on Hyperledger Besu 26.9.0 + QBFT. It includes four
validators, a local explorer, MetaMask onboarding, an internal development faucet, helper scripts, sample security
modules, release packaging, buyer documentation, and GitHub Actions full-stack verification.

> **Security status:** unaudited developer starter kit. It is not a finished public mainnet. The bundled faucet key is
> a deliberately public local-development identity and MUST NEVER receive real assets.

## Prerequisites

- Docker Desktop / Docker Engine
- Docker Compose v2 (`docker compose`)
- Python 3
- `curl`
- macOS/Linux: Bash
- Windows: Git Bash or WSL (Windows 11 + Docker Desktop/WSL2 recommended)

## Fast start

### macOS

Double-click `START.command`, or run:

```bash
./scripts/start.sh
```

### Linux

```bash
./scripts/start.sh
```

### Windows

Double-click `START.bat`. It uses Git Bash when available and falls back to WSL.

After startup, open **http://127.0.0.1:8080**.

## What starts

- 4 Besu QBFT validators on the private Docker network
- Host-bound JSON-RPC: `http://127.0.0.1:8545`
- Explorer + faucet UI: `http://127.0.0.1:8080`
- Faucet API: internal Docker service, proxied only through the explorer

Validator P2P ports and validator RPC interfaces other than node1 are not published to the host by default.

## Network defaults

- Chain ID / network ID: `9127` / `0x23a7`
- Native currency label: `ZNYT` (development label only; no public ERC-20 address)
- Consensus: QBFT
- Validators: 4
- Block target: 1 second
- Zero base fee devnet: enabled
- Shanghai EVM rules: active from genesis
- Block gas limit: 30,000,000
- Faucet: 100 ZNYT/claim, 60-second per-address cooldown by default (Docker/dev). The live box primary (`scripts/start-replit.mjs`) runs 10 ZNYT/claim with a persisted rolling 24 h cooldown per address and per client IP (`FAUCET_IP_COOLDOWN_MS`, `FAUCET_STATE_FILE`; salted IP hashes only).

The source QBFT genesis uses Besu's required Istanbul/QBFT mixHash and is validated before startup.

## Commands

```bash
make doctor     # preflight Docker/tools/localhost ports
make start      # preserve existing chain state, start, wait for RPC, run smoke test
make init       # regenerate genesis + validator identities
make up         # start containers
make smoke      # live RPC/validator/peer test
make status     # show core RPC status
make validate   # validate generated/static configuration
make test       # offline package/unit tests
make logs       # follow container logs
make reset      # remove local chain state and generated identities
make package    # build a clean resale ZIP + SHA-256 file
```

## Prefund a wallet

Copy `.env.example` to `.env`, set `FUNDED_ADDRESS`, then initialize the network. The default faucet account is also
prefunded automatically. `FAUCET_PRIVATE_KEY` and `FAUCET_ADDRESS` are validated as a matched local-dev pair at faucet
startup, so a mismatched configuration fails closed instead of silently funding the wrong account.

## Explorer and wallet onboarding

The included UI shows chain status, latest blocks, peer count, validator count, faucet balance, and wallet connection.
It can add/switch the local ZERONYTH network in an injected EVM wallet. The browser UI avoids inline scripts and
is served with a restrictive Content Security Policy.

## Multi-chain Transaction Shield (experimental, read-only)

The explorer now includes a **local, manual decoded-transaction preview** for EVM chains, BNB Smart Chain,
ZERONYTH L1, Solana, and Bitcoin. Click **Load example** on the Security Lab panel, then **Analyze locally**.
For real transactions, provide decoded JSON in the same format as the sample. No paid API or wallet private key is needed.

- **EVM / BNB / ZNYT**: inspect limited known ERC20/BEP20 transfers, approvals, NFT operator changes, chain IDs,
  and user-specified recipient differences. All other calldata remains *unverified*.
- **Solana**: inspect a subset of **already parsed** System Program/SPL Token instructions. Raw/versioned message
  decoding, lookup tables, CPI effects, and RPC simulation are not implemented.
- **Bitcoin**: inspect **already decoded** PSBT inputs/outputs, satoshi totals, fees, and labelled change outputs.
  PSBT binary decoding, script/address checksum validation, and verification of change ownership are not implemented.
- EIP-712 payloads are **flagged for manual review**, not fully decoded or authenticated.

The preview is **not** an anti-phishing browser extension, RPC simulation, mempool monitor, live wallet interceptor,
transaction blocker, quantum-resistant signature conversion, security audit, or proof a transaction is safe.
Its decision is always `MANUAL_REVIEW_REQUIRED` and unsupported details do not receive a "safe" result.
Never enter seed phrases, secret keys or passwords. See `docs/SECURITY_ROADMAP.md`.

**New in 1.6.0**: Safe EIP-712 `SafeTx` previews now flag `DELEGATECALL`, unexpected targets,
verifying-contract/chain mismatches and nested calldata. Use **Safe attack demo** to see a clearly flagged synthetic
example resembling the class of signing deception used in the 2025 Bybit/Safe incident. This is not independent
verification of wallet signing bytes, nor full Safe `execTransaction` ABI verification.

The new **Guarded Wallet Handoff** panel implements an explicitly requested **ZNYT local-devnet native-coin transfer**.
It requires two matching independently checked recipient fields, a fresh review, a selected wallet account,
correct chain ID (9127), no contract code at destination, empty calldata, and a separate user confirmation checkbox.
Changes to the form, wallet chain, or selected account reset the review; errors block handoff. It calls
`eth_sendTransaction` **only after** the user clicks to open their wallet's own confirmation. No assets are moved by
loading the page, using the scanner, or previewing.

**Critical trust boundary**: this guard only applies to sends originating inside ZERONYTH's UI. It cannot stop
transactions or EIP-712 signatures initiated on other sites, and it cannot verify the wallet's final signed bytes.
The sample L1 is an unaudited private network: do not send real funds to its faucet key. BTC/SOL/EVM/BNB transaction
blocking requires separate wallet-specific integrations and audits; the general scanner remains read-only.

Local engine tests (Node.js 22+):

```bash
node --test tests/security-engine.test.mjs tests/guarded-send.test.mjs
```

## Security-focused examples

- `contracts/QuantumAccount.sol` — guardian recovery with delay and epoch invalidation; owner/guardian role separation,
  plus atomic PQC-key commitment rotation on ownership transfer and recovery.
- `contracts/MEVShield.sol` — domain-separated commit/reveal primitive with cancellation/expiry handling.
- `contracts/PrivateCommitment.sol` — domain-separated commitment registry primitive.
- `pqc/ml_dsa_adapter.py` — optional ML-DSA-65 adapter boundary with no silent classical fallback.

The Solidity examples are pinned to **Solidity 0.8.24**. The faucet uses **ethers 6.17.0** with a checked-in npm lockfile and `npm ci` for reproducible dependency resolution. ML-DSA is not verified by the EVM transaction-authentication
path in this kit, and the commitment contracts are not complete privacy or MEV-protection systems.

## Resale positioning

Sell this as a **developer L1 starter kit, private-chain scaffold, demo/hackathon base, or customization starting
point**. Do not advertise it as audited, quantum-safe, fully private, completely MEV-resistant, or production-mainnet
ready.


## GitHub Actions live verification

This kit includes `.github/workflows/e2e.yml`. On GitHub-hosted Ubuntu runners it is designed to compile the Solidity
examples with pinned solc 0.8.24, generate a fresh four-validator network, boot the complete Docker Compose stack,
verify QBFT progress and peer connectivity, exercise the explorer/RPC proxy, send a real 100 ZNYT faucet transaction,
verify a successful receipt and exact balance delta, enforce cooldown/content-type behavior, and verify the final resale ZIP. The CI runner is fixed to Ubuntu 24.04 and Python 3.13.16; checkout/setup actions are SHA-pinned.

A **green workflow run for the exact commit/tag being sold** is the evidence for a "CI verified" claim. Merely including
the workflow file is not proof that it passed. See `docs/CI.md`.

Useful commands:

```bash
make compile       # pinned Solidity compiler check (Docker required)
make e2e           # live explorer/faucet check after the stack is running
make verify-release
```

Release ZIPs are generated deterministically: identical source content produces an identical ZIP SHA-256. The verifier also rejects generated validator material, unsafe archive paths, symlinks, and missing executable bits.

See `SECURITY.md`, `docs/PRODUCTION.md`, `docs/SELLING.md`, and `LICENSE` (MIT).
