// Deploy / configure the ZERONYTH testnet bridge. Idempotent: every step is recorded in deployments/<network>.json.
//   BRIDGE_NETWORK=main  node script/deploy.mjs [--targets=real|standin|real,standin] [--enable-standins|--disable-standins]
//   BRIDGE_NETWORK=local BRIDGE_HOME_RPC=http://127.0.0.1:18450 node script/deploy.mjs --targets=standin   (all-local test)
// main: the vault owner/submitter is the bridge admin key; it gets its ZNYT gas in ONE tx from the economy "deployer"
// role (nonce-safe QueuedSigner). Remote chains: BridgeMinter via the CREATE2 proxy => the same address on every chain.
// A remote chain whose admin address has no gas is recorded as "waiting-for-gas" with its predicted addresses, and is
// registered in the vault DISABLED (no locks possible) until it is deployed.
import { Wallet, parseEther, formatEther, concat } from 'ethers';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HOME, REMOTES, STAND_INS, CAPS, PLANNED } from '../lib/chains.mjs';
import { loadKeys, publicSummary, bridgeRoot } from '../lib/keys.mjs';
import { artifact, provider as mkProvider, vaultContract, minterContract, minterInitCode, create2Address, tokenAddressOf,
  CREATE2_FACTORY, MINTER_SALT, NETWORK, loadDeployment, saveDeployment } from '../lib/bridge.mjs';
import { ContractFactory, getAddress, keccak256, toUtf8Bytes, ZeroHash } from 'ethers';
import { handover, MIN_DELAY } from '../lib/timelock.mjs';
import { timelockContract } from '../lib/board.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const targets = String(args.targets || 'real').split(',');
const log = (...a) => console.log(new Date().toISOString(), ...a);
const keys = loadKeys(); const pub = publicSummary();
const home = mkProvider(HOME.rpc, NETWORK === 'local' ? Number(process.env.BRIDGE_HOME_CHAIN_ID || 9127) : 9127);
const admin = new Wallet(keys.admin, home);
const d = loadDeployment();
d.network = NETWORK; d.home ||= {}; d.remotes ||= {}; d.txs ||= {};
d.admin = pub.admin; d.guardian = pub.guardian;
// after script/decentralize.mjs --step=rotate the live relayer set lives in d.relayers/d.threshold; the CREATE2 ctor args
// (and so the minter address) keep using the ORIGINAL 2-of-3 set, a new minter is rotated right after deploy.
if (!d.relayerRotatedAt) { d.relayers = pub.relayers; d.threshold = 2; }
d.caps = { minZnyt: formatEther(CAPS.min), maxPerTxZnyt: formatEther(CAPS.max), dailyPerChainZnyt: formatEther(CAPS.daily) };
d.planned = PLANNED;
const save = () => saveDeployment(d);
const relayerAddrs = pub.relayers.map((r) => r.address);
async function gasPrice(p) { const f = await p.getFeeData(); return f.gasPrice ?? 1_000_000_000n; }
async function sendWait(w, tx, label) {
  const r = await (await w.sendTransaction(tx)).wait();
  if (r.status !== 1) throw new Error(`${label} failed`);
  d.txs[label] = r.hash; save(); log(label, r.hash); return r;
}

// ---- home chain
const cid = Number(await home.send('eth_chainId', []));
if (NETWORK === 'main' && cid !== 9127) throw new Error('home RPC is not chain 9127');
d.home.chainId = cid; d.home.rpc = NETWORK === 'main' ? HOME.publicRpc : HOME.rpc;

if (!d.home.vault) {
  const bal = await home.getBalance(admin.address);
  if (bal < parseEther('5')) {
    if (NETWORK === 'main') {
      // one funding tx from the economy deployer role (same process lock/nonce queue as the other economy scripts)
      const econKeys = path.resolve(bridgeRoot, '../economy/.secrets/main-keys.json');
      if (!existsSync(econKeys) || !JSON.parse(readFileSync(econKeys, 'utf8')).deployer) throw new Error('economy deployer key missing');
      const { QueuedSigner } = await import('../lib/signer-queue.mjs');
      const dep = new QueuedSigner(new Wallet(JSON.parse(readFileSync(econKeys, 'utf8')).deployer, home), { chainId: 9127 });
      const tx = await dep.sendTransaction({ to: admin.address, value: parseEther('20') - bal, gasPrice: await gasPrice(home) });
      const r = await tx.wait(); if (r.status !== 1) throw new Error('fund admin failed');
      d.txs.fundAdmin = r.hash; d.fundedBy = await dep.getAddress(); save(); log('fundAdmin', r.hash);
    } else {
      const dev = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', home); // anvil account #0 (local only)
      await sendWait(dev, { to: admin.address, value: parseEther('5000') }, 'fundAdmin');
      await sendWait(dev, { to: pub.guardian, value: parseEther('10') }, 'fundGuardian');
    }
  }
  const a = artifact('ZnytBridgeVault');
  const f = new ContractFactory(a.abi, a.bytecode, admin);
  const c = await f.deploy(admin.address, pub.guardian, relayerAddrs, 2, { gasPrice: await gasPrice(home) });
  const r = await c.deploymentTransaction().wait();
  d.home.vault = await c.getAddress(); d.home.deployBlock = r.blockNumber; d.txs.ZnytBridgeVault = r.hash; save();
  log('ZnytBridgeVault', d.home.vault, r.hash);
}
if (NETWORK === 'main' && !d.txs.fundGuardian) {
  // the guardian (auto-pause on invariant violation) needs a little ZNYT gas
  const gb = await home.getBalance(pub.guardian);
  if (gb < parseEther('1')) await sendWait(admin, { to: pub.guardian, value: parseEther('2'), gasPrice: await gasPrice(home) }, 'fundGuardian');
}
const vault = vaultContract(d.home.vault, admin);

// ---- remote chains (same init code everywhere => same minter + token address)
const init = minterInitCode({ owner: admin.address, guardian: pub.guardian, relayers: relayerAddrs, threshold: 2,
  srcChainId: cid, srcVault: d.home.vault, caps: CAPS });
const minterAddr = create2Address(init); const tokenAddr = tokenAddressOf(minterAddr);
d.minterAddress = minterAddr; d.tokenAddress = tokenAddr; d.create2 = { factory: CREATE2_FACTORY, salt: MINTER_SALT };
save();

const list = [...(targets.includes('real') ? REMOTES : []), ...(targets.includes('standin') ? STAND_INS : [])];
for (const ch of list) {
  const rec = d.remotes[ch.chainId] ||= {};
  Object.assign(rec, { id: ch.id, name: ch.name, chainId: ch.chainId, rpc: ch.rpc, explorer: ch.explorer, standIn: ch.standIn,
    standInFor: ch.standInFor || null, finality: ch.finality, minter: minterAddr, token: tokenAddr, gasSymbol: ch.gasSymbol, faucets: ch.faucets });
  const p = mkProvider(ch.rpc, ch.chainId);
  let code;
  try { code = await p.getCode(minterAddr); } catch (e) { rec.status = 'rpc-error'; rec.error = String(e.shortMessage || e.message).slice(0, 120); save(); log(ch.id, 'rpc error'); continue; }
  if (code === '0x') {
    const w = new Wallet(keys.admin, p);
    let bal = await p.getBalance(w.address);
    if (bal === 0n && ch.standIn) { // local Anvil only: fund from the well-known anvil dev account #0
      const dev = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', p);
      await (await dev.sendTransaction({ to: w.address, value: parseEther('100') })).wait(); bal = await p.getBalance(w.address);
    }
    if (bal === 0n) { rec.status = 'waiting-for-gas'; rec.gasNeeded = 'about 0.005 ' + ch.gasSymbol + ' for deploy + ~0.0003 per mint'; save(); log(ch.id, 'waiting for gas at', w.address); continue; }
    if ((await p.getCode(CREATE2_FACTORY)) === '0x') { rec.status = 'no-create2-factory'; save(); log(ch.id, 'no CREATE2 factory'); continue; }
    const r = await (await w.sendTransaction({ to: CREATE2_FACTORY, data: concat([MINTER_SALT, init]) })).wait();
    if (r.status !== 1 || (await p.getCode(minterAddr)) === '0x') throw new Error(`${ch.id} minter deploy failed`);
    rec.deployTx = r.hash; rec.deployBlock = r.blockNumber; log(ch.id, 'BridgeMinter', minterAddr, r.hash);
  } else if (!rec.deployBlock) rec.deployBlock = Number(await p.getBlockNumber()) - 1;
  const m = minterContract(minterAddr, p);
  if ((await m.srcVault()) !== d.home.vault || Number(await m.srcChainId()) !== cid) throw new Error(`${ch.id} minter config mismatch`);
  rec.status = ch.standIn ? 'stand-in' : 'live';
  delete rec.gasNeeded; save();
  if (d.relayerRotatedAt && !ch.standIn) { // bring a newly deployed minter to the current relayer set, then hand it to the timelock
    const w = new Wallet(keys.admin, p); const mm = minterContract(minterAddr, w);
    const want = d.relayers.map((r) => getAddress(r.address)); const cur = [...await mm.relayers()].map(getAddress);
    if (Number(await mm.threshold()) !== d.threshold || cur.join() !== want.join()) {
      const r = await (await mm.setRelayers(want, d.threshold)).wait(); d.txs[`setRelayers-minter-${ch.chainId}-${d.threshold}of${want.length}`] = r.hash; save();
      log(ch.id, 'setRelayers', `${d.threshold}-of-${want.length}`, r.hash);
    }
    if (d.timelocks) {
      d.timelocks[ch.chainId] ||= {};
      const res = await handover({ provider: p, admin: w, contract: mm, guardian: pub.guardian,
        send: async (label, fn) => { const r = await (await fn()).wait(); d.txs[`timelock-${ch.chainId}-${label}`] = r.hash; save(); log(ch.id, 'timelock', label, r.hash); return r; } });
      Object.assign(d.timelocks[ch.chainId], { address: res.address, minDelaySeconds: res.minDelay, owns: minterAddr }); save();
    }
  }
}

// ---- register chains in the vault (disabled unless the minter is deployed; stand-ins only when asked)
const enableStandins = !!args['enable-standins'];
for (const rec of Object.values(d.remotes)) {
  const deployed = rec.status === 'live' || rec.status === 'stand-in';
  const want = rec.standIn ? deployed && enableStandins : deployed;
  const cur = await vault.chains(rec.chainId);
  if (cur.minter !== '0x0000000000000000000000000000000000000000' && cur.enabled === want) { rec.vaultEnabled = want; continue; }
  if (args['skip-unchanged-standins'] && rec.standIn && cur.minter === '0x0000000000000000000000000000000000000000' && !want) continue;
  if ((await vault.owner()).toLowerCase() !== admin.address.toLowerCase()) {
    // vault is owned by the 24h timelock: schedule (admin = proposer); anyone can execute after the delay via script/timelock.mjs
    const tl = timelockContract(await vault.owner(), admin);
    const data = vault.interface.encodeFunctionData('setChain', [rec.chainId, want, rec.minter, CAPS.min, CAPS.max, CAPS.daily]);
    const salt = keccak256(toUtf8Bytes(`setChain-${rec.chainId}-${want}-${d.home.vault}`));
    const id = await tl.hashOperation(d.home.vault, 0, data, ZeroHash, salt);
    d.timelockOps ||= {};
    if (!(await tl.isOperation(id))) {
      const r = await (await tl.schedule(d.home.vault, 0, data, ZeroHash, salt, MIN_DELAY, { gasPrice: await gasPrice(home) })).wait();
      d.txs[`schedule-setChain-${rec.chainId}-${want ? 'on' : 'off'}`] = r.hash; log('timelock scheduled vault.setChain', rec.chainId, want ? 'ENABLE' : 'disable', r.hash);
    }
    d.timelockOps[id] = { label: `vault.setChain ${rec.chainId} ${want ? 'enable' : 'disable'}`, target: d.home.vault, data, salt,
      readyAt: new Date(Number(await tl.getTimestamp(id)) * 1000).toISOString(), done: await tl.isOperationDone(id) };
    save(); continue;
  }
  const r = await (await vault.setChain(rec.chainId, want, rec.minter, CAPS.min, CAPS.max, CAPS.daily, { gasPrice: await gasPrice(home) })).wait();
  rec.vaultEnabled = want; d.txs[`setChain-${rec.chainId}-${want ? 'on' : 'off'}`] = r.hash; save();
  log('vault.setChain', rec.chainId, rec.id, want ? 'ENABLED' : 'disabled', r.hash);
}
save();
log('done', JSON.stringify({ vault: d.home.vault, minter: minterAddr, token: tokenAddr,
  remotes: Object.values(d.remotes).map((r) => `${r.id}:${r.status}${r.vaultEnabled ? '+on' : ''}`) }));
