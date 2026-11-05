<!-- Published copy of the project engineering record. Internal workspace paths were rewritten to this repository's layout (besu-912701/ = reconstructed production source tree, docs/ = deliverables). -->

# Topic C — Myth-or-Fact: "Solidity/EVM is uniquely developer-friendly — smart-contract development in Solidity is easier than Rust-based contract development"

*ZERONYTH departure research. Given premise (not re-litigated): ZERONYTH leaves Ethereum entirely, client rewritten from scratch, Rust contract stack in the ink! v6 lineage is a leading candidate reference. Researched 2026-11-05. Every significant claim carries its source URL inline.*

## 1. The claim and its usual supporting arguments

The claim, in its strong folklore form: Solidity is *the* easy on-ramp to smart contracts and Rust contracts are a niche hardship, so choosing Rust imposes a permanent developer-experience (DX) and hiring handicap.

Four supporting arguments are usually offered:

1. **Learning curve** — Solidity looks like JavaScript/C++, is purpose-built and small; Rust has ownership, borrowing, lifetimes and a famously strict compiler.
2. **Tooling** — Remix, Hardhat, Foundry, OpenZeppelin, block explorers and debuggers form a decade-old, integrated stack.
3. **Hiring pool** — "every Web3 developer knows Solidity"; Rust contract developers are scarce and expensive.
4. **Examples abundance** — tutorials, audited templates, copy-paste DeFi primitives (Uniswap, Aave, Compound forks) exist overwhelmingly in Solidity.

Each argument contains a real core. The question is whether "uniquely" and "easier, full stop" survive the data.

## 2. Evidence

### 2.1 Developer population: EVM is largest, Rust ecosystems are not small — and momentum flipped at least once

Electric Capital's 2024 Developer Report — analysing 902 million commits across 1.7 million repositories — counted 23,613 monthly active crypto developers in total, 6,244 of them in the Ethereum ecosystem, down 17% year-on-year (https://www.developerreport.com/). At the virtual-machine level, trade reporting of the same report puts the EVM stack at 8,925 developers, roughly 3.6× the Solana Virtual Machine (SVM, Rust) stack at 2,499 — so the EVM hiring/network-effect lead is real (https://blockworks.com/news/electric-capital-report-solana-developers).

But the same report destroyed the "Rust repels newcomers" corollary: Solana — whose contracts are Rust — onboarded 7,625 new developers in 2024 versus Ethereum's 6,456, becoming the first ecosystem since 2016 to beat Ethereum for new developers, with 83% year-on-year growth (https://cointelegraph.com/news/solana-flips-ethereum-top-ecosystem-new-developers). A Polkadot Forum analysis of Electric Capital's full-time-developer data across the top-20 ecosystems found Rust-contract ecosystems at 45.5% versus EVM at 40.9% of that set — i.e. at the top end, Rust and EVM are comparable, not an order of magnitude apart (https://forum.polkadot.network/t/rust-solidity-data-doesn-t-lie/15683.rss).

Momentum is also cyclical, not a law: Electric Capital data reported for January–September 2025 shows Ethereum back in front with 16,181 new developers (31,869 total active) versus Solana's 11,534 new (17,708 total) (https://carigold.com/forum/threads/ethereum-adds-16k-developers-in-2025-yet-solana-steals-all-the-hype.836749/). Outside crypto, Rust's general pool keeps widening: JetBrains estimated 2.27 million developers used Rust in the prior 12 months, 709,000 as their primary language (https://blog.jetbrains.com/rust/2025/08/01/rust-vs-java/). Solidity, by contrast, is a single-purpose skill with essentially no labour market outside Web3.

**Reading:** the hiring argument is *fact for EVM-specific contract engineers today*, *folklore as a claim about Rust's overall pool or about newcomers' willingness to learn it*.

### 2.2 Learning curve: Solidity is faster to first contract; Rust is harder up front — survey data on both sides

Solidity's own survey supports the "fast start" claim: in the Solidity Developer Survey 2023, 36.7% of respondents felt productive in under six months and 17.8% in under a month (https://github.com/argotorg/solidity-website/blob/HEAD/src/posts/2024-04-03-solidity-developer-survey-2023-results.md). That is a genuinely low barrier for a first ERC-20 or vault.

Rust's curve is measurably steeper. The official 2024 State of Rust Survey (7,310 completed responses) found only 53% of respondents considered themselves productive in Rust (up from 47% in 2023), 20% could write only simple programs, and ~31% of non-users cited perceived difficulty as the main reason for not using it (https://blog.rust-lang.org/2025/02/13/2024-State-Of-Rust-Survey-results/). Secondary analysis of the same survey reports 62% agreeing Rust requires significantly more effort to learn than other languages (https://www.javacodegeeks.com/2026/05/rust-vs-go-in-2026-the-systems-vs-services-split-is-finally-clear-which-one-should-you-actually-learn.html).

Two qualifications matter. First, "fast to productive in Solidity" often means fast to *deployable-looking* code, not fast to *safe* code (see §2.3) — the language's traps (external-call ordering, delegatecall, proxy initialisation) are learned mainly through audits and exploits. Second, satisfaction after the Rust hump is exceptionally high: Rust was Stack Overflow's most admired language for the ninth consecutive year in 2024, at 83% admiration (https://dev.to/vivian-voss/rust-says-no-chm), and the Rust survey notes learners actively use `rustc` error messages and Clippy as teaching guides — diagnostics are a feature, not just friction (https://blog.rust-lang.org/2025/02/13/2024-State-Of-Rust-Survey-results/).

### 2.3 Safety evidence: what each language prevents by construction — and what neither does

**Solidity/EVM's catastrophic classes are documented in loss data, not anecdotes:**

- **Access control** is the #1 loss category in the OWASP Smart Contract Top 10 (2025): $953.2M lost in 2024 across 149 incidents totalling $1.42B, dwarfing logic errors ($63.8M) (https://owasp.org/www-project-smart-contract-top-10/ — summary at https://www.insecure.in/blog/owasp-smart-contract-top-10-2025).
- **Reentrancy** remains #5 in that ranking at $35.7M in 2024 alone (https://www.insecure.in/blog/owasp-smart-contract-top-10-2025), nearly a decade after The DAO's reentrancy drain of ~$60M forced Ethereum's hard fork (https://smartcontractshacking.com/attacks/reentrancy). The July 2023 Curve incident (~$70M gross, ~$52M net) showed the failure can even sit in the compiler: a Vyper reentrancy-lock bug silently disabled protection developers believed they had (https://www.halborn.com/blog/post/explained-the-vyper-bug-hack-july-2023).
- **Integer overflow/underflow** was a default-wrapping hazard until Solidity 0.8.0 made arithmetic revert on overflow by default; the official docs state pre-0.8 operations "would always wrap," which is why SafeMath libraries were ubiquitous (https://docs.soliditylang.org/en/v0.8.0/control-structures.html?highlight=assert). It is still OWASP #8 in 2025, because `unchecked` blocks and older code persist (https://www.insecure.in/blog/owasp-smart-contract-top-10-2025).

**What Rust prevents by construction** is a different, lower layer: ownership/borrowing and the type system eliminate — in safe Rust — use-after-free, double-free, null dereference, data races and out-of-bounds access without a garbage collector. The strongest field evidence is Google's Android programme: as new code shifted to memory-safe languages (chiefly Rust), memory-safety vulnerabilities fell from 76% of Android vulnerabilities in 2019 (223 flaws) to 24% in 2024 (under 50) (https://security.googleblog.com/2024/09/eliminating-memory-safety-vulnerabilities-Android.html). Rust also makes illegal states harder to express (exhaustive `match`, `Option`/`Result` instead of nulls/sentinel values, newtype wrappers), and checked arithmetic can be enforced via compiler profiles and lints.

**Honest boundary — auditors repeat this constantly:** Rust does *not* by construction prevent reentrancy (a contract can still call out and be called back), broken access control (forgetting a caller check is still one omitted line, unless the framework encodes capabilities in types), oracle manipulation, or DeFi logic errors. Those are *protocol* bugs, and OWASP's top categories are mostly protocol bugs (https://scs.owasp.org/sctop10/). What a Rust eDSL like ink! adds is ergonomic, not magical: caller/owner checks are explicit typed API calls, cross-contract calls go through typed `CallBuilder`s, and fallible operations return `Result` that the compiler forces you to handle. The gain is fewer *accidental* omissions and far better static tooling (Clippy, type-driven refactoring), not immunity. Conversely, Solidity's ecosystem compensates with mature dynamic defences — Slither, Echidna, Foundry fuzzing/invariants, OpenZeppelin guards — that exist precisely because the language leaves these holes open.

**Net:** "Solidity is easy" conflates *easy to write* with *easy to write safely*. The loss record shows the second is false; Rust reverses the trade — harder to compile, safer once it does.

### 2.4 Realistic ergonomics of ink! v6 on modern Rust

ink! is an embedded DSL: ordinary Rust annotated with `#[ink::contract]`, `#[ink(storage)]`, `#[ink(message)]`. A developer gets Cargo, rust-analyzer, Clippy, `rustfmt`, crates.io libraries that are `no_std`-compatible, and unit tests that run as normal Rust tests.

- **Testing is a genuine strength.** Off-chain unit tests use `#[ink::test]` against a simulated environment with no node; end-to-end tests use `#[ink_e2e::test]`, compile the real contract binary and run it against a real or emulated `pallet-revive` runtime, covering cross-contract calls and gas metering; DRink! adds quasi-E2E testing without a node process (https://deepwiki.com/use-ink/ink/5-testing, https://github.com/use-ink/drink).
- **Tooling:** `cargo-contract` builds, deploys, calls and verifies contracts; v6 targets `cargo-contract` ≥ v6 (https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/).
- **v6 changed the ground under developers:** migration from `pallet-contracts` + WebAssembly/`wasmi` to `pallet-revive` + RISC-V/PolkaVM is explicitly "a major breaking change" — new `.polkavm` binaries, `H160` addresses and account mapping, `no_main` added to the `no_std` attribute, removed chain extensions and `call_runtime`, and Solidity-ABI compatibility mode for interoperability (https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/). Debugging support for the new tracing API is described by ink! itself as "barebones" in the alpha/beta line (same source).
- **Solidity is not ergonomically immaculate either:** the Solidity Developer Survey 2025 (1,095 usable responses) reports "stack too deep" as the #1 recurring issue (47%; 65% of experts), bytecode-size limits at 33% and debugging at 33% — ceilings hit hardest by experienced developers (https://www.soliditylang.org/blog/2026/04/15/solidity-developer-survey-2025-results/). Foundry is now the dominant framework (57%, up from 51% in 2024), which also means the "mature tooling" argument increasingly rests on one young Rust-written framework (same source).

## 3. Verdict

**Fact:** Solidity has the largest *contract-specific* developer pool, the most examples/templates, the deepest audit/tooling market, and the fastest time-to-first-contract. For a public ecosystem that must hire at scale and bootstrap third-party DeFi quickly, that network effect is decisive today.

**Folklore / outdated:** (a) "Uniquely" friendly — Rust ecosystems onboarded *more* new crypto developers than Ethereum in 2024, and Rust's general pool (millions) dwarfs Solidity's niche; (b) "easier" without specifying *for what* — Solidity is easier to start and easier to get catastrophically wrong, with ~$953M lost to access control and $35.7M to reentrancy in 2024 alone; Rust front-loads difficulty into compilation and repays it in eliminated bug classes and forced error handling; (c) the implication that Rust contract DX is primitive — ink!'s Cargo-native unit/E2E testing is at least comparable to Hardhat/Foundry workflows.

**For whom:** For a *small, fixed team building a new chain's DeFi core* (ZERONYTH's stated shape), the hiring-pool argument is weak — you hire a handful of engineers once, train them in Rust in months, and then live for years with the safety properties; example scarcity matters less when you write the reference contracts yourselves. For a *hiring-at-scale public ecosystem* competing for thousands of independent builders on day one, Solidity's network effect is a real strategic asset and Rust's curve is a real adoption tax. The claim is therefore **context-true for ecosystem bootstrapping, and folklore as a universal statement about developer-friendliness or safety-adjusted ease.**

## 4. Real constraints of Rust-based contract development (critical review)

1. **The ink! continuity crisis — the single biggest concrete risk.** On 27 January 2026 the ink! Alliance announced the *discontinuation* of ink! development: three Polkadot treasury proposals (Refs. 1760, 1773, 1796) were rejected, the team worked unpaid for five months, and the Web3 Foundation/Parity declined strategic support; repositories are public but not actively maintained, and v6 shipped only as beta (https://forum.polkadot.network/t/discontinuation-of-ink-rust-smart-contract-language/16849). A 2026 status review confirms active maintenance stopped and advises new teams accordingly (https://4irelabs.com/articles/top-5-challenges-of-building-smart-contracts-with-ink/). **Implication:** ZERONYTH cannot treat ink! v6 as a maintained upstream; adopting its lineage means *owning/forking the stack* — budget for that explicitly. This is a governance/funding failure, not a technical verdict on Rust contracts, but it is decisive for planning.
2. **Steep, front-loaded learning curve.** Only 53% of Rust survey respondents call themselves productive; ~31% of non-users cite difficulty (https://blog.rust-lang.org/2025/02/13/2024-State-Of-Rust-Survey-results/). Expect months, not weeks, to onboard Solidity-only hires.
3. **Slow compilation.** The Rust survey names slow compilation as the top productivity limiter, with debugging support and artifact disk usage also cited (https://blog.rust-lang.org/2025/02/13/2024-State-Of-Rust-Survey-results/). Contract iteration loops are slower than Remix/Foundry's.
4. **`no_std` constraints.** On-chain ink! code cannot use Rust's `std` — only `core` + `alloc` via `ink::prelude` — because the target has no OS services; many popular crates are unavailable or need `no_std` features (https://use.ink/docs/v5/faq/). v6 adds `no_main` and PolkaVM entry-point differences (https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/).
5. **Binary-size and metering discipline.** Contracts compile to size-capped `.polkavm` blobs; generic-heavy Rust, large dependency trees and dual-ABI modes inflate size (the v6 migration guide warns `abi = "all"` makes the contract larger) (https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/). Developers must manage monomorphisation and dependencies deliberately — a skill Solidity developers rarely need (they hit EVM's 24KB limit instead).
6. **Macro opacity and error messages.** ink!'s attribute macros generate dispatch/storage code the developer didn't write; when macro expansion or trait bounds fail, `rustc` errors can point into generated code and be hard to map back to source. Rust diagnostics are best-in-class for ordinary code, but eDSL seams are the rough edge.
7. **Smaller contract-specific labour and audit market.** There are far fewer ink!-experienced auditors and ready-made audited DeFi templates than Solidity equivalents; OpenZeppelin-grade libraries for ink! (e.g. OpenBrush) are thinner and themselves affected by the maintenance freeze (https://4irelabs.com/articles/top-5-challenges-of-building-smart-contracts-with-ink/).
8. **Platform churn.** The v5→v6 jump (Wasm→RISC-V, `pallet-contracts`→`pallet-revive`, address format changes, removed chain extensions) broke code *and* storage assumptions within one major version (https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/). A from-scratch chain controls its own VM, which mitigates this — but only if it pins and maintains its toolchain rather than tracking Polkadot's.
9. **Rust does not solve DeFi logic security.** Audits, fuzzing, formal verification and economic review remain mandatory; the type system removes memory/typing bug classes, not reentrancy-by-design, access-control omissions or oracle risk (§2.3).

## References

1. Electric Capital Developer Report 2024 — https://www.developerreport.com/
2. Blockworks, "Solana gained highest share of new devs in 2024: Electric Capital" — https://blockworks.com/news/electric-capital-report-solana-developers
3. Cointelegraph, "Solana overthrows Ethereum's 8-year reign as top ecosystem for new devs" — https://cointelegraph.com/news/solana-flips-ethereum-top-ecosystem-new-developers
4. Polkadot Forum, "Rust > Solidity: Data Doesn't Lie" — https://forum.polkadot.network/t/rust-solidity-data-doesn-t-lie/15683.rss
5. Electric Capital data via Ethereum Foundation reporting, Jan–Sep 2025 — https://carigold.com/forum/threads/ethereum-adds-16k-developers-in-2025-yet-solana-steals-all-the-hype.836749/
6. Solidity Developer Survey 2023 Results — https://github.com/argotorg/solidity-website/blob/HEAD/src/posts/2024-04-03-solidity-developer-survey-2023-results.md
7. Solidity Developer Survey 2025 Results — https://www.soliditylang.org/blog/2026/04/15/solidity-developer-survey-2025-results/ and https://www.soliditylang.org/survey-2025/
8. 2024 State of Rust Survey Results, Rust Blog — https://blog.rust-lang.org/2025/02/13/2024-State-Of-Rust-Survey-results/
9. JetBrains, "Rust vs. Java" (developer-population estimates) — https://blog.jetbrains.com/rust/2025/08/01/rust-vs-java/
10. OWASP Smart Contract Top 10 (2025) — https://owasp.org/www-project-smart-contract-top-10/ ; data summary https://www.insecure.in/blog/owasp-smart-contract-top-10-2025 ; 2026 edition https://scs.owasp.org/sctop10/
11. Solidity docs, Checked/Unchecked Arithmetic (0.8.0) — https://docs.soliditylang.org/en/v0.8.0/control-structures.html?highlight=assert
12. Halborn, "Explained: The Vyper Bug Hack (July 2023)" — https://www.halborn.com/blog/post/explained-the-vyper-bug-hack-july-2023
13. Smart Contracts Hacking, Reentrancy (DAO history) — https://smartcontractshacking.com/attacks/reentrancy
14. Google Security Blog, "Eliminating Memory Safety Vulnerabilities at the Source" (Android/Rust) — https://security.googleblog.com/2024/09/eliminating-memory-safety-vulnerabilities-Android.html
15. ink! v6 Migration Guide (use.ink) — https://use.ink/docs/v6/faq/migrating-from-ink-5-to-6/
16. ink! FAQ, `no_std` / stdlib (use.ink) — https://use.ink/docs/v5/faq/
17. ink! Testing overview (DeepWiki of use-ink/ink) — https://deepwiki.com/use-ink/ink/5-testing ; DRink! — https://github.com/use-ink/drink
18. ink! Alliance, "Discontinuation of ink!: Rust smart contract language", Polkadot Forum, 27 Jan 2026 — https://forum.polkadot.network/t/discontinuation-of-ink-rust-smart-contract-language/16849
19. 4IRE, "ink! Smart Contracts in 2026: Status and What Changed" — https://4irelabs.com/articles/top-5-challenges-of-building-smart-contracts-with-ink/
