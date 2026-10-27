# ZERONYTH L1 v1.8.28: ML-DSA Native Protocol Laboratory

**Status: experimental cryptographic protocol demonstration, NOT a Besu-compatible L1.**

Existing v1.6 features (Besu QBFT, Solidity/EVM, ZNYT faucet, explorer, Security Lab,
guarded wallet handoff) remain available **unchanged** and **classically signed**.
This directory is an **isolated alternative ledger experiment** and MUST NOT be
misrepresented as native PQ authentication inside the existing Besu network.

## 実装されたもの

- Node.js v24+ 標準暗号実装による **NIST FIPS 204 ML-DSA-65** の鍵生成・署名・検証。
- `qspq_` で始まる実験用アカウントID（ML-DSA公開鍵SPKI-DERのSHA-256コミットメント）。
- 正規化した取引本文への署名、chainId・nonce・宛先・金額の検証。
- ECDSA/Ed25519など非ML-DSA鍵の拒否、署名不正・残高不足・再送の拒否。
- 4バリデーター、ML-DSAで署名されたリーダー提案、3/4の検証済み投票署名。
- 同じブロックと残高を4つの独立した台帳で確定する試験。
- 一時的な秘密鍵を個別ファイルに置く**4つのローカルプロセス**の通信テスト。

## 動かし方

Node.js 24以上が必要です。Node標準の`crypto`が`ml-dsa-65`をサポートして
いることを確認してください。外部npm依存は不要です。

```bash
cd pq-native
node --test test.mjs
node demo.mjs
node network-demo.mjs
node benchmark.mjs --transactions 32 --blocks 10
node network-demo.mjs 1500
node network-demo.mjs 1500 --compact
node network-demo.mjs 1000 --blocks 4 --preverify --compact
node network-demo.mjs 32 --blocks 3 --senders 4 --preverify --compact --parallel-exec --restart-after-first
node network-demo.mjs 512 --blocks 3 --senders 32 --direct-peer --preverify
node network-demo.mjs 4 --blocks 2 --senders 4 --direct-peer --preverify --restart-after-first
node --test direct-peer.test.mjs
node private-peer-demo.mjs 512 3
node private-peer-demo.mjs 512 3 --single-pass
node quorum-benchmark.mjs 512 3 3
node network-demo.mjs 4 --blocks 2 --direct-peer --validators 7
node network-demo.mjs 4 --blocks 2 --direct-peer --validators 14
node --test elastic-membership.test.mjs
node --test private-peer-transport.test.mjs
node compute-market-demo.mjs
node gas-burn-demo.mjs
node --test gas-burn-lab.test.mjs
node unified-znyt-demo.mjs
node --test unified-znyt.test.mjs
node lease-cpu-demo.mjs
node --test lease-cpu-node.test.mjs
node --test hosted-services-node.test.mjs
node --test node-discovery.test.mjs
node --test ai-local-network.test.mjs
node resource-rental-demo.mjs
node --test resource-rental.test.mjs
node --test compute-market.test.mjs block-pipeline.test.mjs
node device-network-demo.mjs
node --test device-registry.test.mjs
node async-order-demo.mjs
node --test async-ordering.test.mjs
node parallel-transaction-demo.mjs
node signature-pipeline-demo.mjs
node signature-pipeline-demo.mjs 4
```

### v1.8.28 — AI chat + ZNYT-LAB-only simulated testnet settlement

- `ai-inference-worker.mjs` runs an allowlisted localhost Ollama model for a
  provider-approved ML-DSA signed AI session, returning a signed output hash.
- `ai-local-session.mjs` requires an independently validated model receipt
  before allowing provider+customer signed ZNYT-LAB settlement. Properly bonded
  research providers can consume a bounded free AI quota with actual responses.
- `ai-local-portal.mjs` and its mobile UI offer separate user/provider modes,
  with admin-only local APIs. Startup:
  `ZERONYTH_AI_ADMIN_TOKEN=<secret> node pq-native/ai-local-demo.mjs MODEL [PORT]`.
- Demo uses ephemeral test-only identities and local balances, **not actual
  testnet coins**. Ollama model execution remains unverified on physical GPUs
  in our build environment. External provider prompt routing is not enabled.
  [Details](../docs/AI_LOCAL_TESTNET_1_8_28.md).

### v1.8.27 — volunteer node opt-in, signed heartbeats, iPhone inventory

- Linux/Node 24 provider agent: `create-provider-key.mjs` then
  `provider-join-agent.mjs /absolute/config.json` with explicit `consent:true`.
- Loopback-only `node-join-coordinator-cli.mjs` validates ML-DSA node-join and
  pulse signatures, independent nonce/chain binding and a 0600 append-only
  enrollment journal. No hard-coded cap on number of registered identities.
- Responsive `/` node dashboard requires a secret admin token to retrieve
  actual node claims; signed receipts never unlock ZNYT rewards, validator
  admission, AI subscriptions or rentable GPUs on their own.
- The host's reported GPU count is **not attestation**. Shares are an opt-in
  capacity proposal and do not yet constrain execution. There is no public
  coordinator endpoint. [Deployment and security notes](../docs/OPT_IN_NODE_DISCOVERY_1_8_27.md).

### v1.8.26 — provider-hosted Docker sandbox, GPU lease and Ollama adapter

- `HostedServicesNode` adds ML-DSA signed VPS container creation, allowlisted
  NVIDIA GPU device assignment and bounded local Ollama model invocation.
  Provider permits bind a renter, chain, rental, service and expiry. Renter
  signed requests have monotonic nonces; receipts bind resource and output.
- The optional `znyt.requireExecutionProof` accounting path accepts a valid
  hosted creation or AI generation receipt, then still needs independent
  provider/customer metering signatures to release simulated ZNYT-LAB.
- Docker must be operator-configured with pinned local images, Linux rootless
  mode and cgroup v2/systemd. No Docker, GPU or Ollama exists in this build
  environment, so **tests mock those backends**, without claiming physical
  hardware execution or real ZNYT / VPS service.
  [Full operation guide](../docs/HOSTED_VPS_GPU_AI_1_8_26.md).

### v1.8.25 — signed node-provider CPU work over real local sockets

- A dedicated `LeaseCpuNode` accepts provider-issued lease permits and
  customer-signed deterministic CPU work orders, enforces signed job quotas
  and anti-replay bounds, runs real SHA-256 work in a bounded worker thread,
  and signs a verifiable result. The JSON HTTP listener binds **only** to
  `127.0.0.1` and does not execute untrusted code or instantiate VMs.
- In opt-in ZNYT-LAB mode with `requireExecutionProof:true`, a research VPS
  reservation cannot be paid out until the market verifies a signed CPU
  result bound to that rental. Both parties must still approve the usage.
  **ZNYT-LAB remains simulated, and this does not constitute real VPS hosting
  or production billing.** [Safety guide](../docs/LEASE_CPU_NODE_1_8_25.md).

### v1.8.24 — one ZNYT-LAB test ledger for fees, rentals and rewards

- `ComputeMarket({ ... }, {znyt:{allocations,...}})` now debits the **same
  explicitly allocated experimental ZNYT-LAB balance** for VPS/AI-GPU
  bookings and validator-signed hypothetical gas charges. The charged
  amount is split into 20% simulated burn and 80% network reward pool.
  Quorum-approved validator rewards draw from that pool first, then from a
  prefunded reserve if present. These are all transfers within one
  conserved laboratory ledger, **not issuance or destruction of real ZNYT**.
- Existing signed free mock AI quota for active bonded node providers is
  unchanged. No actual ZNYT gas protocol, on-chain governance, real VPS
  provisioning or AI inference is implemented. Existing separate research
  demos remain accessible for backward compatibility.
  [Unified scope and detailed accounting](../docs/UNIFIED_ZNYT_1_8_24.md).

### v1.8.23 — 20% simulated gas-fee burn, 80% network reward pool

- New independent `GasBurnLab` with chain-bound, nonce-protected payer
  authorization, validator quorum attestation of hypothetical gas usage,
  fee/usage upper bounds, configurable 0–100% burning (20% default), exact
  supply accounting, burned cumulative amount and network fee pool.
- Full fee accounting is **not** wired into the existing native transfer
  execution or the ECDSA Besu devnet: neither currently charges real
  protocol gas. `zeroBaseFee: true` remains unchanged. Existing DEV-CREDIT
  and GOV-LAB accounting remain unaffected.
- This research model differs from Ethereum's EIP-1559, which burns its
  **base fee**, not an arbitrary fixed 20% of all fees. No live token is
  destroyed. [Scope, tests and future protocol requirements](../docs/GAS_FEE_BURN_1_8_23.md).

### v1.8.22 — signed AI access entitlement for active node providers

- All active, previously bonded and capacity-attested native server/desktop
  compute providers may obtain basic free research AI usage entitlement.
  No AI-training resource share is necessary for basic eligibility.
- `aiProviderAccess(address)` reports eligibility and the remaining simulation
  quota; `requestProviderAi(signedRequest)` consumes one mock request only
  after chain-bound ML-DSA verification, advancing nonce, unique request ID,
  active availability and limit checks.
- The default research budget is 20 mock AI access requests per ten simulated
  heights. No GOV-LAB is charged to the node provider for this entitlement;
  enrollment alone grants no real inference/AI chat access.
- No actual model completion, inference service, authenticated public endpoint
  or persistent multi-host quota ledger has been implemented.
  [Scope and deployment requirements](../docs/NODE_PROVIDER_AI_ACCESS_1_8_22.md).

### v1.8.21 — signed L1 / generative AI / VPS-GPU resource split

- Each opted-in bonded compute node may ML-DSA-sign a CPU/RAM percentage
  budget for **future** L1 preverification and relay, and another signed budget
  for **future** community AI model building (CPU/RAM and theoretical GPU duty
  cycle). Suggested voluntary allocation: **20% L1, 20% AI, 60% unreserved**.
- Both shares may be changed with advancing signed nonces and bounded expiry.
  Shared resources cannot overlap existing rental reservations, legacy hash
  work, or a competing resource share. A whole-GPU rental cannot overlap a
  fractional AI-GPU claim on the same last available GPU.
- Resource discovery/status APIs report offered CPU millicores, RAM MiB,
  GPU-thousandths, and the remaining nominal rental percentage.
- No remote L1 accelerator, independently verified worker, GPU time-slicer,
  actual generative-AI training or TPS increase is implemented by pledging a
  resource budget. Validator quorums and independent full verification do not
  change. [Safety and next milestones](../docs/CHAIN_AI_RESOURCE_SPLIT_1_8_21.md).

### v1.8.20 — private VPS, AI GPU and validator GOV-LAB rewards (simulation)

- Signed `vps` and `ai-gpu` offers from bonded, validator-countersigned, online
  native compute providers; bounded CPU, RAM and claimed disk/GPU/VRAM terms.
- Independent customer-signed reservations escrow **pre-allocated, non-transferable
  GOV-LAB research balances**, separate from the old DEV-CREDIT compute jobs;
  overbooking of a provider's claimed CPU/RAM/GPU capacity is rejected.
- Usage is billable only when both customer **and** provider sign matching
  meter reports after elapsed research block slots. Unused simulated credits
  are refunded; cancellation before a slot passes and automatic timeout
  refunds are also implemented. Accounting supply is checked after settlement.
- Genesis-validator identities may sign a matching **mock round ID**, after which
  the participating signers share a fixed rate of GOV-LAB from an explicitly
  pre-funded, conservation-checked reserve. This is **not** proof of actual
  network consensus work or real governance-token issuance.
- **No actual virtual machine is started, no rented GPU is executed, no client
  isolation or verified hardware metering exists, and no real governance token/ZNYT
  rewards are paid.** No public endpoints/deployment are activated.
- [Implementation, testing and required production controls](../docs/RESOURCE_RENTALS_1_8_20.md).

### v1.8.19 — configurable consensus committee and uncapped research registration

- Native research genesis committee can contain **four or more** authentic,
  distinct ML-DSA validators; all block/order/compute attestation certificates
  require `floor(2N/3)+1` independent signatures. Seven and fourteen locally
  communicating validator processes agree using five and ten signed votes.
- Research device and DEV-CREDIT provider registries remove former 128/64
  overall enrollment caps. Signed leave/rejoin and incremental listing are
  added; strict authorization, resource budgets and award checks remain.
- This is NOT permissionless runtime validator admission: the validator set is
  fixed within a genesis and does not support safe membership epoch changes.
  Besu's four-node QBFT network and browser room size limits remain intact.
- [Complete implementation scope and multi-node safety caveats](../docs/ELASTIC_NODES_1_8_19.md).

### v1.8.18 — four-validator independently verified single-pass quorum

- `--single-pass` in the mutually authenticated TLS four-process demo avoids
  an extra standalone `/preverify` HTTP round trip to every validator, while
  retaining all four validators' full ML-DSA-signed transaction verification,
  independent account/nonce/state-root checks, anti-equivocation vote journals,
  signed 3-of-4 quorum certificates and four durable block commits.
- The proposer can reuse only its exact, fully verified signed batch candidate
  with matching parent, height and state root. Stale or modified proposals fail.
  Original explicit preverification remains the default.
- Three localhost runs per path measured ~642.8 extra-preadmission median TPS
  and ~755.5 single-pass median TPS (~18% higher). This excludes sequential
  client signing and is not sustained 5,000-TPS distributed chain capacity.
- [Methodology, complete security boundaries and performance limitations](../docs/QUORUM_FAST_PATH_1_8_18.md).

### v1.8.17 — authenticated private VPN transport laboratory

- Keep the direct-peer four-validator ML-DSA protocol, but optionally enable
  per-node **private-address** TLS 1.3 transport with mutual client certificates,
  CA verification, peer SAN verification and exact SHA-256 fingerprint pinning.
  Four fixed genesis-ordered identities and all-four commit acknowledgements
  remain mandatory; TLS cannot replace ML-DSA consensus verification.
- `ZERONYTH_PQ_REMOTE_CONFIG_PATH` selects an owner-only config file with the
  four private endpoints and TLS credentials; each is read through a bounded,
  symlink-resistant owner-only descriptor. Reject public addresses, duplicates,
  incorrect pins, wrong genesis roles and changed certificates.
- An OpenSSL-backed disposable demo validates four separately running TLS peers
  plus malicious swapped peer pins without exposing secrets. Real four-host WAN
  latency is untested. A short localhost trial achieved **~538 fully locally
  admitted/committed tx/s** with TLS connection reuse; a 5,000 TPS distributed
  network still does **not** exist.
- [Full configuration, benchmark and security limitations](../docs/PRIVATE_TLS_VALIDATOR_PEERS_1_8_17.md).


### v1.8.16 — opt-in direct four-validator loopback peer consensus

- The rotating proposer can send the complete signed block directly to the
  other three localhost validator processes; each independently checks the
  full state, fsync-records its ML-DSA vote and commits only upon a genuine
  three-validator quorum certificate. All four durable commit receipts must
  converge, including after node restart and replay.
- The mode uses **strict loopback-only 127.0.0.1 networking**, disabled by
  default. It is not internet-wide P2P, a fault-tolerant public network, or
  authenticated remote validator transport. Browser P2P and Besu remain
  separate, unchanged features.
- A 1,536-transfer short sample measured ~609.8 validator-admission + local
  consensus + fsync TPS, including ML-DSA verification on all four processes;
  the preceding coordinator measured ~597.6 under similar one-off conditions.
  Single-run noise means **no stable acceleration has been established**.
- [Direct validator peer architecture and measurements](../docs/LOOPBACK_VALIDATOR_PEERS_1_8_16.md).


### v1.8.15 — CPU-aware bounded parallelism and replay-key fast path

- Default research worker count is now 1–4 per pool based on reported CPU
  parallelism; a two-core VPS uses two, while larger hosts may use four.
  Both signature and execution worker counts remain explicitly adjustable
  from 0 to 8. The in-batch replay key uses the already verified sender+nonce,
  avoiding a redundant signed-transaction hash while preserving every nonce
  and ML-DSA verification invariant.
- The optional timing demo accepts a worker count (e.g. `4`), reports
  verification/execution versus state WAL fsync time, and rejects divergent
  state roots. Three short nine-CPU localhost runs saw median ~6,197 executed
  tx/s with four workers. **This is not real network/consensus TPS**.
- [CPU_FAST_PATH_1_8_15.md](../docs/CPU_FAST_PATH_1_8_15.md).

### v1.8.14 — fast-path ML-DSA verification and one-order lookahead

- Bounded CPU verification workers independently check complete ML-DSA-signed
  transaction bytes before the state engine sees a positive cache entry. Exact
  signed nonce/value and sender are also checked on worker replies. Execution
  workers and the canonical serial-state oracle now overlap in time, and a
  future certified order's signatures may be verified while the current
  order executes. **Future balances/finality never advance early.**
- Warm workers explicitly with `await lab.prepareExecution()`, or let the
  laboratory start them lazily. Use `signatureWorkers:0` or
  `prefetchSignatures:false` for controlled comparisons.
- Three short local 1,536-transfer trials measured a median ~4,882 executed
  tx/s for warmed prefetch versus ~3,411 serial, with exact matching roots.
  This is **not a deployed P2P/Besu/EVM throughput result** or 5,000 TPS.
- See [SIGNATURE_PREFETCH_1_8_14.md](../docs/SIGNATURE_PREFETCH_1_8_14.md).

### v1.8.13 — transaction-level conflict-aware parallel workers

- The **isolated** native asynchronous execution lane now supports two lazy,
  bounded CPU workers when a certified order contains at least 32 signed
  transfers. Shared sender/recipient accounts remain sequential; disjoint
  components can execute in parallel, and a separate full serial-state root
  check is mandatory before committing state. Use `parallelWorkers:0` to
  disable this in the local lab, or configure 1–8.
- The timing demo measures serial versus parallel *execution-only*, checks
  roots, and documents that worker overhead may make small batches slower.
  Real 5,000 TPS, generalized EVM concurrency and P2P BFT are **not proven**.
- See [PARALLEL_TRANSACTIONS_1_8_13.md](../docs/PARALLEL_TRANSACTIONS_1_8_13.md).

### v1.8.12 — ordering-first and changed-account state journal (opt-in)

- A **separate local experiment** can advance a 3-of-4 ML-DSA-certified
  ordering height while delaying signed transaction execution and balance
  changes. Both the ordering log and the changed-account state WAL are
  owner-only, exclusive-lock and fsync-protected. Recovery re-executes every
  executed certified order and cross-checks roots; hash-chain verification
  alone is intentionally not trusted.
- The demo certifies five ordering heights, executes three, restarts the lab,
  and executes two more with the expected balance. It transfers no real asset.
- **Not production BFT, fast EVM database, live validator P2P or proven higher
  executed TPS.** A certified invalid transaction deliberately halts the
  execution lane, and robust network view-change remains unimplemented.
- Full boundaries: [ASYNC_ORDERING_1_8_12.md](../docs/ASYNC_ORDERING_1_8_12.md).

### v1.8.5 PC / server / phone / tablet participation lab

- All four classes can sign a research node identity and voluntarily report
  availability. Phone and tablet light/relay roles are short-lived, foreground
  sessions; no always-running mobile validator is claimed.
- The optional device-aware scheduler checks short job size, battery, temperature,
  charging, network and foreground before assigning Android compute test work.
- Apple devices are restricted to light/relay roles; no on-device crypto mining.
  The all-platform client and decentralized P2P network are **not yet built**.
- See [MULTIDEVICE_NODES.md](MULTIDEVICE_NODES.md) for OS restrictions and
  future native app / real contribution-proof requirements.

### v1.8.4 node leasing / reward proof-of-concept

- Existing Besu wallet/faucet/Security Lab remains untouched.
- New ML-DSA-65 **provider registration + three-validator signed resource claim**
  research module; test credits are funded by genesis, with provider stake,
  escrow, job verification, refunds and reward splits. `audit()` verifies
  no credits were created during simulation.
- Research-only `BlockAdmissionPipeline` retains up to **10 candidates** for
  asynchronous signature checks, but commits them **strictly one by one**
  after validating proposer, parent, state root and 3/4 validator votes.
- **No real provider hardware is measured.** The example recomputes a bounded
  local hash job and does not execute work on a remote node or Linux VPS.
  It does not pay actual tokens or define real validator financial incentives.
- Full limitations and required next steps are in [NODE_REWARDS_DESIGN.md](NODE_REWARDS_DESIGN.md).

`network-demo.mjs` はループバック `127.0.0.1` だけで4プロセスを起動し、
テスト用鍵をOSの一時フォルダに作成してから終了時に削除します。秘密鍵を
画面やZIPに書き込みません。公開アクセスには設定できません。

### v1.8.3の安全性と性能上限

- ブロック1個あたりの最大取引数 **1,536件**、正規化した取引データ上限 **16MiB**。
- 有効なML-DSA公開鍵だけを最大1,024件キャッシュ。
- 正確な署名・公開鍵・chainId・金額・宛先・nonce等を含む**取引全体の
  正規化バイト列**に限り、各ノードが自分で検証した署名の肯定結果を最大
  3,072件だけキャッシュ。キャッシュ命中でも残高・nonce・再送・block state
  rootは必ず再検証。取引内容や署名の1文字を変えた場合は完全に再検証。
- **同じブロック本文・提案署名・チェーン先頭**に限り、ブロック提案の
  検証結果を再利用。親ブロック確定後は破棄。
- 各ローカルバリデーターは投票スロットとブロックハッシュをディスクに
  `fsync` で書き出してから署名。再起動後に同じスロットの異なるブロックへ
  投票することを拒否。投票記録は暗号鍵ではないが秘密鍵と同じホストのため
  外部改ざん防止機構の代用にはなりません。
- 1〜8個の専用CPUワーカーでML-DSA署名を独立に検証可能（ローカルAPIの
  `ZERONYTH_PQ_VERIFY_WORKERS`、既定2）。不正署名は拒否。単なる不正取引で
  ワーカーを永久停止しない。一方、ワーカーが破損・タイムアウトすれば
  安全側で並列検証を停止し、検証省略による継続はしない。
- `--preverify` は4ノードで独立した署名の事前検証を実行する。
  これはメンプール入場確認だけで、送金成立や投票とは無関係。
- `--compact` は全ノードで**フルブロックを先に受信・署名検証**した後、
  署名付きの投票・確定をブロックハッシュ参照で進める。ステージ未検証の
  ブロックをハッシュだけで確定することはできず、競合ブロックは拒否。
- `--blocks 4` などでリーダー交代・nonce連続性も含む多ブロック試験。
  署名事前検証時間、提案・配信・投票・確定時間を分離して記録し、
  事前検証をTPS計算から都合よく除外しない。
- バリデーターごとに、確定前にML-DSAの3/4承認を検証し、完全なブロック
  と証明書を**fsync付きの追記ログ**へ書いてから残高に反映。再起動すると
  全ブロックを暗号学的に再検証して残高とnonceを復元。ログは最大512MiB、
  所有者専用アクセス、同じログへの二重起動は禁止。
- 不完全なログ、別チェーンのGenesis、改ざんされた署名・状態rootは
  復旧を拒否。予期せぬクラッシュ時はロックファイルが残るため、
  **原因とログを人間が点検してから**ロック解除が必要。
- `--parallel-exec` は独立した送金元・送金先の集合だけをCPU並列実行。
  残高・nonceに依存関係のある取引は同じスレッド内で元の順番を維持。
  **全件の逐次実行結果と状態rootを照合する保守的な実験モード**であり、
  簡単な送金ではワーカー起動によって速度が下がることもある。
- `--senders 4` は複数の独立口座を使う負荷試験、
  `--restart-after-first` は全4ノードを再起動し永続ログから復元後に取引継続。
- `benchmark.mjs` は本物のML-DSAを実行しますが、**単一ホスト内の研究用数値**。
  ネットワークTPSやEVM性能に読み替えてはなりません。
- 目標 **5,000 TPS**・300msブロック・強制ML-DSA署名の達成には、実際の
  EVMクライアント改修、高速BFT、並列実行、永続データベース、複数独立ホストが必要。

### v1.8.2のローカル実測（過去版の比較値）

| 試験 | 本物の署名付き取引 | 実測 | 意味 |
| --- | ---: | ---: | --- |
| 単一ブロック・コンパクト参照 | 1,500件 | 約601 TPS | バリデーター4プロセス、1ブロック確定、クライアント署名時間は別計上 |
| 4ブロック・並列事前検証・コンパクト参照 | 4,000件 | 約581 TPS | 4バリデーターで署名検証から合意まで含めたローカル複数ブロックの処理率 |
| 4ブロック・クライアント署名も含む全体 | 4,000件 | 約351 TPS | 上記に送金者側の署名時間も含めた1台のPC上での値 |

v1.8.3ではfsync付きブロック永続化と逐次照合が追加されたため、上記の
過去版の数値をそのまま新バージョンのスループットと呼べません。
v1.8.3の同じ4プロセス・4ブロック・4,000件、署名事前検証と永続保存込みの
実測値は **約507 TPS** でした（クライアント側署名時間は別計上）。
実機CPU・ブロック構成・同時負荷で数値が変わり、いずれも独立運用の
分散ネットワークTPSや **5,000 TPS達成証明ではありません**。

## 取引と検証ルール（実験仕様）

1. 取引は `kind, chainId, nonce, to, value, memo, publicKey` の順に
   JSON UTF-8で正規化し、`ZERONYTH_MLDSA_TX_V1` によるドメイン分離付きで署名。
2. 署名は `ML-DSA-65` の3309バイトでなければ失敗。公開鍵はDER-SPKIとして
   ML-DSA-65型であることを検証。暗黙のECDSAフォールバックなし。
3. 送信者アカウントは公開鍵から導出。`chainId`、正確な`nonce`、送金額、
   宛先を検証。浮動小数点と不明な取引フィールドは拒否。
4. 送金手数料は研究用のゼロ。ガス・EVM命令は扱いません。
5. リーダーは4バリデーターの固定順。ブロックヘッダーとリーダー署名を
   全ノードが検証した後、同一ハッシュに3つ以上の一意なML-DSA投票があれば
   台帳へ反映します。同一バリデーターの同ラウンド二重署名は禁止。

## 重大な制限

**この実装をメインネットに使わないでください。**

- Besuの署名処理、EVMの送信元認証、QBFTブロックシールには**一切組み込まれていません**。
- 4台は同じPC上の独立プロセスであり、独立運営のバリデーターではありません。
- 通常のHTTPモードはlocalhost限定・TLSなし。v1.8.17のオプションで
  相互TLS＋証明書固定によるプライベートIP間の直接通信は可能ですが、
  公開P2P参加・自動ノード発見・本格同期やビュー変更は未実装です。
- ブロックは研究用ログに保存・検証付き復元できますが、**チェックポイント・
  履歴圧縮・プロダクション級DB・クラッシュ後自動ロック解放は未実装**。
- タイムアウトとラウンド切替、ビュー変更、フォーク解決、**本格的な
  メンプール**、DoS耐性、動的バリデーター集合、バリデーター罰則なし。
- 高速BFTの安全なリーダー交代は[設計と必須条件](BFT_SAFETY_DESIGN.md)を
  定義しただけで、有効化していません。
- 実運用で必要なウォレット鍵管理、ハードウェア保護、監査、手数料、
  Solidity実行は未実装。`qspq_` IDは既存EVMアドレスと相互交換できません。
- 暗号アルゴリズムの部分的な耐量子性は、ネットワーク全体の耐量子性を証明しません。

## v1.8完了まで残る必須課題

1. Besu実行クライアントのソースをフォークして、新しい取引エンベロープ、
   ML-DSA認証、ガス計算、EVM `msg.sender` との対応を実装する。
2. ネイティブQBFT投票署名とvalidator/node ID生成をML-DSA対応へ改造し、
   **既存ECDSAシールを全ノードが拒否**するプロトコルルールを導入する。
3. 専用PQウォレット/Faucetに切り替える。現行MetaMask/ethersによる
   従来署名は新しい厳格なPQチェーンでは使えない。
4. 4つの**別運用ホスト**で実クライアントを動かし、障害・安全性・
   競合ブロック・再同期・TPS/署名サイズ/レイテンシーを実測する。

NIST原典: https://csrc.nist.gov/pubs/fips/204/final

**v1.7署名検証 + v1.8ローカル4プロセス署名承認のPoCを達成。
Besu統合版v1.8の完了判定には至っていません。**
