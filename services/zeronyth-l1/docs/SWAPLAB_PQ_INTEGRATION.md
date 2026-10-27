# Native Swap Lab — Quantum Resistance Integration Path

## Current
- SwapLab.sol uses standard EVM calls.
- Research path uses ML-DSA.

## Required for PQ consistency
- Any native swap/bridge that settles on ZERONYTH must verify
  authorizing signatures with ML-DSA (or call into the PQ verification path).
- Do not present external ECDSA DEX routes as quantum-resistant.
- See QUANTUM_RESISTANCE_SWAP_BRIDGE.md for policy.
