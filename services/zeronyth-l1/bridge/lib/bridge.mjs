// Shared bridge helpers: contract artifacts, attestation digest (must match BridgeAttestation.sol), ML-DSA-65 audit
// signatures, deterministic CREATE2 addresses, deployment records and atomic JSON state files.
import { AbiCoder, keccak256, toUtf8Bytes, getBytes, hexlify, zeroPadValue, getCreate2Address, getCreateAddress,
  ContractFactory, Contract, JsonRpcProvider, FetchRequest } from 'ethers';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { bridgeRoot } from './keys.mjs';
import { ml_dsa65 } from '../../dashboard/assets/vendor-noble.mjs';

export const TAG = keccak256(toUtf8Bytes('ZERONYTH_BRIDGE_V1'));
export const CREATE2_FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C'; // Arachnid deterministic deployment proxy
export const MINTER_SALT = keccak256(toUtf8Bytes('ZERONYTH_BRIDGE_V1/minter'));
export const PQ_PREFIX = toUtf8Bytes('ZERONYTH_BRIDGE_V1/ML-DSA-65:');
const coder = AbiCoder.defaultAbiCoder();

export function artifact(name) { return JSON.parse(readFileSync(path.join(bridgeRoot, 'abi', `${name}.json`), 'utf8')); }
export const toB32 = (addr) => zeroPadValue(addr, 32);

export function digest({ srcChainId, srcContract, dstChainId, dstContract, nonce, recipient, amount }) {
  return keccak256(coder.encode(['bytes32', 'uint256', 'address', 'uint256', 'address', 'uint256', 'bytes32', 'uint256'],
    [TAG, srcChainId, srcContract, dstChainId, dstContract, nonce, recipient, amount]));
}
/** ML-DSA-65 message = prefix || digest (32 bytes). Verifiable by anyone with the relayer's public key. */
export const pqMessage = (d) => new Uint8Array([...PQ_PREFIX, ...getBytes(d)]);
export function pqSign(relayer, d) { return hexlify(ml_dsa65.sign(pqMessage(d), relayer.mldsa.secretKey)); }
export function pqVerify(pkHex, d, sigHex) {
  try { return ml_dsa65.verify(getBytes(sigHex), pqMessage(d), getBytes(pkHex)); } catch { return false; }
}

export function minterInitCode({ owner, guardian, relayers, threshold, srcChainId, srcVault, caps }) {
  const a = artifact('BridgeMinter');
  const f = new ContractFactory(a.abi, a.bytecode);
  return f.interface.encodeDeploy([owner, guardian, relayers, threshold, srcChainId, srcVault, caps.min, caps.max, caps.daily])
    .replace(/^0x/, a.bytecode);
}
export const create2Address = (initCode) => getCreate2Address(CREATE2_FACTORY, MINTER_SALT, keccak256(initCode));
export const tokenAddressOf = (minter) => getCreateAddress({ from: minter, nonce: 1 }); // first CREATE inside the constructor

export function provider(rpc, chainId) {
  const req = new FetchRequest(rpc); req.timeout = 15_000;
  return new JsonRpcProvider(req, chainId, { staticNetwork: true, batchMaxCount: 10 });
}
export const vaultContract = (addr, runner) => new Contract(addr, artifact('ZnytBridgeVault').abi, runner);
export const minterContract = (addr, runner) => new Contract(addr, artifact('BridgeMinter').abi, runner);
export const tokenContract = (addr, runner) => new Contract(addr, artifact('WrappedZnyt').abi, runner);

export const NETWORK = process.env.BRIDGE_NETWORK || 'main';
export const STATE_DIR = process.env.BRIDGE_STATE_DIR || path.join(bridgeRoot, 'state', NETWORK);
export const depFile = () => path.join(bridgeRoot, 'deployments', `${NETWORK}.json`);
export function loadDeployment() { return existsSync(depFile()) ? JSON.parse(readFileSync(depFile(), 'utf8')) : {}; }
export function saveDeployment(d) { writeJson(depFile(), d); }

export function readJson(f, dflt) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return dflt; } }
export function writeJson(f, v) {
  mkdirSync(path.dirname(f), { recursive: true });
  const t = `${f}.${process.pid}.tmp`;
  writeFileSync(t, JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2) + '\n');
  renameSync(t, f);
}
export function appendJsonl(f, v) {
  mkdirSync(path.dirname(f), { recursive: true });
  appendFileSync(f, JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)) + '\n');
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const transferId = (srcChainId, nonce) => `${srcChainId}-${nonce}`;
