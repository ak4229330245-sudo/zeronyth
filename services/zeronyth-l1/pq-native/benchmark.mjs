/** Honest, non-production local CPU benchmark. NO claim of real 5,000 TPS. */
import { performance } from 'node:perf_hooks';
import { GENESIS_KIND, generateIdentity, signTransaction } from './pq.mjs';
import { MAX_BLOCK_TRANSACTIONS } from './ledger.mjs';
import { ValidatorReplica, oneRoundCommit } from './consensus.mjs';

function parseArg(name, defaultValue) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return defaultValue;
  const text = process.argv[index+1];
  if (!/^[1-9][0-9]{0,4}$/.test(String(text))) throw Error(`Invalid --${name}`);
  return Number(text);
}

const perBlock = parseArg('transactions', 32);
const blocks = parseArg('blocks', 10);
if (perBlock > MAX_BLOCK_TRANSACTIONS || blocks > 100) {
  throw Error(`Max ${MAX_BLOCK_TRANSACTIONS} transactions/block and 100 blocks`);
}
if (perBlock * blocks > 12_000) {
  throw Error('Research benchmark limited to 12,000 transactions to avoid unbounded RAM/disk usage');
}

const validatorKeys = Array.from({ length:4 }, () => generateIdentity());
const faucet = generateIdentity();
const recipient = generateIdentity();
const genesis = {
  kind:GENESIS_KIND, chainId:'19127',
  validators:validatorKeys.map(({ publicKey }) => ({ publicKey })),
  allocations:[{ address:faucet.address, balance:'100000000' }],
};
const replicas = validatorKeys.map(({ privateKey }) => new ValidatorReplica(genesis, privateKey));

let nonce = 0;
let signingMs = 0;
const durations = [];
for (let blockIndex = 0; blockIndex < blocks; blockIndex++) {
  const signedAt = performance.now();
  const txs = Array.from({ length:perBlock }, () => signTransaction({
    chainId:genesis.chainId, nonce:String(nonce++), to:recipient.address,
    value:'1', memo:'load test',
  }, faucet.privateKey));
  signingMs += performance.now()-signedAt;
  const committedAt = performance.now();
  oneRoundCommit(replicas, txs, { participating:[0,1,2] });
  durations.push(performance.now()-committedAt);
}

const totalTransactions = perBlock * blocks;
const consensusMs = durations.reduce((sum,value) => sum + value, 0);
const sorted = [...durations].sort((a,b) => a-b);
const report = {
  label:'LOCAL FOUR-IN-MEMORY-REPLICA LAB BENCHMARK ONLY',
  node:process.version,
  algorithm:'ML-DSA-65',
  transactionsPerBlock:perBlock, blocks, totalTransactions,
  clientSigningMs:+signingMs.toFixed(2),
  validationAndQuorumMs:+consensusMs.toFixed(2),
  medianBlockMs:+sorted[Math.floor(sorted.length/2)].toFixed(2),
  p95BlockMs:+sorted[Math.max(0, Math.ceil(sorted.length*0.95)-1)].toFixed(2),
  isolatedCpuThroughputTps:+((totalTransactions*1000)/consensusMs).toFixed(1),
  actualDistributedTps:null,
  sustained5000TpsVerified:false,
  warning:'No P2P, network latency, 300ms slot scheduling, EVM, disk persistence or independent operators. NOT 5,000 TPS proof.',
};
console.log(JSON.stringify(report,null,2));
