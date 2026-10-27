# Quantum Resistance Pillar

## Current state
- Research lab uses ML-DSA-65 for all signatures.
- Parallel verification pools (up to 12 workers) perform full ML-DSA checks.
- No cryptographic shortcuts.
- Main Besu/QBFT chain remains ECDSA (separate from research path).

## Direction
- Keep ML-DSA verification mandatory in the native path.
- Document migration path from ECDSA research to PQ when ready.
- All speed improvements preserve full signature verification.
