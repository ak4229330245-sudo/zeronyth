# Quantum-Resistant Swap and Bridge

## Policy
Native ZERONYTH swap and bridge operations must use ML-DSA (or equivalent)
for authorization. External testnet DEX/bridge routes remain ECDSA and must
be clearly labeled as non-quantum-resistant.

## Implementation direction
1. Any swap or bridge that settles on Chain ID 9127 verifies the user
   signature with the research-path ML-DSA verifier.
2. Cross-chain messages controlled by ZERONYTH carry a PQ signature.
3. UI shows two modes:
   - Native (PQ) — uses ML-DSA
   - External testnet — ECDSA, labeled "Not quantum-resistant"
4. No speed optimization may skip PQ verification on the native path.

## Current status
- Research lab: full ML-DSA verification (parallelized, not skipped)
- External DEXes: ECDSA (labeled)
- Native Swap Lab: ready for PQ signature check integration
