/** ZERONYTH experimental ML-DSA-only primitives. Node.js 24+ required. */
import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify,
} from 'node:crypto';

export const ALGORITHM = 'ml-dsa-65';
export const TX_KIND = 'ZERONYTH_PQ_TX_V1';
export const VOTE_KIND = 'ZERONYTH_PQ_VOTE_V1';
export const PROPOSAL_KIND = 'ZERONYTH_PQ_PROPOSAL_V1';
export const GENESIS_KIND = 'ZERONYTH_PQ_GENESIS_V1';
export const BLOCK_KIND = 'ZERONYTH_PQ_BLOCK_V1';
export const MAX_UINT = (1n << 128n) - 1n;
const MAX_KEY_CACHE = 1024;
const importedPublicKeys = new Map();
// Weakly associate a validated in-process private KeyObject with its PUBLIC
// SPKI bytes. Never cache private-key material or a signature result.
const signerPublicKeys = new WeakMap();

export class ProtocolError extends Error {
  constructor(message) { super(message); this.name = 'ProtocolError'; }
}

export function checkShape(object, keys, label) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw new ProtocolError(`${label}: object required`);
  }
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ProtocolError(`${label}: unexpected or missing fields`);
  }
}

export function uint(value, label, { min = 0n } = {}) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value)) {
    throw new ProtocolError(`${label}: canonical decimal string required`);
  }
  const number = BigInt(value);
  if (number < min || number > MAX_UINT) throw new ProtocolError(`${label}: out of range`);
  return number;
}

export function chainId(value) {
  const number = uint(value, 'chainId', { min: 1n });
  if (number > 4294967295n) throw new ProtocolError('chainId too large for this lab');
  return value;
}

export function assertAddress(address) {
  if (typeof address !== 'string' || !/^qspq_[0-9a-f]{64}$/.test(address)) {
    throw new ProtocolError('Invalid ZERONYTH PQ address');
  }
  return address;
}

function readBase64(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new ProtocolError(`${label}: invalid base64`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.toString('base64') !== value) {
    throw new ProtocolError(`${label}: noncanonical base64`);
  }
  return decoded;
}

function importedPublicKeyRecord(publicKey) {
  const cached = importedPublicKeys.get(publicKey);
  if (cached) return cached;
  const der = readBase64(publicKey, 'publicKey');
  let key;
  try { key = createPublicKey({ key: der, format: 'der', type: 'spki' }); }
  catch { throw new ProtocolError('Invalid public key encoding'); }
  if (key.asymmetricKeyType !== ALGORITHM) {
    throw new ProtocolError(`ECDSA/legacy key rejected: ML-DSA-65 only`);
  }
  if (!key.export({ format: 'der', type: 'spki' }).equals(der)) {
    throw new ProtocolError('Noncanonical public key encoding');
  }
  // ML-DSA SPKI bytes were fully validated as canonical before computing the
  // identity. Cache their immutable address and key together; address derivation
  // previously exported/hash-processed the 2 KB public key on every tx/vote.
  // This is an identity cache, NOT a cached signature-verification verdict.
  const record = { key, address:`qspq_${digest('ZERONYTH_PQ_ACCOUNT_V1\0', der)}` };
  if (importedPublicKeys.size >= MAX_KEY_CACHE) {
    importedPublicKeys.delete(importedPublicKeys.keys().next().value);
  }
  importedPublicKeys.set(publicKey, record);
  return record;
}

export function publicKeyObject(publicKey) {
  return importedPublicKeyRecord(publicKey).key;
}

export function addressOf(publicKey) {
  return importedPublicKeyRecord(publicKey).address;
}

export function digest(domain, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(domain, 'utf8').update(bytes).digest('hex');
}

function message(domain, ordered) {
  return Buffer.from(`${domain}\0${JSON.stringify(ordered)}`, 'utf8');
}

function requirePrivate(privateKey) {
  let key;
  try {
    key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  } catch { throw new ProtocolError('Invalid private key'); }
  if (!key || key.asymmetricKeyType !== ALGORITHM || key.type !== 'private') {
    throw new ProtocolError('ML-DSA-65 private key required; ECDSA prohibited');
  }
  return key;
}

export function generateIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync(ALGORITHM);
  const encoded = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  signerPublicKeys.set(privateKey, encoded);
  return { privateKey, publicKey: encoded, address: addressOf(encoded) };
}

function publicKeyOfSigner(key) {
  let encoded = signerPublicKeys.get(key);
  if (!encoded) {
    encoded = createPublicKey(key).export({ format:'der', type:'spki' }).toString('base64');
    signerPublicKeys.set(key, encoded);
  }
  return encoded;
}

export function exportPrivatePem(privateKey) {
  return requirePrivate(privateKey).export({ format: 'pem', type: 'pkcs8' }).toString();
}

function unsignedTxFields(tx) {
  if (tx.kind !== TX_KIND) throw new ProtocolError('Unknown transaction type');
  chainId(tx.chainId);
  uint(tx.nonce, 'nonce');
  uint(tx.value, 'value', { min: 1n });
  assertAddress(tx.to);
  if (typeof tx.memo !== 'string' || !/^[\x20-\x7e]{0,120}$/.test(tx.memo)) {
    throw new ProtocolError('memo must be <=120 printable ASCII bytes');
  }
  publicKeyObject(tx.publicKey);
  return {
    kind: TX_KIND, chainId: tx.chainId, nonce: tx.nonce, to: tx.to,
    value: tx.value, memo: tx.memo, publicKey: tx.publicKey,
  };
}

export function signTransaction({ chainId: id, nonce, to, value, memo = '' }, privateKey) {
  const key = requirePrivate(privateKey);
  const publicKey = publicKeyOfSigner(key);
  const unsigned = unsignedTxFields({
    kind: TX_KIND, chainId: id, nonce, to, value, memo, publicKey,
  });
  const signature = sign(null, message('ZERONYTH_MLDSA_TX_V1', unsigned), key);
  return { ...unsigned, signature: signature.toString('base64') };
}

export function verifyTransaction(tx, expectedChainId) {
  checkShape(tx, ['kind','chainId','nonce','to','value','memo','publicKey','signature'], 'transaction');
  const unsigned = unsignedTxFields(tx);
  if (expectedChainId !== undefined && tx.chainId !== expectedChainId) {
    throw new ProtocolError('Cross-chain replay rejected');
  }
  const signature = readBase64(tx.signature, 'transaction signature');
  if (signature.length !== 3309 || !verify(
    null, message('ZERONYTH_MLDSA_TX_V1', unsigned),
    publicKeyObject(tx.publicKey), signature,
  )) throw new ProtocolError('Invalid ML-DSA transaction signature');
  return { sender: addressOf(tx.publicKey), nonce: uint(tx.nonce,'nonce'), value: uint(tx.value,'value') };
}

export function canonicalTransaction(tx) {
  checkShape(tx, ['kind','chainId','nonce','to','value','memo','publicKey','signature'], 'transaction');
  const unsigned = unsignedTxFields(tx);
  return { ...unsigned, signature: tx.signature };
}

export function hashBlock(header) {
  return digest('ZERONYTH_MLDSA_BLOCK_HASH_V1\0', JSON.stringify({
    kind:header.kind, chainId:header.chainId, height:header.height, round:header.round,
    previousHash:header.previousHash, proposer:header.proposer,
    transactionsHash:header.transactionsHash, stateRoot:header.stateRoot,
  }));
}

function proposalBody(header) {
  return {
    kind: PROPOSAL_KIND, chainId: header.chainId,
    height: header.height, round: header.round, blockHash: hashBlock(header),
  };
}

export function signProposal(header, privateKey) {
  const key = requirePrivate(privateKey);
  const publicKey = publicKeyOfSigner(key);
  const proposer = addressOf(publicKey);
  if (proposer !== header.proposer) throw new ProtocolError('Only designated leader may sign proposal');
  return {
    validator: proposer, blockHash: hashBlock(header),
    signature: sign(null, message('ZERONYTH_MLDSA_PROPOSAL_V1', proposalBody(header)), key).toString('base64'),
  };
}

export function verifyProposal(header, seal, publicKey) {
  checkShape(seal, ['validator','blockHash','signature'], 'proposal seal');
  if (seal.validator !== header.proposer || seal.validator !== addressOf(publicKey) ||
      seal.blockHash !== hashBlock(header)) throw new ProtocolError('Proposal seal mismatch');
  const signature = readBase64(seal.signature, 'proposal signature');
  if (signature.length !== 3309 || !verify(
    null, message('ZERONYTH_MLDSA_PROPOSAL_V1', proposalBody(header)),
    publicKeyObject(publicKey), signature,
  )) throw new ProtocolError('Invalid ML-DSA proposer signature');
  return true;
}

function voteBody(header) {
  return {
    kind: VOTE_KIND, chainId: header.chainId, height: header.height,
    round: header.round, blockHash: hashBlock(header),
  };
}

export function signVote(header, privateKey) {
  const key = requirePrivate(privateKey);
  const publicKey = publicKeyOfSigner(key);
  return {
    validator: addressOf(publicKey), blockHash: hashBlock(header),
    signature: sign(null, message('ZERONYTH_MLDSA_VOTE_V1', voteBody(header)), key).toString('base64'),
  };
}

export function verifyVote(header, vote, validatorPublicKey) {
  checkShape(vote, ['validator','blockHash','signature'], 'vote');
  if (vote.validator !== addressOf(validatorPublicKey) || vote.blockHash !== hashBlock(header)) {
    throw new ProtocolError('Vote identity/block mismatch');
  }
  const signature = readBase64(vote.signature, 'vote signature');
  if (signature.length !== 3309 || !verify(
    null, message('ZERONYTH_MLDSA_VOTE_V1', voteBody(header)),
    publicKeyObject(validatorPublicKey), signature,
  )) throw new ProtocolError('Invalid ML-DSA validator vote');
  return true;
}
