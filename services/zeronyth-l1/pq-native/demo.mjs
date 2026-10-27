import { GENESIS_KIND, generateIdentity, signTransaction } from './pq.mjs';
import { ValidatorReplica, oneRoundCommit } from './consensus.mjs';

const validators = Array.from({ length: 4 }, () => generateIdentity());
const faucet = generateIdentity();
const recipient = generateIdentity();
const genesis = {
  kind: GENESIS_KIND,
  chainId: '19127', // isolated lab chain ID; NOT a public testnet assignment
  validators: validators.map(({ publicKey }) => ({ publicKey })),
  allocations: [{ address: faucet.address, balance: '1000' }],
};
const replicas = validators.map(({ privateKey }) => new ValidatorReplica(genesis, privateKey));
const tx = signTransaction({ chainId: genesis.chainId, nonce: '0',
  to: recipient.address, value: '40', memo: 'demo only' }, faucet.privateKey);
const result = oneRoundCommit(replicas, [tx], { participating: [0, 1, 2] });
for (const replica of replicas) {
  if (replica.ledger.height !== 1n || replica.ledger.balance(faucet.address) !== 960n ||
      replica.ledger.balance(recipient.address) !== 40n || replica.ledger.headHash !== result.hash) {
    throw new Error('Replica verification failed');
  }
}
console.log(JSON.stringify({
  status: 'EXPERIMENTAL PQ SIGNATURE QUORUM LAB',
  algorithm: 'ML-DSA-65',
  chainId: genesis.chainId,
  replicas: replicas.length,
  approvals: result.votes.length,
  height: '1',
  blockHash: result.hash,
  faucetBalance: '960',
  recipientBalance: '40',
  warning: 'Not Besu, not EVM, not networked QBFT or production consensus.',
}, null, 2));
