// Deploy the minimal local AMM (Amm.sol) to the 912701 harness chain and
// write amm-manifest.json (+ amm-deployment.json) for the UI E2E.
// Deployer: the genesis-funded ECDSA e2e account. Signs with the
// wallet's own core (src/core/tx.mjs) — setup only; the swap itself is
// driven through the real UI by ui-multichain-browser.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import solc from '/tmp/ammbuild/node_modules/solc/index.js';
import { signTransaction } from '../../src/core/tx.mjs';
import { createRpcClient } from '../../src/core/rpc.mjs';
import { addressFromPublicKey } from '../../src/core/crypto.mjs';
import { secp256k1 } from '../../node_modules/@noble/curves/secp256k1.js';

const RPC = 'http://127.0.0.1:18545';
const CHAIN_ID = 912701n;
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const keyText = readFileSync(process.env.HOME + '/workspace/besu-2611-recon/e2e/ecdsa-account.txt', 'utf8').trim();
const secret = Uint8Array.from(Buffer.from(keyText.replace(/^0x/, ''), 'hex'));
const deployer = addressFromPublicKey('ecdsa', secp256k1.getPublicKey(secret, false));
const rpc = createRpcClient(RPC);
let nonce = Number(await rpc.getTransactionCount(deployer));

async function send({ to = null, value = 0n, data = '0x', gasLimit = 3000000n }) {
  const gasPrice = await rpc.gasPrice().catch(() => 1000000000n);
  const signed = signTransaction({
    scheme: 'ecdsa',
    secret,
    nonce,
    gasPrice: gasPrice === 0n ? 1000000000n : gasPrice,
    gasLimit,
    to,
    value,
    data,
    chainId: CHAIN_ID,
  });
  nonce += 1;
  const hash = await rpc.sendRawTransaction(signed.rawTx);
  for (let i = 0; i < 30; i++) {
    const receipt = await rpc.getTransactionReceipt(hash);
    if (receipt) {
      if (receipt.status !== '0x1') throw Error(`tx ${hash} failed`);
      return receipt;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error(`tx ${hash} not mined`);
}

const source = readFileSync(here('./Amm.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'Amm.sol': { content: source } },
  settings: {
    // The harness genesis predates Shanghai/Cancun — target Berlin EVM.
    evmVersion: 'berlin',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors?.some((e) => e.severity === 'error')) {
  throw Error('solc: ' + output.errors.filter((e) => e.severity === 'error').map((e) => e.formattedMessage).join('\n'));
}
const art = (name) => output.contracts['Amm.sol'][name];
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => String(a).replace(/^0x/, '').padStart(64, '0');
const stringTail = (s) => {
  const bytes = Buffer.from(s, 'utf8');
  const padded = Buffer.alloc(Math.ceil(bytes.length / 32) * 32);
  bytes.copy(padded);
  return word(bytes.length) + padded.toString('hex');
};
const deploy = async (name, argsHex = '') => {
  const a = art(name);
  const receipt = await send({ data: '0x' + a.evm.bytecode.object + argsHex });
  return receipt.contractAddress;
};
const call = (to, data) => rpc.ethCall({ to, data });
const transferData = (to, amount) => '0xa9059cbb' + addrWord(to) + word(amount);
const E18 = 10n ** 18n;

const wznyt = await deploy('WZNYT');
// Token(string name, string symbol): two dynamic args.
const nameEnc = stringTail('Local USD Token');
const symEnc = stringTail('zUSDT');
const tokenArgs =
  word(64) + word(64 + nameEnc.length / 2) + nameEnc + symEnc;
const zusdt = await deploy('Token', tokenArgs);
const pair = await deploy('Pair', addrWord(wznyt) + addrWord(zusdt));
const router = await deploy('Router', addrWord(wznyt) + addrWord(zusdt) + addrWord(pair));
// pair.setRouter(router) — selector computed inline:
// setRouter(address) = 0x4f8f7f25? compute properly below via eth_call-free path:
const { keccak_256 } = await import('../../node_modules/@noble/hashes/sha3.js');
const setRouterSel = '0x' + Buffer.from(keccak_256(new TextEncoder().encode('setRouter(address)')).slice(0, 4)).toString('hex');
await send({ to: pair, data: setRouterSel + router.replace(/^0x/, '').padStart(64, '0'), gasLimit: 200000n });
// seed: wrap 10,000 ZNYT and move WZNYT into the pair
await send({ to: wznyt, value: 10000n * E18, data: '0xd0e30db0', gasLimit: 200000n }); // deposit()
await send({ to: wznyt, data: transferData(pair, 10000n * E18), gasLimit: 200000n });
// mint 1,000,000 zUSDT to deployer, move 20,000 into the pair
const mintSel = '0x' + Buffer.from(keccak_256(new TextEncoder().encode('mint(address,uint256)')).slice(0, 4)).toString('hex');
await send({ to: zusdt, data: mintSel + deployer.replace(/^0x/, '').padStart(64, '0') + word(1000000n * E18), gasLimit: 300000n });
await send({ to: zusdt, data: transferData(pair, 20000n * E18), gasLimit: 200000n });

const reserves = await call(pair, '0x0902f1ac');
const deployment = {
  chain: 'local-912701-harness',
  deployer,
  wznyt,
  zusdt,
  pair,
  router,
  reservesRaw: reserves,
};
const manifest = {
  wznyt,
  tokens: { zUSDT: { symbol: 'zUSDT', decimals: 18, address: zusdt } },
  pools: [
    {
      id: 'zny-zusdt-local',
      kind: 'native',
      a: 'ZNYT',
      b: 'zUSDT',
      pair,
      token0: wznyt,
      router,
    },
  ],
};
writeFileSync(here('./amm-deployment.json'), JSON.stringify(deployment, null, 1));
writeFileSync(here('./amm-manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(deployment, null, 1));
