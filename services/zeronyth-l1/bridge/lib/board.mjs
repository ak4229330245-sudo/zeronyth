// Coordinator-free signature gossip via BridgeAttestationBoard on chain 9127 (see src/BridgeAttestationBoard.sol).
// Relayers post their own signatures; anybody reads them back from the Attested events and checks the ECDSA signer
// against the destination contract's on-chain relayer set before using them.
import { Contract, verifyMessage, getBytes, hexlify } from 'ethers';
import { createHash } from 'node:crypto';
import { artifact, pqVerify } from './bridge.mjs';

export const boardContract = (addr, runner) => new Contract(addr, artifact('BridgeAttestationBoard').abi, runner);
export const timelockContract = (addr, runner) => new Contract(addr, artifact('BridgeTimelock').abi, runner);

/** All board attestations for one digest: [{ signer, sig, mldsaSig, tx, block, ecdsaOk }]. */
export async function attestationsFor(board, digest, fromBlock) {
  const evs = await board.queryFilter(board.filters.Attested(digest), fromBlock, 'latest');
  return evs.map((e) => {
    let ok = false; try { ok = verifyMessage(getBytes(digest), e.args.ecdsaSig) === e.args.signer; } catch {}
    return { signer: e.args.signer, sig: e.args.ecdsaSig, mldsaSig: e.args.mldsaSig, tx: e.transactionHash, block: e.blockNumber, ecdsaOk: ok };
  });
}

/** Registered operators: address => { label, machine, mldsaPublicKey, mldsaPkSha256, tx } (latest registration wins). */
export async function operatorsFrom(board, fromBlock) {
  const out = {};
  for (const e of await board.queryFilter(board.filters.OperatorRegistered(), fromBlock, 'latest')) {
    const pk = e.args.mldsaPublicKey;
    out[e.args.relayer] = { address: e.args.relayer, label: e.args.label, machine: e.args.machine, mldsaPublicKey: pk,
      mldsaPkSha256: '0x' + createHash('sha256').update(getBytes(pk)).digest('hex'), tx: e.transactionHash, block: e.blockNumber };
  }
  return out;
}

/** Pick `threshold` valid signatures from `relayerSet` (sorted ascending by signer, as the contracts require). */
/// When `operators` (board registrations) and `digest` are given, a signer only counts if its ML-DSA-65 signature also
/// verifies in full against the ML-DSA public key it registered on the board (post-quantum check, off-chain).
export function pickSigs(atts, relayerSet, threshold, operators = null, digest = null) {
  const good = new Map();
  for (const a of atts) {
    if (!a.ecdsaOk || !relayerSet.has(a.signer) || good.has(a.signer)) continue;
    if (operators) {
      const o = operators[a.signer];
      let pq = false; try { pq = !!o && pqVerify(hexlify(o.mldsaPublicKey), digest, a.mldsaSig); } catch {}
      a.mldsaOk = pq;
      if (!pq) continue;
    }
    good.set(a.signer, a.sig);
  }
  const sorted = [...good.entries()].sort((x, y) => (BigInt(x[0]) < BigInt(y[0]) ? -1 : 1));
  return { valid: sorted.length, signers: sorted.map((e) => e[0]), sigs: sorted.slice(0, threshold).map((e) => e[1]) };
}

export function verifyMldsa(atts, operators, digest) {
  return atts.filter((a) => operators[a.signer] && pqVerify(hexlify(operators[a.signer].mldsaPublicKey), digest, a.mldsaSig)).length;
}

/** Deterministic submit order: transfer-dependent rotation over the sorted relayer list (no coordinator needed). */
export function submitRank(sortedRelayers, mine, srcChainId, nonce) {
  const n = sortedRelayers.length; if (!n) return 0;
  const start = Number((BigInt(srcChainId) + BigInt(nonce)) % BigInt(n));
  let best = n;
  for (const a of mine) { const i = sortedRelayers.indexOf(a); if (i >= 0) best = Math.min(best, (i - start + n) % n); }
  return best;
}
