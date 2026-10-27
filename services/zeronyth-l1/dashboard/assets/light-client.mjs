// ZERONYTH light client core: pure browser/Node ESM, no secrets, no network side effects.
// Verifies QBFT headers fetched through the read-only gateway RPC:
//   1. keccak(rlp(header)) must equal the reported block hash (header integrity)
//   2. parentHash links to the previously verified header (chain continuity)
//   3. committed seals (secp256k1 ECDSA) recover to > 2/3 of the current validator set
//   4. validator set changes are taken from the verified extraData of each header
import { keccak_256, secp256k1 } from './vendor-noble.mjs';

export const hexToBytes = (hex) => {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2) throw new Error('odd hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
};
export const bytesToHex = (b) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const concat = (...arrs) => { const n = arrs.reduce((a, b) => a + b.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
const intBytes = (hex) => { let h = BigInt(hex).toString(16); if (h === '0') return new Uint8Array(0); if (h.length % 2) h = '0' + h; return hexToBytes(h); };

// ---- RLP ----
function encLen(len, offset) {
  if (len < 56) return Uint8Array.of(offset + len);
  let h = len.toString(16); if (h.length % 2) h = '0' + h; const lb = hexToBytes(h);
  return concat(Uint8Array.of(offset + 55 + lb.length), lb);
}
export function rlpEncode(item) {
  if (Array.isArray(item)) { const body = concat(...item.map(rlpEncode)); return concat(encLen(body.length, 0xc0), body); }
  if (item.length === 1 && item[0] < 0x80) return item;
  return concat(encLen(item.length, 0x80), item);
}
export function rlpDecode(bytes) {
  const [item, end] = decodeAt(bytes, 0);
  if (end !== bytes.length) throw new Error('rlp: trailing bytes');
  return item;
}
function decodeAt(b, p) {
  const x = b[p];
  if (x === undefined) throw new Error('rlp: truncated');
  if (x < 0x80) return [b.subarray(p, p + 1), p + 1];
  const readLen = (n, at) => { let l = 0; for (let i = 0; i < n; i++) l = l * 256 + b[at + i]; return l; };
  let len, start, list;
  if (x < 0xb8) { len = x - 0x80; start = p + 1; list = false; }
  else if (x < 0xc0) { const n = x - 0xb7; len = readLen(n, p + 1); start = p + 1 + n; list = false; }
  else if (x < 0xf8) { len = x - 0xc0; start = p + 1; list = true; }
  else { const n = x - 0xf7; len = readLen(n, p + 1); start = p + 1 + n; list = true; }
  const end = start + len;
  if (end > b.length) throw new Error('rlp: length overflow');
  if (!list) return [b.subarray(start, end), end];
  const items = []; let q = start;
  while (q < end) { const [it, nq] = decodeAt(b, q); items.push(it); q = nq; }
  if (q !== end) throw new Error('rlp: bad list');
  return [items, end];
}

// ---- QBFT extraData ----
export function decodeExtra(extraHex) {
  const d = rlpDecode(hexToBytes(extraHex));
  if (!Array.isArray(d) || d.length !== 5) throw new Error('extraData: expected 5 fields (QBFT)');
  const [vanity, validators, vote, round, seals] = d;
  return {
    vanity, round, vote, seals,
    validators: validators.map((v) => bytesToHex(v).toLowerCase()),
    voteParsed: Array.isArray(vote) && vote.length === 2
      ? { address: bytesToHex(vote[0]).toLowerCase(), add: vote[1].length > 0 && vote[1][0] === 0xff } : null,
    roundNumber: round.length ? Number(BigInt(bytesToHex(round))) : 0,
  };
}

const HEADER_FIELDS = [
  ['parentHash', 'b'], ['sha3Uncles', 'b'], ['miner', 'b'], ['stateRoot', 'b'], ['transactionsRoot', 'b'],
  ['receiptsRoot', 'b'], ['logsBloom', 'b'], ['difficulty', 'i'], ['number', 'i'], ['gasLimit', 'i'],
  ['gasUsed', 'i'], ['timestamp', 'i'], ['extraData', 'b'], ['mixHash', 'b'], ['nonce', 'b'],
];
const OPTIONAL_FIELDS = [
  ['baseFeePerGas', 'i'], ['withdrawalsRoot', 'b'], ['blobGasUsed', 'i'], ['excessBlobGas', 'i'],
  ['parentBeaconBlockRoot', 'b'], ['requestsHash', 'b'],
];
function headerList(block, extraBytes) {
  const out = [];
  for (const [k, t] of HEADER_FIELDS) {
    if (k === 'extraData') { out.push(extraBytes); continue; }
    if (block[k] === undefined) throw new Error(`header field missing: ${k}`);
    out.push(t === 'i' ? intBytes(block[k]) : hexToBytes(block[k]));
  }
  for (const [k, t] of OPTIONAL_FIELDS) {
    if (block[k] === undefined || block[k] === null) break;
    out.push(t === 'i' ? intBytes(block[k]) : hexToBytes(block[k]));
  }
  return out;
}
const extraWithoutSeals = (e, keepRound) => rlpEncode([e.vanity, e.validators.map(hexToBytes), e.vote, keepRound ? e.round : new Uint8Array(0), []]);

// QBFT on-chain block hash: header with committed seals removed and round zeroed.
export const qbftBlockHash = (block, e) => bytesToHex(keccak_256(rlpEncode(headerList(block, extraWithoutSeals(e, false)))));
// Committed seals sign the hash of the header with seals removed but round kept.
export const qbftSealHash = (block, e) => keccak_256(rlpEncode(headerList(block, extraWithoutSeals(e, true))));

export function recoverAddress(hash32, sig65) {
  if (sig65.length !== 65) throw new Error('seal length');
  let v = sig65[64]; if (v >= 27) v -= 27;
  const sig = secp256k1.Signature.fromCompact(sig65.subarray(0, 64)).addRecoveryBit(v);
  const pub = sig.recoverPublicKey(hash32).toRawBytes(false);
  return bytesToHex(keccak_256(pub.subarray(1)).subarray(12)).toLowerCase();
}

export const quorumSize = (n) => Math.ceil((2 * n) / 3); // Besu BftHelpers.calculateRequiredValidatorQuorum

// Verify one header against a trusted validator set. Returns details or throws.
export function verifyHeader(block, trustedValidators, parent = null) {
  const e = decodeExtra(block.extraData);
  const hash = qbftBlockHash(block, e);
  if (hash.toLowerCase() !== block.hash.toLowerCase()) throw new Error(`header hash mismatch at ${parseInt(block.number, 16)}`);
  if (parent && parent.hash.toLowerCase() !== block.parentHash.toLowerCase()) throw new Error('parentHash does not link to verified parent');
  const sealHash = qbftSealHash(block, e);
  const trusted = new Set(trustedValidators.map((a) => a.toLowerCase()));
  const signers = new Set();
  for (const s of e.seals) {
    const addr = recoverAddress(sealHash, s);
    if (!trusted.has(addr)) throw new Error(`seal from non-validator ${addr}`);
    signers.add(addr);
  }
  const need = quorumSize(trusted.size);
  if (signers.size < need) throw new Error(`insufficient seals ${signers.size}/${need}`);
  return { number: parseInt(block.number, 16), hash, signers: [...signers], need, nextValidators: e.validators, vote: e.voteParsed, round: e.roundNumber };
}

export function validatorSetHash(validators) {
  const sorted = [...validators].map((a) => a.toLowerCase()).sort();
  return bytesToHex(keccak_256(new TextEncoder().encode(sorted.join(','))));
}
