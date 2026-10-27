// Decentralisation steps for the live testnet bridge (idempotent; every tx recorded in deployments/<network>.json).
//   node script/decentralize.mjs --step=board                       deploy BridgeAttestationBoard on 9127
//   node script/decentralize.mjs --step=fund   --relayers=0x..,0x..  gas for relayer keys (9127 ZNYT + remote ETH)
//   node script/decentralize.mjs --step=rotate --set=<json file>     setRelayers(sorted, threshold) on vault + live minters
//   node script/decentralize.mjs --step=timelock                     24h timelock owns vault + every live minter
// Uses the admin key (sole proposer afterwards). Never prints keys.
import { NonceManager, ContractFactory, parseEther, formatEther, getAddress } from 'ethers';
import { readFileSync } from 'node:fs';
import { HOME } from '../lib/chains.mjs';
import { adminWallet, publicSummary } from '../lib/keys.mjs';
import { artifact, provider as mkProvider, vaultContract, minterContract, loadDeployment, saveDeployment } from '../lib/bridge.mjs';
import { handover, timelockAddress, MIN_DELAY } from '../lib/timelock.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const d = loadDeployment(); d.txs ||= {};
const save = () => saveDeployment(d);
const homeId = Number(await mkProvider(HOME.rpc).send('eth_chainId', []));
const home = mkProvider(HOME.rpc, homeId);
const admin = adminWallet(home);
const G = { gasPrice: 1_000_000_000n };
const live = Object.values(d.remotes).filter((r) => r.status === 'live' || (args['include-standins'] && r.status === 'stand-in'));
async function rec(label, fn) {
  if (d.txs[label]) { log('skip', label, d.txs[label]); return home.getTransactionReceipt(d.txs[label]).catch(() => null); }
  const tx = await fn(); const r = await tx.wait();
  if (r.status !== 1) throw new Error(`${label} failed`);
  d.txs[label] = r.hash; save(); log(label, r.hash); return r;
}

if (args.step === 'board') {
  if (!d.home.board) {
    const a = artifact('BridgeAttestationBoard');
    const c = await new ContractFactory(a.abi, a.bytecode, admin).deploy(G);
    const r = await c.deploymentTransaction().wait();
    d.home.board = await c.getAddress(); d.home.boardDeployBlock = r.blockNumber; d.txs.BridgeAttestationBoard = r.hash; save();
    log('BridgeAttestationBoard', d.home.board, r.hash);
  } else log('board exists', d.home.board);
}

if (args.step === 'fund') {
  const list = String(args.relayers || '').split(',').filter(Boolean).map(getAddress);
  const znyt = parseEther(String(args.znyt || '2')); const eth = parseEther(String(args.eth || '0.002'));
  for (const a of list) {
    const b = await home.getBalance(a);
    if (b < znyt / 2n) await rec(`fundZnyt-${a}`, () => admin.sendTransaction({ to: a, value: znyt - b, ...G }));
  }
  for (const r of live) {
    const p = mkProvider(r.rpc, r.chainId); const w = new NonceManager(adminWallet(p));
    for (const a of list) {
      const b = await p.getBalance(a);
      if (b < eth / 2n) await rec(`fundGas-${r.chainId}-${a}`, () => w.sendTransaction({ to: a, value: eth - b }));
    }
    log(r.id, 'admin balance', formatEther(await p.getBalance(await w.getAddress())));
  }
}

if (args.step === 'rotate') {
  const set = JSON.parse(readFileSync(String(args.set), 'utf8')); // { threshold, operators: [{address,label,machine,operator}] }
  const addrs = set.operators.map((o) => getAddress(o.address)).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const th = Number(set.threshold);
  const perOp = {}; for (const o of set.operators) perOp[o.machine] = (perOp[o.machine] || 0) + 1;
  if (Math.max(...Object.values(perOp)) >= th) throw new Error('a single machine would reach the threshold');
  d.genesisRelayers ||= publicSummary().relayers.map((r) => r.address); d.genesisThreshold ||= 2; // CREATE2 ctor args (unchanged)
  const targets = [['vault', vaultContract(d.home.vault, admin), home], ...live.map((r) => { const p = mkProvider(r.rpc, r.chainId); return [`minter-${r.chainId}`, minterContract(r.minter, adminWallet(p)), p]; })];
  for (const [name, c, p] of targets) {
    const cur = [...await c.relayers()].map(getAddress); const ct = Number(await c.threshold());
    if (ct === th && cur.length === addrs.length && cur.every((a, i) => a === addrs[i])) { log(name, 'already', `${th}-of-${addrs.length}`); continue; }
    await rec(`setRelayers-${name}-${th}of${addrs.length}`, () => c.setRelayers(addrs, th, p === home ? G : {}));
  }
  d.relayers = addrs.map((a) => set.operators.find((o) => getAddress(o.address) === a));
  d.operators = d.relayers; d.threshold = th; d.relayerRotatedAt = new Date().toISOString(); save();
}

if (args.step === 'timelock') {
  d.timelocks ||= {};
  const targets = [[homeId, vaultContract(d.home.vault, admin), home, G], ...live.map((r) => { const p = mkProvider(r.rpc, r.chainId); return [r.chainId, minterContract(r.minter, adminWallet(p)), p, {}]; })];
  for (const [cid, c, p, opts] of targets) {
    const res = await handover({ provider: p, admin: adminWallet(p), contract: c, guardian: d.guardian, opts, known: d.timelocks[cid]?.address || null,
      send: async (label, fn) => {
        const r = await rec(`timelock-${cid}-${label}`, fn);
        if (label === 'deploy' && r) d.timelocks[cid] = { ...(d.timelocks[cid] || {}), deployBlock: r.blockNumber, ...(r.contractAddress ? { address: r.contractAddress } : {}) };
        save(); return r;
      } });
    d.timelocks[cid] = { ...(d.timelocks[cid] || {}), address: res.address, minDelaySeconds: res.minDelay, owns: await c.getAddress() }; save();
    log('timelock', cid, res.address, 'delay', res.minDelay);
  }
  d.timelockAddress = timelockAddress(admin.address); d.timelockMinDelay = MIN_DELAY; save();
}
