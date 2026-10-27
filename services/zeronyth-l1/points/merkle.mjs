// Claim-style Merkle tree (OpenZeppelin MerkleProof compatible: sorted-pair keccak256).
// leaf = keccak256(abi.encodePacked(address account, uint256 centipoints))  (centipoints = points * 100, integer)
import { keccak256, solidityPacked, getAddress } from 'ethers';
export const leafOf = (address, cp) => keccak256(solidityPacked(['address', 'uint256'], [getAddress(address), BigInt(cp)]));
const pair = (a, b) => keccak256(a.toLowerCase() < b.toLowerCase() ? a + b.slice(2) : b + a.slice(2));
export function build(leaves) {
  const sorted = [...leaves].sort();
  if (!sorted.length) return { root: '0x' + '0'.repeat(64), layers: [[]] };
  const layers = [sorted];
  while (layers.at(-1).length > 1) {
    const l = layers.at(-1), n = [];
    for (let i = 0; i < l.length; i += 2) n.push(i + 1 < l.length ? pair(l[i], l[i + 1]) : l[i]);
    layers.push(n);
  }
  return { root: layers.at(-1)[0], layers };
}
export function proof(tree, leaf) {
  let idx = tree.layers[0].indexOf(leaf); if (idx < 0) return null; const out = [];
  for (const l of tree.layers.slice(0, -1)) { const sib = idx ^ 1; if (sib < l.length) out.push(l[sib]); idx >>= 1; }
  return out;
}
export const verify = (root, leaf, prf) => prf.reduce((h, p) => pair(h, p), leaf) === root;
