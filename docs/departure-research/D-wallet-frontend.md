<!-- Published copy of the project engineering record. Internal workspace paths were rewritten to this repository's layout (besu-912701/ = reconstructed production source tree, docs/ = deliverables). -->

# D — dApp Frontend + Wallet Integration Without Ethereum Tools

**Scope given:** ZERONYTH is a private, non-Ethereum chain. No MetaMask, no ethers/web3.js assumptions. Accounts use Falcon-1024 / ML-DSA-65, which no Ethereum wallet can sign. The client and wallet are built from scratch. This note maps what proven non-Ethereum stacks actually do, and what to copy.

## 1. Polkadot model: metadata-driven, generic clients

The core idea is that the chain describes itself. Polkadot-API (PAPI) requires runtime metadata version >=14, fetched via `Metadata_metadata_versions` / `Metadata_metadata_at_version` (fallback `Metadata_metadata`), plus `AccountNonceApi_account_nonce`, `TaggedTransactionQueue_validate_transaction`, `TransactionPaymentApi_query_info` for fees, and the `System.Version` constant with `spec_version` / `transaction_version` — https://papi.how/requirements/

That metadata enumerates pallets, calls, storage, events, constants and errors, all SCALE-encoded. The Polkadot protocol spec defines `Metadata_metadata` as returning "all the information necessary to build valid transactions" — https://spec.polkadot.network/chap-runtime-api

Clients therefore need no chain-specific code:

- **PAPI (TypeScript):** `papi add` downloads metadata and generates descriptors; `createClient(provider)` then `client.getTypedApi(descriptors)` yields a fully typed `tx.*`, storage and events API for *that* chain — https://papi.how/getting-started/ and https://papi.how/typed/tx/
- **subxt (Rust):** `subxt metadata > metadata.scale`, then `#[subxt::subxt(runtime_metadata_path = "metadata.scale")]` generates a strongly-typed Rust API at compile time, with generated types deriving SCALE `Encode`/`Decode` — https://docs.polkadot.com/reference/tools/subxt/ and https://docs.rs/subxt/0.38.0/subxt/book/setup/codegen/index.html
- **Polkadot.js extension pattern:** dApps call `web3Enable(appName)`, list `web3Accounts()`, get an injector via `web3FromAddress(address)`, and pass `injector.signer` to `signAndSend` — the extension, not the dApp, holds keys and shows the approval popup — https://polkadot.js.org/docs/extension/usage/

**Light client — smoldot.** PAPI offers two first-class providers: WebSocket to an RPC server, and a Smoldot provider connecting to a local light client — https://papi.how/providers/ . subxt documents the same pattern: its light-client interface "uses Smoldot to connect to a *chain*, rather than an individual node" so "you don't have to trust a specific node," requiring only a trusted chain spec — https://docs.rs/subxt/0.34.0/subxt/book/usage/light_client/index.html . Smoldot itself is described as a "byzantine-resilient" light client that "does not rely on the presence of an RPC server, but directly connects to the full nodes" — search result via npm package page, see References.

**What this buys ZERONYTH:** Publish one canonical, versioned metadata artifact (calls, storage, events, signed extensions, contract ABIs) and generate TS/Rust clients from it. Runtime upgrades, new transaction types (e.g. 0x7E Falcon / 0x7F ML-DSA, per project facts), and fee rules propagate by regenerating descriptors, not by hand-editing every dApp. A light-client provider removes RPC trust — valuable for a private chain where RPC operators are few.

## 2. ink! v6-era frontend: contract metadata JSON is the ABI

ink! v6 is a breaking move from `pallet-contracts` + Wasm to `pallet-revive` + RISC-V / PolkaVM, and requires `cargo-contract >= v6` — https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/

`cargo contract build` emits three artifacts: the raw binary, a metadata `.json` ("which contains the contract's ABI"), and a `.contract` bundle combining both — https://use.ink/getting-started/building-your-contract . Use.ink is explicit: without metadata "it's not possible to know what this bytecode refers to"; the `.json` "is used by e.g. a dApp user interface to know how to communicate with the on-chain contract," and its `spec` stores constructors and messages.

Frontend flow, two generations of tooling, same shape:

1. **Classic:** `new ContractPromise(api, metadataJson, address)` wraps the ABI; `contract.query.<message>(caller, {gasLimit}, ...args)` dry-runs via RPC, `contract.tx.<message>(...).signAndSend(address, {signer})` submits — https://polkadot.js.org/docs/api-contract/start/contract.read
2. **PAPI / ink! SDK:** `pnpm papi ink add ./flipper.json` (or `.contract`) generates typed contract descriptors; `createInkSdk(client)` then `getContract(descriptors, address)` / `getDeployer(descriptors, code)` gives typed deploy/call APIs supporting both `pallet-contracts` (v5) and `pallet-revive` (v6+) — https://papi.how/sdks/ink-sdk/

Signing never changes: the dApp builds a typed call from metadata, hands a signer payload to the injected extension signer, the user approves in the wallet UI, and the client broadcasts. Queries are unsigned dry-runs.

**For ZERONYTH:** Ship every contract with a versioned metadata JSON + a portable type registry (ink! metadata flattens a `PortableRegistry` of all referenced types alongside `spec` and storage `layout`). Generate TS bindings at build time (`papi ink add`-equivalent). Do not let frontends hand-roll SCALE/ABI encoding — that is where PQ-sized arguments (Falcon pubkeys ~1,793 B, signatures ~1,330 B; ML-DSA-65 larger) will break ad-hoc code first.

## 3. Solana: the wallet-stack reference to copy

Solana never had MetaMask to lean on, so it standardised discovery and signing:

- **Wallet Standard (chain-agnostic):** Wallets dispatch a `register-wallet` event and listen for `app-ready`; apps do the reverse, so "multiple wallets can register and dApps can list them without hardcoding one extension API" — https://docs.phantom.com/developer-powertools/wallet-standard . The Anza reference guide shows a wallet wrapping its existing API, calling `registerWallet(...)` / `initialize(wallet)`, after which "this is all dapps need to detect and use it" — https://github.com/anza-xyz/wallet-standard/blob/HEAD/WALLET.md
- **Wallet Adapter (app side):** React apps wrap `<ConnectionProvider endpoint><WalletProvider wallets autoConnect><WalletModalProvider>` and consume `useWallet()` — `publicKey, connected, select, connect, disconnect, signTransaction, signAllTransactions, signMessage, sendTransaction` — https://solana.com/nl/developers/guides/wallets/add-solana-wallet-adapter-to-nextjs
- **Phantom-class UX patterns worth copying:** (a) connect = origin-scoped account authorisation, not a transaction; (b) one modal listing all discovered wallets; (c) `autoConnect` silently restoring the last session; (d) distinct `signTransaction` (return signed bytes) vs `signAndSendTransaction` (wallet broadcasts) vs `signMessage` (off-chain auth / SIWS); (e) feature detection per account — Phantom notes `solana:signTransaction` and `solana:signAndSendTransaction` are separate features to check before calling — https://docs.phantom.com/developer-powertools/wallet-standard ; (f) Mobile Wallet Adapter for app-to-app signing on a phone, the analogue ZERONYTH needs for mobile PQ wallets.

- **Versioned transactions / ALTs — relevant, with a caveat:** v0 transactions reference on-chain Address Lookup Tables by 1-byte index instead of a full 32-byte address, raising the cap from ~32 to 256 addresses per transaction, because "each address can be referenced … by its 1-byte index … instead of their full 32-byte address" — https://github.com/bji/solana/blob/HEAD/docs/src/developing/lookup-tables.md and https://docs.phantom.com/solana/sending-a-transaction-1 . For ZERONYTH the lesson is inverted: PQ pubkeys/signatures are *far* larger than Ed25519, so a versioned format from day one, explicit size budgets, and indirection (address = hash of PQ pubkey, pubkey supplied once / registered on-chain and thereafter referenced by index or account id) are not optimisations — they are survival.

## 4. Sui and Aptos: proof a second generation could standardise cleanly

**Sui:** "Every self-custodial wallet compatible with Sui implements the Wallet Standard, which means Sui dApp Kit and other apps can discover and connect to them automatically, without any wallet-specific code" — https://docs.sui.io/onchain-finance/asset-custody/wallets/self-custody . Its wallet standard defines namespaced features — `standard:connect`, `standard:events`, `sui:signTransaction`, `sui:signAndExecuteTransaction`, `sui:signPersonalMessage` — and registration via `registerWallet(new YourWallet())`, discovery via `getWallets().get()` — https://docs.sui.io/onchain-finance/asset-custody/wallets/wallet-standard . dApp Kit 2.0 splits a framework-agnostic `@mysten/dapp-kit-core` (`createDAppKit`, `DAppKitProvider`) from React bindings with a ready `ConnectButton` — same source as above, self-custody page.

**Aptos:** AIP-62 does the same standardisation: wallets implement `AptosWallet`, register with `registerWallet` from `@wallet-standard/core`, dApps detect them with `getAptosWallets()` and use required features `aptos:connect`, `aptos:signAndSubmitTransaction`, etc., with `UserResponse<T>` making user rejection a typed outcome — summarised at https://socket.dev/npm/package/@aptos-labs/wallet-standard (npm mirror of `@aptos-labs/wallet-standard`). Aptos docs confirm that with AIP-62, "dapps can simply update their version of `aptos-wallet-adapter` to connect to newly added Wallet plugins" — https://aptos.dev/build/sdks/wallet-adapter/browser-extension-wallets

**Feasibility proof:** Two unrelated L1s shipped, within ~2 years, a single discovery + feature-namespace standard that made *new wallets a non-event for dApps*. ZERONYTH, with exactly one chain and initially one wallet, can adopt the shape on day one at near-zero cost — and will pay heavily if it retrofits it later.

## 5. Cartesi: Linux VM, app-specific rollups — an architecture option, not a wallet model

Cartesi Rollups split a dApp into on-chain base-layer contracts and an off-chain execution layer: "Cartesi Machine, a virtual machine (VM) that runs an entire Linux OS, in which a dApp's backend is executed," plus backend, frontend, and a Rollups node bridging them — https://docs.cartesi.io/cartesi-rollups/1.3/core-concepts/architecture/

The machine is a deterministic RISC-V emulator (`RV64IMAZicsr_Zifencei`, Sv39 paging) whose entire state is mapped to its physical address space for verification — https://docs.cartesi.io/cartesi-machine/target/architecture/

Interaction model: all user inputs go through the on-chain `InputBox`; the node feeds them as `advance_state` requests; the machine emits outputs — **vouchers** (callable back into L1 contracts, e.g. withdrawals, executable only after the epoch is finalised with a validity proof), **notices** (provable informational payloads), **reports** (unproven diagnostics), and exceptions — https://docs.cartesi.io/cartesi-machine/ and https://docs.cartesi.io/cartesi-rollups/0.8/components/ . Frontends query outputs via a GraphQL API over inputs/notices/vouchers/reports — https://docs.cartesi.io/cartesi-rollups/1.5/rollups-apis/graphql/overview/

**What it suggests for ZERONYTH:** A credible pattern for heavy dApps — run complex logic (games, ML scoring, PQ signature aggregation / batch verification, order books) in a deterministic Linux/RISC-V sandbox *off the validator path*, post ordered inputs on-chain, and settle only outputs (state hash + executable "vouchers") on-chain. Developers get Rust/Python/C++ and normal Linux libraries instead of a constrained contract language.

**Honest limits:** (1) Cartesi is an *optimistic* rollup on a host chain — finality waits for epoch claims / dispute resolution, not QBFT instant finality; transplanting it means designing ZERONYTH's own fraud/validity proof and challenge rules. (2) It is app-specific — one machine per dApp, no shared composability like native contracts. (3) Someone must run reader/validator nodes per app and serve the GraphQL/output layer — operational cost per dApp. (4) It solves *compute*, not accounts, signing, or wallet UX. Treat it as an optional L2-style execution tier for a few heavy apps, not the base dApp model; ink!-style native contracts remain the default.

## 6. Synthesis: a from-scratch ZERONYTH wallet core

| Component | Design, mapped to references |
|---|---|
| **PQ key management** | Wallet-only custody, modelled on Polkadot.js extension / Phantom: keys never enter the dApp (https://polkadot.js.org/docs/extension/usage/). Store Falcon-1024 and ML-DSA-65 secret keys encrypted at rest, scheme-tagged; seed backup must encode *scheme + derivation path*, since one seed yields two unrelated PQ keypairs. Hardware-signer abstraction from day one (Sui/Ledger pattern, §4). |
| **Address derivation** | Scheme-bound, per project spec: address = hash(PQ pubkey) with a scheme prefix/version byte (cf. SS58 prefix + genesis hash distinguishing Substrate accounts). Never derive a PQ account's address from an ECDSA key or vice-versa. Pubkey registration on first use so later txs reference the short address only — the ALT lesson (§3). |
| **Tx construction** | Metadata-driven, PAPI/subxt-style: a versioned chain metadata artifact generates typed builders for transfers, contract calls and both PQ tx types; SCALE-like compact binary encoding; explicit signed-extension fields for nonce, chainId/genesis hash, mortality/era, fee — mirroring PAPI's required nonce/validate/fee runtime APIs (https://papi.how/requirements/). Version the tx format (v0-style prefix) so Falcon vs ML-DSA payloads and future schemes coexist. |
| **Signing flow** | Namespaced feature API copied from Wallet Standard: `zeronyth:signTransaction`, `zeronyth:signAndSendTransaction`, `zeronyth:signPersonalMessage`, plus `standard:connect / disconnect / events` (https://docs.sui.io/onchain-finance/asset-custody/wallets/wallet-standard). Wallet UI must decode the call from metadata and show human-readable intent (recipient, amount, contract + message, fee) before signing — PQ signature size makes "blind signing" audits harder, not easier. Typed rejection (AIP-62 `UserResponse` pattern, §4). |
| **RPC / client layer** | Two providers, PAPI shape: WebSocket/HTTP JSON-RPC for launch, and a light-client provider (smoldot-analogue) as the trust-minimised target (https://papi.how/providers/). Frontend code talks to a generated `TypedApi`, never raw RPC, except via a documented unsafe escape hatch. |
| **dApp bridge protocol** | Adopt Wallet Standard discovery verbatim in shape: wallet calls `registerWallet()`, app dispatches `app-ready`, no `window.<brand>` globals, no per-wallet code in dApps (https://github.com/anza-xyz/wallet-standard/blob/HEAD/WALLET.md). Ship (i) a core framework-agnostic package, (ii) React bindings + ConnectButton/modal, (iii) a mobile app-to-app protocol (Solana MWA analogue). One official wallet first, but the standard *before* a second wallet exists. |
| **Contract frontend** | ink! model: every contract ships `.contract` + metadata `.json`; a CLI generates TS bindings from it; frontends use `query` (dry-run) vs `tx` (signed) separation (https://papi.how/sdks/ink-sdk/). |
| **Heavy compute (optional)** | Cartesi-style deterministic RISC-V sandbox tier for selected dApps: ordered on-chain inputs, off-chain Linux execution, on-chain settlement of output hashes + voucher-like executable outputs (§5). Opt-in per app, not the platform default. |

**Bottom line:** None of this needs Ethereum. Polkadot proves a self-describing chain can support fully generic generated clients and light clients; ink! proves contract ABIs can be pure metadata; Solana/Sui/Aptos prove wallet discovery and signing can be standardised without EIP-1193; Cartesi proves Linux-grade compute can settle on-chain — with optimistic-finality and per-app-node costs ZERONYTH should accept only deliberately.

## References

1. PAPI Requirements — https://papi.how/requirements/
2. PAPI Getting Started — https://papi.how/getting-started/
3. PAPI Providers (Smoldot / WebSocket) — https://papi.how/providers/
4. PAPI Transactions — https://papi.how/typed/tx/
5. PAPI Ink! SDK — https://papi.how/sdks/ink-sdk/
6. Polkadot Protocol Specification, Runtime API / Metadata — https://spec.polkadot.network/chap-runtime-api
7. Polkadot Developer Docs, subxt — https://docs.polkadot.com/reference/tools/subxt/
8. subxt book, code generation from metadata — https://docs.rs/subxt/0.38.0/subxt/book/setup/codegen/index.html
9. subxt book, light client (smoldot) — https://docs.rs/subxt/0.34.0/subxt/book/usage/light_client/index.html
10. Polkadot.js extension usage (web3Enable / signer) — https://polkadot.js.org/docs/extension/usage/
11. Polkadot.js API-Contract, ContractPromise — https://polkadot.js.org/docs/api-contract/start/contract.read
12. ink! v6 migration (pallet-revive / PolkaVM) — https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/
13. ink! Compile Your Contract (metadata / .contract bundle) — https://use.ink/getting-started/building-your-contract
14. Phantom, Wallet Standard — https://docs.phantom.com/developer-powertools/wallet-standard
15. Anza Wallet Standard, WALLET.md — https://github.com/anza-xyz/wallet-standard/blob/HEAD/WALLET.md
16. Solana, How to Connect a Wallet with React (Wallet Adapter) — https://solana.com/nl/developers/guides/wallets/add-solana-wallet-adapter-to-nextjs
17. Solana, Address Lookup Tables / Versioned Transactions — https://github.com/bji/solana/blob/HEAD/docs/src/developing/lookup-tables.md
18. Phantom, Send a versioned transaction — https://docs.phantom.com/solana/sending-a-transaction-1
19. Sui, Self-Custodial Wallets / dApp Kit — https://docs.sui.io/onchain-finance/asset-custody/wallets/self-custody
20. Sui, Wallet Standard — https://docs.sui.io/onchain-finance/asset-custody/wallets/wallet-standard
21. Aptos, Wallet Adapter Plugin for Browser Extension Wallets (AIP-62) — https://aptos.dev/build/sdks/wallet-adapter/browser-extension-wallets
22. Cartesi Rollups Architecture — https://docs.cartesi.io/cartesi-rollups/1.3/core-concepts/architecture/
23. Cartesi Machine Architecture (RISC-V) — https://docs.cartesi.io/cartesi-machine/target/architecture/
24. Cartesi Machine Introduction (inputs, vouchers, notices, reports) — https://docs.cartesi.io/cartesi-machine/
25. Cartesi Rollups GraphQL API Overview — https://docs.cartesi.io/cartesi-rollups/1.5/rollups-apis/graphql/overview/
