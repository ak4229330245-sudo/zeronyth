/**
 * Isolated, in-memory key-registry experiment. NOT a Besu hook or deployed contract.
 * All policy, role, chain, epoch and nonce fields are signed; hybrid means AND.
 */
import { sign, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { checkShape, digest, publicKeyObject, uint } from '../../pq-native/pq.mjs';
const require = createRequire(new URL('../../faucet/package.json', import.meta.url));
const { keccak256, recoverAddress, getAddress } = require('ethers');
const DOMAIN = 'ZERONYTH_ISOLATED_ROTATION_V1\0';

function canonical(payload) {
  checkShape(payload, ['kind', 'chainId', 'role', 'policy', 'account',
    'epoch', 'nonce', 'action', 'body'], 'authorization payload');
  if (payload.kind !== 'ZERONYTH_ISOLATED_ROTATION_V1') throw Error('Wrong domain');
  uint(payload.chainId, 'chainId', { min: 1n });
  uint(payload.nonce, 'nonce');
  if (!Number.isSafeInteger(payload.epoch) || payload.epoch < 0) throw Error('Invalid epoch');
  if (!['account', 'validator'].includes(payload.role)) throw Error('Invalid role');
  if (!['pq-only', 'hybrid-and'].includes(payload.policy)) throw Error('Invalid policy');
  if (!/^lab_[a-f0-9]{64}$/.test(payload.account)) throw Error('Invalid lab account');
  let body;
  if (payload.action === 'rotate') {
    checkShape(payload.body, ['nextPublicKey', 'activateAt'], 'rotation body');
    publicKeyObject(payload.body.nextPublicKey);
    if (!Number.isSafeInteger(payload.body.activateAt) || payload.body.activateAt < 0) {
      throw Error('Invalid activation height');
    }
    body = { nextPublicKey: payload.body.nextPublicKey, activateAt: payload.body.activateAt };
  } else if (payload.action === 'authorize') {
    checkShape(payload.body, ['operationHash'], 'operation body');
    if (!/^[a-f0-9]{64}$/.test(payload.body.operationHash)) throw Error('Invalid operation hash');
    body = { operationHash: payload.body.operationHash };
  } else throw Error('Invalid action');
  return { kind: payload.kind, chainId: payload.chainId, role: payload.role,
    policy: payload.policy, account: payload.account, epoch: payload.epoch,
    nonce: payload.nonce, action: payload.action, body };
}

function bytes(payload) {
  return Buffer.from(DOMAIN + JSON.stringify(canonical(payload)));
}

function pqVerify(payload, signature, publicKey) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
    throw Error('Invalid signature encoding');
  }
  const raw = Buffer.from(signature, 'base64');
  if (raw.length !== 3309 || raw.toString('base64') !== signature ||
      !verify(null, bytes(payload), publicKeyObject(publicKey), raw)) {
    throw Error('Invalid ML-DSA signature');
  }
}

export function signAuthorization(payload, privateKey, { nextPrivateKey, legacySigner } = {}) {
  const ordered = canonical(payload);
  if (privateKey?.asymmetricKeyType !== 'ml-dsa-65') throw Error('ML-DSA-65 key required');
  const result = { payload: ordered,
    signature: sign(null, bytes(ordered), privateKey).toString('base64') };
  if (ordered.action === 'rotate') {
    if (nextPrivateKey?.asymmetricKeyType !== 'ml-dsa-65') throw Error('New key proof required');
    result.nextSignature = sign(null, bytes(ordered), nextPrivateKey).toString('base64');
  }
  if (ordered.policy === 'hybrid-and') {
    if (!legacySigner) throw Error('Legacy signature also required');
    result.legacySignature = legacySigner.sign(keccak256(bytes(ordered))).serialized;
  }
  return result;
}

export class RotationRegistry {
  #publicKey; #pending = null; #epoch = 0; #nonce = 0n; #height = 0;
  #chainId; #role; #policy; #account; #legacyAddress;
  constructor({ publicKey, chainId = '19127', role = 'account',
    policy = 'pq-only', legacyAddress = null }) {
    publicKeyObject(publicKey);
    uint(chainId, 'chainId', { min: 1n });
    if (!['account', 'validator'].includes(role) ||
        !['pq-only', 'hybrid-and'].includes(policy)) throw Error('Invalid role or policy');
    if (policy === 'hybrid-and') this.#legacyAddress = getAddress(legacyAddress);
    this.#publicKey = publicKey;
    this.#chainId = chainId; this.#role = role; this.#policy = policy;
    // A stable lab registry identity, NOT an Ethereum or pq-native key-derived address.
    this.#account = 'lab_' + digest(DOMAIN, `${chainId}\0${role}\0${policy}\0${publicKey}`);
  }
  snapshot() {
    return { account: this.#account, publicKey: this.#publicKey, epoch: this.#epoch,
      nonce: String(this.#nonce), height: this.#height,
      pending: this.#pending ? { ...this.#pending } : null };
  }
  advanceTo(height) {
    if (!Number.isSafeInteger(height) || height < this.#height) throw Error('Height rollback rejected');
    this.#height = height;
    if (this.#pending && height >= this.#pending.activateAt) {
      this.#publicKey = this.#pending.nextPublicKey;
      this.#pending = null;
      this.#epoch++;
    }
  }
  payload(action, body) {
    return canonical({ kind: 'ZERONYTH_ISOLATED_ROTATION_V1', chainId: this.#chainId,
      role: this.#role, policy: this.#policy, account: this.#account, epoch: this.#epoch,
      nonce: String(this.#nonce), action, body });
  }
  apply(envelope) {
    const payload = canonical(envelope?.payload);
    const fields = ['payload', 'signature'];
    if (payload.action === 'rotate') fields.push('nextSignature');
    if (this.#policy === 'hybrid-and') fields.push('legacySignature');
    checkShape(envelope, fields, 'authorization envelope');
    if (payload.chainId !== this.#chainId || payload.role !== this.#role ||
        payload.policy !== this.#policy || payload.account !== this.#account ||
        payload.epoch !== this.#epoch || payload.nonce !== String(this.#nonce)) {
      throw Error('Policy, role, chain, epoch or nonce replay rejected');
    }
    pqVerify(payload, envelope.signature, this.#publicKey);
    if (this.#policy === 'hybrid-and' &&
        recoverAddress(keccak256(bytes(payload)), envelope.legacySignature) !== this.#legacyAddress) {
      throw Error('Invalid legacy signature');
    }
    if (payload.action === 'rotate') {
      if (this.#pending) throw Error('Pending rotation already exists');
      if (payload.body.activateAt <= this.#height) throw Error('Activation must be a future height');
      if (payload.body.nextPublicKey === this.#publicKey) throw Error('Same-key rotation rejected');
      pqVerify(payload, envelope.nextSignature, payload.body.nextPublicKey);
      this.#pending = { ...payload.body };
    }
    // No state is changed on any failing check.
    this.#nonce++;
    return this.snapshot();
  }
}
