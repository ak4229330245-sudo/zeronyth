# Quantum Resistance for Swap, Bridge, and Cross-Chain

## Policy
All swap, liquidity, bridge, and cross-chain operations must preserve quantum resistance.

## Current state
- External testnet DEXes (Uniswap, PancakeSwap, etc.) use standard ECDSA.
- ZERONYTH Swap Lab (Chain ID 9127) uses local contracts.
- The native research path uses ML-DSA-65 with full verification.
- Bridge capabilities are limited and marked where official testnet bridges exist.

## Requirements going forward
1. Any native ZERONYTH swap/bridge path must verify signatures with ML-DSA (or equivalent PQ scheme).
2. Do not route user transactions through paths that skip PQ verification.
3. Cross-chain messages that affect ZERONYTH state must be authenticated with PQ signatures where the chain controls the verification.
4. External chain interactions (Sepolia, etc.) remain testnet-only and are clearly labeled as non-PQ.
5. UI must not present external ECDSA paths as quantum-resistant.

## Implementation notes
- Research lab parallel pools continue full ML-DSA verification.
- No signature shortcuts added for speed.
- Future native DEX/bridge contracts should integrate the PQ verification path.
