// Move admin test-ETH from Ethereum Sepolia to Base Sepolia / Arbitrum Sepolia via the OFFICIAL canonical bridges.
// Addresses verified 2026-10-27 against docs.base.org (Base contracts, "Ethereum Testnet (Sepolia)" L1StandardBridge)
// and docs.arbitrum.io (contract addresses, Arbitrum Sepolia "Delayed Inbox").
//   node script/l1-deposit.mjs --to=base|arbitrum --eth=0.012
import { Interface, parseEther, formatEther } from 'ethers';
import { REMOTES } from '../lib/chains.mjs';
import { adminWallet } from '../lib/keys.mjs';
import { provider, loadDeployment, writeJson, depFile } from '../lib/bridge.mjs';
const OFFICIAL = {
  base: { to: '0xfd0Bf71F60660E2f608ed56e1659C450eB113120', iface: new Interface(['function depositETH(uint32 _minGasLimit, bytes _extraData) payable']), data: (i) => i.encodeFunctionData('depositETH', [200000, '0x']) },
  arbitrum: { to: '0xaAe29B0366299461418F5324a79Afc425BE5ae21', iface: new Interface(['function depositEth() payable returns (uint256)']), data: (i) => i.encodeFunctionData('depositEth', []) },
};
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const o = OFFICIAL[args.to]; if (!o) throw new Error('--to=base|arbitrum');
const value = parseEther(args.eth || '0.012');
const sep = REMOTES.find((r) => r.chainId === 11155111);
const p = provider(sep.rpc, sep.chainId); const w = adminWallet(p);
if ((await p.getCode(o.to)) === '0x') throw new Error('bridge contract has no code on Sepolia');
const d = loadDeployment(); d.txs ||= {}; const key = `l1deposit-${args.to}`;
if (d.txs[key]) { console.log('already sent', key, d.txs[key]); process.exit(0); }
const tx = await w.sendTransaction({ to: o.to, value, data: o.data(o.iface) });
d.txs[key] = tx.hash; writeJson(depFile(), d);
const r = await tx.wait(); console.log(args.to, 'deposit', formatEther(value), 'ETH', r.hash, 'status', r.status, 'left on Sepolia', formatEther(await p.getBalance(w.address)));
