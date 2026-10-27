/** Read-only audit: recover signers from a real QBFT block's committed seals. */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../faucet/package.json', import.meta.url));
const { decodeRlp, encodeRlp, keccak256, recoverAddress } = require('ethers');
const rpc = async (method, params = []) => {
  const result = await (await fetch('http://127.0.0.1:8545', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })).json();
  if (result.error) throw Error(JSON.stringify(result.error));
  return result.result;
};
const block = await rpc('eth_getBlockByNumber', ['latest', false]);
const validators = await rpc('qbft_getValidatorsByBlockNumber', [block.number]);
const extra = decodeRlp(block.extraData);
if (!Array.isArray(extra) || extra.length !== 5 || !Array.isArray(extra[4])) {
  throw Error('Unexpected QBFT extraData shape');
}
const seals = extra[4];
const number = hex => {
  let s = BigInt(hex).toString(16);
  if (s === '0') return '0x';
  if (s.length % 2) s = '0' + s;
  return '0x' + s;
};
// Besu BftBlockHashing: committed-seal hash keeps round and excludes seals.
const header = [
  block.parentHash, block.sha3Uncles, block.miner, block.stateRoot,
  block.transactionsRoot, block.receiptsRoot, block.logsBloom,
  number(block.difficulty), number(block.number), number(block.gasLimit),
  number(block.gasUsed), number(block.timestamp), encodeRlp([...extra.slice(0, 4), []]),
  block.mixHash, block.nonce,
];
if (block.baseFeePerGas !== undefined) header.push(number(block.baseFeePerGas));
if (block.withdrawalsRoot !== undefined) header.push(block.withdrawalsRoot);
if (block.blobGasUsed !== undefined) header.push(number(block.blobGasUsed));
if (block.excessBlobGas !== undefined) header.push(number(block.excessBlobGas));
if (block.parentBeaconBlockRoot !== undefined) header.push(block.parentBeaconBlockRoot);
if (block.requestsHash !== undefined) header.push(block.requestsHash);
const committerHash = keccak256(encodeRlp(header));
const recovered = seals.map(s => recoverAddress(committerHash, s).toLowerCase());
const members = new Set(validators.map(a => a.toLowerCase()));
if (new Set(recovered).size < 3 || recovered.some(a => !members.has(a)) ||
    seals.some(s => (s.length - 2) / 2 !== 65)) {
  throw Error('Live QBFT seal recovery or validator quorum check failed');
}
console.log(JSON.stringify({
  scope: 'READ-ONLY LIVE QBFT BLOCK AUDIT; NO TRANSACTIONS SENT',
  chainId: await rpc('eth_chainId'), clientVersion: await rpc('web3_clientVersion'),
  blockNumber: block.number, blockHash: block.hash, peers: await rpc('net_peerCount'),
  validatorCount: validators.length, commitSealCount: seals.length,
  commitSealBytes: seals.map(s => (s.length - 2) / 2),
  committedSealSigningDigest: committerHash,
  recoveredCommitters: recovered, allCommittersAreValidators: true,
  signature: 'recoverable ECDSA / secp256k1', hash: 'Keccak-256 (not NIST SHA3-256)',
  consensus: 'QBFT; 3 of 4 needed; ML-DSA not enabled',
  transport: {
    observationType: 'Protocol specification + Besu source/configuration, NOT packet capture',
    nodeIdentity: 'secp256k1 static public key / enode',
    handshake: 'ECIES: secp256k1 ECDH, NIST concat KDF, AES-128-CTR, HMAC-SHA256; ECDSA auth',
    framing: 'AES-256-CTR, Keccak-based frame MAC with AES',
    discovery: 'disabled by start-replit.mjs; static peers on loopback',
    quantumSafeKeyExchange: false,
  },
}, null, 2));
