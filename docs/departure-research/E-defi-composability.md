<!-- Published copy of the project engineering record. Internal workspace paths were rewritten to this repository's layout (besu-912701/ = reconstructed production source tree, docs/ = deliverables). -->

# E — VM Choice and DeFi Composability

*ZERONYTH research — Topic E. Snapshot date for market data: 4 Nov 2026 (DefiLlama crawl).*

## 1. Ethereum composability in action: synchronous and atomic

Ethereum's defining DeFi property is not merely that contracts can call each other, but that they can do so **synchronously, in one transaction, with all-or-nothing revert**. If any leg fails, earlier legs do not persist. That is the technical basis of "money legos": a token, a pool, a lending market and a vault share are small reusable blocks fitted together by shared standards such as ERC-20 and ERC-4626 (https://boxmining.com/defi-money-legos/).

Three production patterns depend on it:

**Flash loans.** Aave's documentation model — also summarised from its protocol code — is an uncollateralised loan that must be repaid, plus premium, *in the same transaction*; if not repaid, the transaction reverts "as if it never happened" (https://deepwiki.com/aave/protocol-v2/2.4-flash-loans). Aave V3 charges 0.05% for this primitive (https://dev.crypto-investing.page/ref/aave.html). No traditional lender can offer this, because there is no settlement interval in which to default.

**Multi-protocol flows in one transaction.** A liquidator can flash-borrow on Aave, liquidate on Morpho, swap on Uniswap V3, and repay Aave, with the Aave pool checking repayment at the end of the callback — a pattern documented in production liquidator code (https://deepwiki.com/tsmluky/Morpho-Blue-Liquidator-Bot/7.3-external-integrations). A yield aggregator does the inverse, benign version: Yearn vaults deposit into Curve pools, stake LP tokens in gauges, lend on Aave/Compound/Cream, borrow, re-deposit into another Yearn vault, harvest and re-compound — all as composable strategies (https://gist.github.com/eagleworldpk-bot/8e0f3158cc791dadab7370b75a87339b). Yearn V3 made the vault itself an ERC-4626 container so its shares can in turn be used as collateral elsewhere (https://stage.crypto-investing.page/reviews/yearn.html).

**Atomic arbitrage and liquidation as system maintenance.** Searchers buy low on one DEX and sell high on another in one revert-or-succeed transaction, aligning prices at almost no inventory risk; liquidations work the same way (https://ethereum.org/developers/docs/mev/). The point for ZERONYTH: atomicity is not a convenience feature. It is what makes uncollateralised credit, risk-free arbitrage, and single-step leverage/ deleverage possible at all.

## 2. The fallout: the same property, weaponised

Composability couples protocols' failure domains. The literature and the incident record make four distinct criticisms, each with concrete cases.

**Contagion and cascading liquidations.** When collateral, oracles and liquidation are shared, a price fall liquidates everywhere at once, and forced selling pushes prices further. On Black Thursday, 12 March 2020, ETH fell roughly 50%, Maker vaults became under-collateralised, congested auctions were "swamped," one bidder won ~62,843 ETH for virtually zero DAI across 1,461 auctions, and Maker was left ~6.65m DAI under-collateralised, requiring MKR debt auctions to recapitalise (https://cointelegraph.com/news/maker-debt-crisis-post-mortem-recommends-new-safeguards). Terra/UST in May 2022 showed cross-system contagion: Anchor held ~70% of UST, CeFi lenders Celsius, Voyager and Three Arrows had UST/LUNA exposure, and the broader market lost ~$500bn in the following month (https://github.com/kcolbchain/research/blob/HEAD/research/stablecoin-depeg-analysis.md).

**Cross-contract reentrancy surface.** Synchronous callbacks mean a contract can be re-entered before its state is updated. The archetype is The DAO in June 2016: a reentrancy bug in `splitDAO` drained ~3.6m ETH, about a third of the fund, precipitating the Ethereum/Ethereum Classic hard fork (https://www.theblock.co/news/ecosystems/2026-06-18-ethereum-130-million-security-fund-the-dao-hack-10-years-405248). It was not obsolete by 2023: Curve pools compiled with Vyper 0.2.15–0.3.0, whose reentrancy lock was incorrectly implemented, were drained of ~$62–69m on 30 July 2023, and the CRV price fall then threatened a large CRV-collateralised borrow on Aave — a textbook second-order contagion (https://www.bitbase.com/blog/what-is-curve-finance). Read-only reentrancy hit Conic Finance days earlier, via a Curve callback during `remove_liquidity` (https://www.certik.com/blog/conic-finance-incident-analysis).

**Flash-loan-amplified exploits.** Atomicity gives an attacker temporary, unlimited-scale capital. Euler Finance lost ~$197m on 13 March 2023 when an attacker flash-borrowed DAI, created a position, used `donateToReserves` — which lacked a health check — to make it artificially insolvent, then self-liquidated at a discount, in a loop (https://ponr.org/en/articles/flash-loan-attack-guide.html). Funds were later returned, but the design lesson stands: flash loans do not create bugs, they make any bug instantly exploitable at full pool scale.

**MEV enabled by atomicity and ordering.** Ethereum.org defines MEV as value extractable "by including, excluding, and changing the order of transactions in a block" (https://ethereum.org/developers/docs/mev/). Because a searcher's arbitrage or sandwich either succeeds atomically or reverts for only gas, extraction is near-risk-free; one course synthesis citing Flashbots/EigenPhi puts cumulative atomic MEV on Ethereum at ~$1.4bn+ since January 2020, and stresses this understates the total (https://github.com/bdaf-course/bdaf-coursepage/blob/HEAD/additional-material/BDAF_MEV_Introduction.md). Systemic-risk critiques generalise this: composable, automated liquidations and shared stablecoin credit propagate shocks *faster* in DeFi than in TradFi bank runs, with no lender of last resort (https://github.com/kcolbchain/research/blob/HEAD/research/stablecoin-depeg-analysis.md).

## 3. Async models — and a necessary correction about ink! v6

**Correction first.** The premise that ink! v6 is "async" needs qualification. On-chain, ink! cross-contract calls are *synchronous*: the official docs show `flip_and_get()` calling `other_contract.flip()` then `other_contract.get()` and returning a `bool` inline, "just like normal Rust methods," and `CallBuilder::invoke()` returning a value in the same execution (https://use.ink/docs/v5/basics/cross-contract-calling/). What changed in v6 is execution, not synchrony: migration from `pallet-contracts` + WebAssembly/wasmi to `pallet-revive` + RISC-V/PolkaVM, with Solidity ABI support so ink! and Solidity contracts on the same pallet can call each other (https://github.com/use-ink/ink/releases/tag/v6.0.0-alpha, https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/). Rust `async`/`await` appears mainly in off-chain clients and e2e tests, and in *cross-chain* messaging. A second due-diligence flag: a 2026 status review reports the ink! Alliance announced development had stopped on 27 January 2026, with Solidity on pallet-revive presented as the supported path (https://4irelabs.com/articles/top-5-challenges-of-building-smart-contracts-with-ink/). ZERONYTH should verify maintenance status directly before anchoring on ink!.

**Where async is real.** Polkadot's XCM is explicitly asynchronous, asymmetric and "fire and forget": no automatic feedback, any result requires a separate message back, and messages are described as intent-driven (https://docs.polkadot.com/parachains/interoperability/get-started.md). NEAR, a sharded chain, is the canonical contract-level example: its docs state cross-contract calls "are asynchronous and independent," execute 1–2 blocks later via Promises, the callback *always* executes even if the external call fails, and developers must "manually rollback" changes in the callback (https://near-docs.io/smart-contracts/anatomy/crosscontract, https://docs.near.org/smart-contracts/tutorials/cross-contracts/xcc).

**Verdict on "with async, the previous composability is now impossible": fiction as a blanket claim, fact for a specific subset.**

*Lost, in a genuinely async execution domain:* single-transaction atomicity across contracts; flash loans as defined above (there is no single transaction to revert); synchronous price/state reads mid-flow; atomic liquidation-swap-repay; and the guarantee that steps 1–2 unwind automatically if step 3 fails.

*Retained:* interface composability (shared token/vault standards, type-safe references), permissionless building on other protocols, parallel independent calls (`Promise.join` on NEAR), and eventual multi-step workflows. Contracts still stack — they stack over *time*, with explicit state machines, rather than over a call stack.

*New patterns that replace atomic flows:* (1) **Callbacks and two-phase flows** — escrow/lock in phase 1, settle or refund in the callback, with idempotency and timeout handling as first-class code. (2) **Intents and solvers** — the user signs a desired outcome, not an execution path; competing solvers/fillers fulfil it and settlement is verified on-chain, as in UniswapX Dutch-auction orders and CoW Protocol batch auctions (https://www.weex.com/news/detail/what-are-intents-and-solvers-the-invisible-layer-executing-your-defi-trades-adyp2mcy70m344p7ror1x377). Intents re-create a form of atomicity at the *settlement* layer while execution stays asynchronous — and they also mitigate MEV, since orders do not sit exposed in a public mempool. (3) **Transaction-level composition instead of contract-level composition** — Sui's different answer: Programmable Transaction Blocks chain up to 1,024 commands, outputs feeding later commands, all succeeding or reverting together; Sui's own Ethereum comparison notes a DeFi aggregator can route across protocols in one PTB "at the displayed price or reverts completely," without deploying a router contract (https://docs.sui.io/getting-started/sui-for-ethereum, https://docs.sui.io/develop). Sui proves async/sharded ambitions do not force the loss of atomicity *within one chain* — atomicity can be moved from the contract call stack to transaction construction.

Implication: ZERONYTH's real choice is not "ink! = no composability." It is *where atomicity lives*: in-VM synchronous calls (EVM, ink!/pallet-revive on one chain), in the transaction format (Sui PTBs), or nowhere, compensated by callbacks/intents (NEAR, XCM). For on-chain DeFi as the core feature, the third option alone is the most costly.

## 4. Cross-chain DeFi quality: Move chains and Solana vs Ethereum

DefiLlama's chain ranking (4 Nov 2026) quantifies the gap: Ethereum $45.82bn TVL across 2,118 protocols; Base $6.16bn / 1,217; Solana $5.54bn / 713; Sui $468.9m / 161; Stellar $221.9m / 50; Aptos is listed separately at just $40.3m TVL and $3.9m 24h DEX volume (https://defillama.com/chains, https://defillama.com/chain/aptos?volume=true).

**Solana** is the only non-Ethereum ecosystem here with genuinely deep, production DeFi — but concentrated and memecoin-heavy. Its top protocols are Sanctum ($1.92bn), Jupiter ($1.72bn), Kamino ($1.31bn) and Raydium ($1.07bn), with $1.91bn 24h DEX volume (https://defillama.com/chain/solana). Jupiter as aggregator and Kamino as lending/liquidity hub give good retail UX and speed. Failures have been economic, not just code: Mango Markets was drained of $114m in October 2022 by oracle-price manipulation of its own MNGO collateral token, $67m later returned (https://www.coindesk.com/business/2022/10/15/114m-mango-markets-exploiter-outs-himself-returns-most-of-the-money).

**Sui** has credible flagship infrastructure — Cetus (concentrated-liquidity DEX/aggregator) and DeepBook (order book) — and PTBs are a real composability advantage (Section 3). But depth is thin and fragile: Sui DeFi TVL fell from a ~$2.1–2.6bn peak to ~$450–470m (https://www.sui.io/blog/sui-vs-aptos-move-object-account-model, https://defillama.com/chains). On 22 May 2025 Cetus lost $223m to an overflow-check bug in a shared math library; validators froze ~$162m, which was returned after a community vote, with pools refilled partly by a Sui Foundation loan — effective recovery, but a centralisation precedent (https://www.jewelswap.io/blog/deepbook-vs-cetus).

**Aptos**, despite the same Move heritage, Block-STM parallel execution and sub-50ms block times, has not converted technology into DeFi liquidity: ~$56m DeFi TVL in Sui's own September 2026 comparison, and $40m on DefiLlama in November, versus a ~$1bn peak (https://www.sui.io/blog/sui-vs-aptos-move-object-account-model). Its former flagship Thala fell from a $268.5m all-time high to $3.28m (https://defillama.com/protocol/thala). Assessment: Move's safety properties (resource types, no dynamic dispatch, bytecode verification) reduce *some* bug classes — notably reentrancy — but Cetus and Thala show they do not substitute for liquidity, Lindy time, audits and users. Ethereum's advantage is less its VM than its decade of accumulated liquidity, tooling, and battle-tested protocol forks.

## 5. Architecture note: Base's rollup bet vs Stellar's Soroban bet

**Base / rollup-centric.** Base is an Ethereum L2 built on Optimism's OP Stack, posting batched data to Ethereum and inheriting its security, with full EVM equivalence (https://academy.binance.com/ro/articles/what-is-base-coinbase-layer-2-network). The Superchain is "a network of L2s that share security, communication layers, and a common development stack (the OP Stack itself)" (https://docs.optimism.io/op-stack/protocol/getting-started.md). The bet: do not build a new L1 or a new trust base; rent Ethereum's, standardise the stack, and win on distribution (Coinbase) and shared interoperability. Costs: sequencer centralisation, fragmented liquidity across L2s, and dependence on another ecosystem's roadmap — underlined by reports in February 2026 that Base would migrate off the shared OP Stack to its own unified codebase while still settling to Ethereum (https://blog.web3wagmi.com/base-guide).

**Stellar / Soroban.** The opposite bet: keep an established, payments-focused L1 (Stellar Consensus Protocol, live since 2014) and *add* general smart contracts to it — Soroban, Rust-to-Wasm, live on mainnet in March 2024 (https://coincub.com/price-prediction/stellar-price-prediction/). SDF's official 2025 roadmap targets 5,000 TPS via "concurrency, aggressive caching, and ahead-of-time compilation of Soroban smart contracts," plus usability tooling (https://stellar.org/foundation/roadmap). Soroban's authorisation framework and Stellar Asset Contract bring regulated-asset and anchor/fiat rails that Ethereum DeFi lacks natively (https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization). Yet Stellar DeFi TVL is only ~$222m (https://defillama.com/chains): adding contracts to a payments chain did not automatically create a DeFi ecosystem.

**Relevance to ZERONYTH.** Neither bet transfers directly to a from-scratch *private* chain: Base's value is precisely the public Ethereum security and liquidity ZERONYTH is leaving, and Stellar's is its public anchor network. Two lessons do transfer. First, **distribution and an existing asset base beat VM novelty** — both cases show ecosystems, not execution models, are the scarce resource; ZERONYTH must bootstrap its own legos (token standard, AMM, lending, oracle) as a coherent, audited set. Second, **choose the settlement/atomicity boundary deliberately**: Base accepts async, fragmented composability across L2s in exchange for scale, while Stellar kept one L1 execution domain and added contracts to it. For a private chain whose core feature is on-chain DeFi, Stellar's structural choice — one synchronous domain first, scale second — is the closer analogue, even if none of its code or network is reused.

## References

1. Aave flash loans — https://deepwiki.com/aave/protocol-v2/2.4-flash-loans
2. Money legos / ERC-4626 — https://boxmining.com/defi-money-legos/
3. Morpho liquidator (Aave + Morpho + Uniswap) — https://deepwiki.com/tsmluky/Morpho-Blue-Liquidator-Bot/7.3-external-integrations
4. Yearn strategies — https://gist.github.com/eagleworldpk-bot/8e0f3158cc791dadab7370b75a87339b
5. Ethereum.org MEV — https://ethereum.org/developers/docs/mev/
6. Maker Black Thursday post-mortem — https://cointelegraph.com/news/maker-debt-crisis-post-mortem-recommends-new-safeguards
7. Terra/UST contagion & BIS framing — https://github.com/kcolbchain/research/blob/HEAD/research/stablecoin-depeg-analysis.md
8. The DAO hack — https://www.theblock.co/news/ecosystems/2026-06-18-ethereum-130-million-security-fund-the-dao-hack-10-years-405248
9. Curve/Vyper reentrancy — https://www.bitbase.com/blog/what-is-curve-finance
10. Conic read-only reentrancy — https://www.certik.com/blog/conic-finance-incident-analysis
11. Euler exploit — https://ponr.org/en/articles/flash-loan-attack-guide.html
12. MEV quantification — https://github.com/bdaf-course/bdaf-coursepage/blob/HEAD/additional-material/BDAF_MEV_Introduction.md
13. ink! cross-contract calling — https://use.ink/docs/v5/basics/cross-contract-calling/
14. ink! v6 release (pallet-revive) — https://github.com/use-ink/ink/releases/tag/v6.0.0-alpha
15. ink! v5→v6 migration — https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/
16. ink! status 2026 — https://4irelabs.com/articles/top-5-challenges-of-building-smart-contracts-with-ink/
17. Polkadot XCM — https://docs.polkadot.com/parachains/interoperability/get-started.md
18. NEAR cross-contract calls — https://near-docs.io/smart-contracts/anatomy/crosscontract
19. NEAR XCC tutorial — https://docs.near.org/smart-contracts/tutorials/cross-contracts/xcc
20. Intents / UniswapX / CoW — https://www.weex.com/news/detail/what-are-intents-and-solvers-the-invisible-layer-executing-your-defi-trades-adyp2mcy70m344p7ror1x377
21. Sui for Ethereum devs / PTBs — https://docs.sui.io/getting-started/sui-for-ethereum
22. Sui PTB docs — https://docs.sui.io/develop
23. DefiLlama chains — https://defillama.com/chains
24. DefiLlama Solana — https://defillama.com/chain/solana
25. DefiLlama Aptos — https://defillama.com/chain/aptos?volume=true
26. Sui vs Aptos (Sui Foundation) — https://www.sui.io/blog/sui-vs-aptos-move-object-account-model
27. Cetus exploit / recovery — https://www.jewelswap.io/blog/deepbook-vs-cetus
28. Mango Markets exploit — https://www.coindesk.com/business/2022/10/15/114m-mango-markets-exploiter-outs-himself-returns-most-of-the-money
29. Thala TVL collapse — https://defillama.com/protocol/thala
30. Base (Binance Academy / OP Stack) — https://academy.binance.com/ro/articles/what-is-base-coinbase-layer-2-network
31. OP Stack / Superchain docs — https://docs.optimism.io/op-stack/protocol/getting-started.md
32. Base 2026 stack pivot (report) — https://blog.web3wagmi.com/base-guide
33. Stellar 2025 roadmap — https://stellar.org/foundation/roadmap
34. Soroban authorisation — https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization
