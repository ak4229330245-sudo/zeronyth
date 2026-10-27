# ZERONYTH Security: actual capabilities and planned integrations

## Phase 1 — Included in v1.5.0

Read-only local browser preview of **structured/decoded** transactions for EVM (including BNB Smart Chain and the
ZERONYTH EVM L1), Solana and Bitcoin. This is a heuristic demonstration for review, not a proof of safety.

Current preview limitations:

- The browser **cannot** intercept wallet signatures from other websites, reject a blockchain transaction,
  verify source-code integrity, or remotely revoke compromised permissions.
- ERC20/BEP20 decoder knows a small fixed set of function selectors. Unknown ABI, proxies, multicalls,
  permit/Permit2 and EIP-712 typed data need verified decoders, RPC state, and simulation.
- Solana requires already parsed instruction data. Address lookup tables, versioned raw messages, CPI effects,
  owner checks and Token-2022 extensions are not comprehensively understood.
- Bitcoin requires already decoded PSBT details. It cannot validate raw PSBT, BTC address checksum, network,
  taproot/script conditions, genuine change ownership, coin selection or sighash semantics.
- All user-supplied fields could be forged. A malicious webpage can present benign JSON while asking the wallet to
  sign different bytes. Browser UI text is never authoritative for signing.
- No local or remote AI is used; no data leaves the browser through this feature. Never paste private keys or seeds.

## Phase 2 — Wallet-integrated protection, separate audited milestone

### Prototype shipped in v1.6.0

- Detects suspicious parsed Safe EIP-712 `SafeTx` operations including `DELEGATECALL`, and shows warnings for
  unverified nested calldata and website-provided signing data. This does **not** intercept Safe or MetaMask globally.
- Optional ZNYT local-devnet native transfer review checks recipient equality, wallet chain, selected sender,
  contract code presence, unchanged form and empty calldata before invoking the wallet's confirmation.
  This is a narrow in-app **pre-handoff check**, not a trusted verification of final signing bytes.
- All four external ecosystems (EVM including BNB, Solana, and Bitcoin) remain *read-only scanning* unless a
  wallet-specific integration is explicitly implemented, consented to, tested and audited.

### Remaining work for a defensible release

1. Decode **the exact payload delivered to the wallet** and display a canonical hash/fingerprint to prevent UI/payload mismatch.
2. Implement transaction/state simulation where chains support it; independently report asset transfers, token
   allowances, authority changes, upgradeable proxies, fee/rent changes and unknown results.
3. Add address poisoning/homoglyph detection, recipient allowlisting and high-value delays. Address comparisons
   must use validated chain-specific encodings and independently confirmed intended addresses.
4. Implement wallet-specific integrations. For EVM wallets this might be a reviewed wallet plugin/snap or
   smart-account policy. SOL and BTC need their **own** permitted wallet integrations. The scanner alone cannot
   block signing in arbitrary wallets or mobile dApps.
5. Add phishing domain reputation and suspicious contract checks with clear false-positive/false-negative handling,
   privacy protection, rate limits, fail-closed behaviour and audit logs.
6. Comprehensive adversarial testing, fuzzing, dependency pinning, independent audit and production key handling.

Safe-specific protections require independent signing-device display of the true canonical SafeTx hash and its
meaningful fields, transaction simulation, verifyingContract/domain checks, and contract-enforced policy such as
restricting `DELEGATECALL` and sensitive implementation/module changes. An ordinary website cannot guarantee
truthfulness after its own JavaScript is compromised. MetaMask transaction-insight Snaps supply information inside
wallet confirmation, but must not be represented as universal transaction blockers.

## Phase 3 — Post-quantum protection, separately reviewed

NIST ML-DSA can sign at our own application/network layer, but it **does not alter BTC, SOL, BNB or Ethereum consensus
transaction signatures**. On our private Besu/EVM chain, native transaction authentication also remains classical
until a protocol-level implementation or fully enforced verified smart-account authorization path is built and
audited. A mere PQ public-key hash in a contract is not equivalent to verifying a PQ signature.

If enforcing a second PQ authorization on a supported smart account, require a provably correct verifier,
domain separation, replay protection, atomic key rotation, recovery, explicit account owner consent and analysis of
wallet compatibility and gas costs. Do not silently change keys or migrate funds.

## Rollout policy

- Always preview and request explicit user approval before signing, broadcasting, changing permissions or moving assets.
- For undecoded payloads, unknown token programs, unverifiable wallet state or missing data, return **manual review**.
- Do not advertise the product as audited, quantum-secure, phishing-proof, theft-proof or a production wallet firewall.
- Use official RPC and wallet APIs only when permissions and integration scope allow them; do not request or collect seeds.
