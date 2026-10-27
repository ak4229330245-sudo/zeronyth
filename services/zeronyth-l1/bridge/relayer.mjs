// ZERONYTH testnet bridge relayer (v2: no single coordinator). One process may hold one or more relayer keys.
// Every relayer process independently:
//   1. watches FINALIZED source events (Locked on the 9127 vault, Burned on each BridgeMinter) from its OWN RPCs,
//   2. signs each transfer digest twice and POSTS both signatures to BridgeAttestationBoard on 9127 with its own gas:
//        - ECDSA (secp256k1, EIP-191) -> verified ON-CHAIN by the vault/minter (M-of-N, read from the contract)
//        - ML-DSA-65 (FIPS 204)       -> NOT verified on-chain; public in the Attested event, verifiable by anyone
//   3. reads everybody's signatures back from the board, keeps those whose signer is in the destination contract's
//      current relayer set, and once `threshold` are there SUBMITS the mint/release itself with its own wallet.
//      Submit order is a deterministic rotation per transfer (rank * BRIDGE_SUBMIT_STAGGER_MS), so normally exactly one
//      relayer sends and the others only step in if it is down. `processed` + a static call are checked before sending.
// Box relayer with BRIDGE_API=1 additionally keeps the public transfer DB / points events, runs the supply invariant
// monitor (guardian auto-pause) and serves the read-only HTTP API on 127.0.0.1 (proxied by the gateway).
// Keys: box = RELAYER_INDEX from bridge/.secrets/bridge-keys.json; other machines = BRIDGE_OPERATOR_KEYS (0600 file
// generated on that machine by script/operator-keygen.mjs). No admin key is used by this process.
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Wallet, getBytes, formatEther, getAddress, dataSlice } from 'ethers';
import { HOME, LOG_RANGE } from './lib/chains.mjs';
import { provider as mkProvider, vaultContract, minterContract, tokenContract, digest, pqSign, toB32, loadDeployment,
  readJson, writeJson, appendJsonl, sleep, transferId, STATE_DIR, NETWORK } from './lib/bridge.mjs';
import { boardContract, timelockContract, attestationsFor, operatorsFrom, pickSigs, verifyMldsa, submitRank } from './lib/board.mjs';

const OP_KEYS = process.env.BRIDGE_OPERATOR_KEYS || '';
const IDX = Number(process.env.RELAYER_INDEX ?? 0);
const API = process.env.BRIDGE_API === '1' || process.env.BRIDGE_SUBMITTER === '1';
const NAME = process.env.RELAYER_NAME || (OP_KEYS ? 'op' : `r${IDX}`);
const LABEL = process.env.BRIDGE_OPERATOR_LABEL || `ZeroLayer ${NAME}`;
const MACHINE = process.env.BRIDGE_MACHINE || 'box';
const API_PORT = Number(process.env.BRIDGE_API_PORT || 9811);
const POLL_MS = Number(process.env.BRIDGE_POLL_MS || 4000);
const STAGGER_MS = Number(process.env.BRIDGE_SUBMIT_STAGGER_MS || 45_000);
const CHUNK = 1000;
const keysMod = await import('./lib/keys.mjs');
const me = OP_KEYS ? keysMod.loadOperatorKeys(OP_KEYS) : [keysMod.relayer(IDX)];
const myAddrs = me.map((k) => k.wallet.address);
const log = (...a) => console.log(new Date().toISOString(), `[${NAME}]`, ...a);
const cursorFile = path.join(STATE_DIR, OP_KEYS ? `relayer-${NAME}.json` : `relayer-${IDX}.json`);
const pqLog = path.join(STATE_DIR, `pq-log-${NAME}.jsonl`);
const transfersFile = path.join(STATE_DIR, API ? 'transfers.json' : `transfers-${NAME}.json`);
const eventsFile = path.join(STATE_DIR, 'events.jsonl');
const statusFile = path.join(STATE_DIR, 'status.json');

let dep = {}; const chains = new Map(); // chainId -> { rec, provider, contract }
const cursors = readJson(cursorFile, { relayer: NAME, addresses: myAddrs, cursors: {} });
const transfers = readJson(transfersFile, {});
let eventSeq = API && existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).length : 0;
const health = { started: new Date().toISOString(), lastLoop: null, errors: {}, invariant: null };
const sets = new Map(); // dst chainId -> { list, set, threshold, owner, at }
const verified = new Set(); // remote chain ids whose minter matches vault.chains(id).minter on 9127

function homeChainId() { return dep.home?.chainId || 9127; }
const home = () => chains.get(homeChainId());
const board = () => (dep.home?.board ? boardContract(dep.home.board, home().provider) : null);
function refreshConfig() {
  dep = loadDeployment();
  if (!dep.home?.vault) return false;
  const hid = homeChainId();
  if (!chains.has(hid)) {
    const p = mkProvider(HOME.rpc, hid);
    chains.set(hid, { home: true, rec: { id: HOME.id, name: HOME.name, chainId: hid, finality: HOME.confirmations, deployBlock: dep.home.deployBlock }, provider: p, contract: vaultContract(dep.home.vault, p) });
  }
  for (const rec of Object.values(dep.remotes || {})) {
    if (rec.status !== 'live' && rec.status !== 'stand-in') continue;
    const cur = chains.get(rec.chainId);
    if (cur) { cur.rec = rec; continue; }
    const p = mkProvider(rec.rpc, rec.chainId);
    chains.set(rec.chainId, { rec, provider: p, contract: minterContract(rec.minter, p), token: tokenContract(rec.token, p) });
  }
  return true;
}
/** never trust the local deployments file alone: the remote minter must be the one registered in the vault on 9127 */
async function verifyRemotes() {
  for (const [cid, c] of chains) {
    if (c.home || verified.has(cid)) continue;
    const cfg = await home().contract.chains(cid);
    if (cfg.minter.toLowerCase() === c.rec.minter.toLowerCase()) verified.add(cid);
    else health.errors[cid] = `minter ${c.rec.minter} is not the vault's minter for ${cid}; ignoring this chain`;
  }
}
async function relayerSet(chainId) {
  const s = sets.get(chainId);
  if (s && Date.now() - s.at < 60_000) return s;
  const c = chains.get(chainId);
  const [list, th, owner] = await Promise.all([c.contract.relayers(), c.contract.threshold(), c.contract.owner()]);
  const v = { list: [...list].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)), set: new Set(list), threshold: Number(th), owner, at: Date.now() };
  sets.set(chainId, v); return v;
}
async function finalizedHead(c) {
  if (c.rec.finality === 'finalized') return Number((await c.provider.getBlock('finalized')).number);
  return Number(await c.provider.getBlockNumber()) - Number(c.rec.finality || 2);
}
const dstContractOf = (tr) => (tr.kind === 'lock' ? dep.remotes[tr.dstChainId].minter : dep.home.vault);
function trDigest(tr) {
  return digest({ srcChainId: tr.srcChainId, srcContract: tr.kind === 'lock' ? dep.home.vault : dep.remotes[tr.srcChainId].minter,
    dstChainId: tr.dstChainId, dstContract: dstContractOf(tr), nonce: BigInt(tr.nonce), recipient: tr.recipient, amount: BigInt(tr.amount) });
}
async function isProcessed(tr) {
  const c = chains.get(tr.dstChainId);
  return c.home ? c.contract.processed(tr.srcChainId, tr.nonce) : c.contract.processed(tr.nonce);
}

// ------------------------------------------------------------------ source scanning (all relayers)
function eventToTransfer(c, ev) {
  const hid = homeChainId();
  if (c.home && ev.fragment.name === 'Locked') {
    const [nonce, dstChainId, sender, recipient, amount] = ev.args;
    if (!dep.remotes?.[Number(dstChainId)]) return null; // unknown destination: never signed
    return { id: transferId(hid, nonce), kind: 'lock', srcChainId: hid, dstChainId: Number(dstChainId), nonce: nonce.toString(),
      sender, recipient, amount: amount.toString(), srcTx: ev.transactionHash, srcBlock: ev.blockNumber };
  }
  if (!c.home && ev.fragment.name === 'Burned') {
    const [nonce, sender, recipient, amount] = ev.args;
    return { id: transferId(c.rec.chainId, nonce), kind: 'burn', srcChainId: c.rec.chainId, dstChainId: hid, nonce: nonce.toString(),
      sender, recipient: toB32(recipient), amount: amount.toString(), srcTx: ev.transactionHash, srcBlock: ev.blockNumber };
  }
  return null;
}
function emit(type, t, extra = {}) {
  if (!API) return; // only the public indexer writes the points event log (no duplicates)
  const addr = type === 'bridge_lock' || type === 'bridge_burn' ? t.sender : getAddress(dataSlice(t.recipient, 12));
  appendJsonl(eventsFile, { seq: ++eventSeq, type, transferId: t.id, address: addr, amountWei: t.amount, amount: formatEther(t.amount),
    srcChainId: t.srcChainId, dstChainId: t.dstChainId, network: NETWORK, standIn: !!(dep.remotes?.[t.kind === 'lock' ? t.dstChainId : t.srcChainId]?.standIn), at: new Date().toISOString(), ...extra });
}
function markDone(id, kind, txHash, by) {
  const tr = transfers[id];
  if (!tr) return;
  if (tr.status === 'minted' || tr.status === 'released') { // already settled via processed(): just backfill the tx
    if (!tr.dstTx) { tr.dstTx = txHash; if (by) tr.submittedBy = by; }
    return;
  }
  tr.status = kind === 'Minted' ? 'minted' : 'released'; tr.dstTx = txHash; tr.doneAt = new Date().toISOString(); if (by) tr.submittedBy = by;
  emit(kind === 'Minted' ? 'bridge_mint' : 'bridge_release', tr, { txHash });
}
async function scanChain(c) {
  const key = String(c.rec.chainId);
  const head = await finalizedHead(c);
  let from = (cursors.cursors[key] ?? (Number(c.rec.deployBlock || 0) - 1)) + 1;
  while (from <= head) {
    const to = Math.min(head, from + (LOG_RANGE[key] || CHUNK) - 1);
    const filters = c.home ? ['Locked', 'Released'] : ['Burned', 'Minted'];
    const evs = [];
    for (const name of filters) evs.push(...await c.contract.queryFilter(c.contract.filters[name](), from, to));
    evs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    for (const ev of evs) {
      const t = eventToTransfer(c, ev);
      if (t) {
        if (!transfers[t.id]) {
          transfers[t.id] = { ...t, status: t.kind === 'lock' ? 'locked' : 'burned', createdAt: new Date().toISOString() };
          emit(t.kind === 'lock' ? 'bridge_lock' : 'bridge_burn', transfers[t.id], { txHash: t.srcTx });
        }
      } else if (ev.fragment.name === 'Minted' || ev.fragment.name === 'Released') {
        const id = ev.fragment.name === 'Minted' ? transferId(homeChainId(), ev.args[0]) : transferId(ev.args[0], ev.args[1]);
        const tr = transfers[id];
        if (tr && (!tr.dstTx || (tr.status !== 'minted' && tr.status !== 'released'))) { // also backfills dstTx after a processed() settle
          const by = tr.submitter && tr.submitTx === ev.transactionHash ? tr.submitter : (await ev.getTransaction().catch(() => null))?.from;
          markDone(id, ev.fragment.name, ev.transactionHash, by);
        }
      }
    }
    cursors.cursors[key] = to; writeJson(cursorFile, cursors); writeJson(transfersFile, transfers);
    from = to + 1;
  }
}

// ------------------------------------------------------------------ attest -> board (all relayers, own gas on 9127)
async function attestPending() {
  const b = board(); if (!b) return;
  for (const tr of Object.values(transfers)) {
    if (['minted', 'released'].includes(tr.status) || !chains.has(tr.dstChainId) || !verified.has(tr.kind === 'lock' ? tr.dstChainId : tr.srcChainId)) continue;
    tr.attestedBy ||= {};
    if (myAddrs.every((a) => tr.attestedBy[a])) continue;
    if (await isProcessed(tr)) { tr.status = tr.kind === 'lock' ? 'minted' : 'released'; tr.doneAt ||= new Date().toISOString(); continue; }
    const d = trDigest(tr); tr.digest = d;
    for (const k of me) {
      const a = k.wallet.address;
      if (tr.attestedBy[a]) continue;
      if (await b.attested(d, a)) { tr.attestedBy[a] = 'already-on-board'; continue; }
      const sig = k.wallet.signMessageSync(getBytes(d)); // EIP-191 over the 32-byte digest
      const pq = pqSign(k, d);
      try {
        const tx = await b.connect(k.wallet.connect(home().provider)).attest(d, sig, pq, { gasPrice: 1_000_000_000n });
        const r = await tx.wait(1, 120_000);
        if (r?.status !== 1) throw new Error('attest tx failed');
        tr.attestedBy[a] = tx.hash;
        appendJsonl(pqLog, { id: tr.id, digest: d, ecdsaSigner: a, mldsaPkSha256: k.mldsaPkHash, boardTx: tx.hash, alg: 'ML-DSA-65', at: new Date().toISOString() });
        log('attested', tr.id, tr.kind, formatEther(tr.amount), 'ZNYT as', a, 'board tx', tx.hash);
      } catch (e) { health.errors.attest = `${a}: ${String(e.shortMessage || e.message).slice(0, 160)}`; log('attest error', tr.id, health.errors.attest); }
    }
    writeJson(transfersFile, transfers);
  }
}

// ------------------------------------------------------------------ submit (any relayer, own gas, staggered)
let opsCache = { at: 0, ops: {} };
async function boardOperators(b, force = false) {
  if ((force && Date.now() - opsCache.at > 60_000) || Date.now() - opsCache.at > 300_000) opsCache = { at: Date.now(), ops: await operatorsFrom(b, dep.home.boardDeployBlock || 0) };
  return opsCache.ops;
}
async function submitPending() {
  const b = board(); if (!b) return;
  for (const tr of Object.values(transfers)) {
    if (['minted', 'released'].includes(tr.status)) continue;
    const c = chains.get(tr.dstChainId);
    if (!c || !verified.has(tr.kind === 'lock' ? tr.dstChainId : tr.srcChainId)) { tr.note = 'destination not deployed / not verified yet'; continue; }
    const d = tr.digest || trDigest(tr); tr.digest = d;
    const rs = await relayerSet(tr.dstChainId);
    const atts = await attestationsFor(b, d, dep.home.boardDeployBlock || 0);
    let ops = await boardOperators(b);
    if (atts.some((a) => rs.set.has(a.signer) && !ops[a.signer])) ops = await boardOperators(b, true); // new registration
    const { valid, signers, sigs } = pickSigs(atts, rs.set, rs.threshold, ops, d); // ECDSA + full ML-DSA-65 verification
    tr.signatures = valid; tr.threshold = rs.threshold; tr.signers = signers;
    if (valid < rs.threshold) continue;
    if (tr.status === 'locked' || tr.status === 'burned') {
      tr.status = 'attested'; tr.attestedAt = new Date().toISOString(); tr.thresholdSeenAt = Date.now(); emit('bridge_attested', tr);
    }
    tr.thresholdSeenAt ||= Date.now();
    const rank = submitRank(rs.list, myAddrs, tr.srcChainId, tr.nonce);
    tr.myRank = rank;
    if (Date.now() - tr.thresholdSeenAt < rank * STAGGER_MS) continue;
    if (tr.submitTx) {
      const r = await c.provider.getTransactionReceipt(tr.submitTx).catch(() => null);
      if (!r && Date.now() - Date.parse(tr.submittedAt) < 600_000) continue; // still pending
      if (r?.status === 1) continue; // Minted/Released event will finalize the status
    }
    if (await isProcessed(tr)) { tr.status = c.home ? 'released' : 'minted'; tr.doneAt ||= new Date().toISOString(); continue; }
    for (const k of me) {
      const w = k.wallet.connect(c.provider);
      try {
        const fee = await c.provider.getFeeData();
        const opts = c.home ? { gasPrice: fee.gasPrice ?? 1_000_000_000n } : {};
        const kc = c.contract.connect(w);
        const call = c.home
          ? [tr.srcChainId, tr.nonce, getAddress(dataSlice(tr.recipient, 12)), tr.amount, sigs]
          : [tr.nonce, tr.recipient, tr.amount, sigs];
        const fn = c.home ? kc.release : kc.mint;
        await fn.staticCall(...call, opts); // reverts if someone else just submitted or sigs are bad
        const tx = await fn(...call, opts);
        tr.submitTx = tx.hash; tr.submittedAt = new Date().toISOString(); tr.submitter = w.address; delete tr.submitError;
        writeJson(transfersFile, transfers);
        log('submitted', tr.id, c.home ? 'release' : 'mint', 'rank', rank, 'from', w.address, tx.hash);
        const r = await tx.wait(1, 120_000);
        if (r?.status === 1) markDone(tr.id, c.home ? 'Released' : 'Minted', tx.hash, w.address);
        break;
      } catch (e) {
        tr.submitError = `${w.address}: ${String(e.shortMessage || e.message).slice(0, 180)}`; tr.retries = (tr.retries || 0) + 1;
        log('submit error', tr.id, tr.submitError);
      }
    }
    writeJson(transfersFile, transfers);
  }
}

// ------------------------------------------------------------------ registration on the board (once per key)
async function registerSelf() {
  const b = board(); if (!b) return;
  for (const [i, k] of me.entries()) {
    const label = me.length > 1 ? `${LABEL} k${i}` : LABEL;
    const o = await b.operators(k.wallet.address);
    if (Number(o.registeredAt) !== 0 && o.mldsaPkHash === k.mldsaPkHash && o.label === label && o.machine === MACHINE) continue;
    try {
      const tx = await b.connect(k.wallet.connect(home().provider)).registerOperator(label, MACHINE, k.mldsaPublicKeyHex, { gasPrice: 1_000_000_000n });
      await tx.wait(1, 120_000); log('registered on board', k.wallet.address, label, MACHINE, tx.hash);
    } catch (e) { health.errors.register = String(e.shortMessage || e.message).slice(0, 160); }
  }
}

// ------------------------------------------------------------------ invariant monitor (API relayer on the box)
async function checkInvariant() {
  const h = home(); if (!h) return;
  const vault = h.contract;
  const [totalLocked, vaultBal, paused] = await Promise.all([vault.totalLocked(), h.provider.getBalance(dep.home.vault), vault.paused()]);
  const per = []; let sum = 0n; let ok = vaultBal >= totalLocked;
  for (const [cid, c] of chains) {
    if (c.home) continue;
    try {
      const [supply, outstanding, mpaused] = await Promise.all([c.token.totalSupply(), vault.outstanding(cid), c.contract.paused()]);
      sum += supply; const good = supply <= outstanding; ok &&= good;
      per.push({ chainId: cid, id: c.rec.id, standIn: !!c.rec.standIn, wznytSupply: formatEther(supply), znytOutstanding: formatEther(outstanding), ok: good, minterPaused: mpaused });
    } catch (e) { per.push({ chainId: cid, id: c.rec.id, error: String(e.shortMessage || e.message).slice(0, 120) }); }
  }
  ok &&= sum <= totalLocked;
  health.invariant = { ok, checkedAt: new Date().toISOString(), rule: 'per chain: wZNYT supply <= ZNYT outstanding for that chain; sum of supplies <= totalLocked <= vault balance',
    totalLocked: formatEther(totalLocked), vaultBalance: formatEther(vaultBal), wznytTotalSupply: formatEther(sum), vaultPaused: paused, chains: per };
  if (!ok) {
    log('INVARIANT VIOLATION', JSON.stringify(health.invariant));
    try { if (!paused) await (await vault.connect(keysMod.guardianWallet(h.provider)).pause({ gasPrice: 1_000_000_000n })).wait(); health.invariant.autoPaused = true; }
    catch (e) { health.invariant.autoPauseError = String(e.shortMessage || e.message).slice(0, 160); }
  }
}

// ------------------------------------------------------------------ decentralisation snapshot (relayer set, operators, timelock)
let gov = null; let lastGov = 0;
async function governance() {
  const h = home(); const b = board();
  const ops = b ? await operatorsFrom(b, dep.home.boardDeployBlock || 0) : {};
  const machines = Object.fromEntries((dep.operators || []).map((o) => [o.address, o]));
  const lastSeen = {};
  if (b) {
    const from = Math.max(dep.home.boardDeployBlock || 0, Number(await h.provider.getBlockNumber()) - 50_000);
    for (const e of await b.queryFilter(b.filters.Attested(), from, 'latest')) lastSeen[e.args.signer] = e.blockNumber;
  }
  const perChain = [];
  for (const [cid, c] of chains) {
    if (!c.home && !verified.has(cid)) continue;
    try {
      const rs = await relayerSet(cid);
      perChain.push({ chainId: cid, id: c.rec.id, name: c.rec.name, contract: c.home ? dep.home.vault : c.rec.minter, owner: rs.owner,
        ownerIsTimelock: !!dep.timelocks?.[cid] && rs.owner.toLowerCase() === dep.timelocks[cid].address.toLowerCase(), relayers: rs.list, threshold: rs.threshold });
    } catch (e) { perChain.push({ chainId: cid, id: c.rec.id, error: String(e.shortMessage || e.message).slice(0, 120) }); }
  }
  const hs = perChain.find((x) => x.chainId === homeChainId()) || {};
  const relayers = (hs.relayers || []).map((a) => {
    const o = ops[a] || {}; const m = machines[a] || {};
    return { address: a, label: o.label || m.label || null, machine: o.machine || m.machine || null, operator: m.operator || null,
      mldsaPkSha256: o.mldsaPkSha256 || null, registeredTx: o.tx || null, lastAttestBlock: lastSeen[a] ?? null };
  });
  const byMachine = {}; for (const r of relayers) byMachine[r.machine || 'unknown'] = (byMachine[r.machine || 'unknown'] || 0) + 1;
  const byOperator = {}; for (const r of relayers) byOperator[r.operator || 'unknown'] = (byOperator[r.operator || 'unknown'] || 0) + 1;
  let timelock = null;
  const tl = dep.timelocks?.[homeChainId()];
  if (tl) {
    const t = timelockContract(tl.address, h.provider);
    const delay = Number(await t.getMinDelay());
    const pending = [];
    for (const e of await t.queryFilter(t.filters.CallScheduled(), tl.deployBlock || 0, 'latest')) {
      if (!(await t.isOperationPending(e.args.id))) continue;
      const ts = Number(await t.getTimestamp(e.args.id));
      pending.push({ id: e.args.id, target: e.args.target, data: e.args.data.slice(0, 10), readyAt: new Date(ts * 1000).toISOString(), tx: e.transactionHash });
    }
    timelock = { address: tl.address, minDelaySeconds: delay, proposer: dep.admin, cancellers: [dep.admin, dep.guardian], executor: 'anyone (after the delay)',
      pendingOnHome: pending, perChain: dep.timelocks };
  }
  const maxMachine = Math.max(0, ...Object.values(byMachine)); const maxOperator = Math.max(0, ...Object.values(byOperator));
  return { relayers, threshold: hs.threshold ?? null, total: relayers.length, byMachine, byOperator,
    noSingleMachineCanSign: hs.threshold ? maxMachine < hs.threshold : null, noSingleOperatorCanSign: hs.threshold ? maxOperator < hs.threshold : null,
    perChain, timelock, board: dep.home.board ? { address: dep.home.board, deployTx: dep.txs?.BridgeAttestationBoard || null } : null,
    registeredOperators: Object.values(ops).map(({ mldsaPublicKey, ...x }) => x),
    pauseIsInstant: 'guardian ' + dep.guardian + ' can pause the vault / any minter immediately; unpause and every config change go through the timelock',
    thresholdRule: 'threshold = max(floor(2n/3)+1, largest single-operator key count + 1)' };
}

// ------------------------------------------------------------------ read-only API (box, 127.0.0.1 only)
function publicTransfer(t) { const { thresholdSeenAt, myRank, ...x } = t; return x; }
function statusDoc() {
  const remotes = Object.values(dep.remotes || {}).map((r) => ({ id: r.id, name: r.name, chainId: r.chainId, status: r.status,
    standIn: !!r.standIn, standInFor: r.standInFor, vaultEnabled: !!r.vaultEnabled, minter: r.minter, token: r.token,
    explorer: r.explorer, rpc: r.standIn ? null : r.rpc, deployTx: r.deployTx || null, gasNeeded: r.gasNeeded || null, faucets: r.faucets || [],
    cursor: cursors.cursors[String(r.chainId)] ?? null }));
  const th = gov?.threshold ?? dep.threshold; const n = gov?.total ?? (dep.relayers || []).length;
  return { network: NETWORK, testnet: true, home: { chainId: homeChainId(), vault: dep.home?.vault, board: dep.home?.board || null, deployTx: dep.txs?.ZnytBridgeVault },
    admin: dep.admin, guardian: dep.guardian, relayers: gov?.relayers || dep.relayers, threshold: th, caps: dep.caps,
    minter: dep.minterAddress, token: dep.tokenAddress, tokenSymbol: 'wZNYT', tokenDecimals: 18, remotes, planned: dep.planned || [],
    attestation: { onChain: `${th}-of-${n} ECDSA (secp256k1, EIP-191) verified by the contracts`, gossip: 'each relayer posts its signatures to BridgeAttestationBoard on 9127; any relayer can submit',
      postQuantum: 'ML-DSA-65 signature per relayer, in the board Attested events (off-chain verified, NOT on-chain)' },
    decentralization: gov, transfers: Object.values(transfers).reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {}),
    invariant: health.invariant, relayer: { name: NAME, addresses: myAddrs, lastLoop: health.lastLoop, errors: health.errors, started: health.started } };
}
async function pqEntries(id) {
  const tr = transfers[id]; if (!tr || !board()) return [];
  const d = tr.digest || trDigest(tr);
  const atts = await attestationsFor(board(), d, dep.home.boardDeployBlock || 0);
  const ops = await operatorsFrom(board(), dep.home.boardDeployBlock || 0);
  const { pqVerify } = await import('./lib/bridge.mjs'); const { hexlify } = await import('ethers');
  return atts.map((a) => ({ id, digest: d, ecdsaSigner: a.signer, ecdsaOk: a.ecdsaOk, boardTx: a.tx, alg: 'ML-DSA-65',
    message: 'utf8("ZERONYTH_BRIDGE_V1/ML-DSA-65:") || digest', mldsaPublicKey: ops[a.signer] ? hexlify(ops[a.signer].mldsaPublicKey) : null,
    mldsaPkSha256: ops[a.signer]?.mldsaPkSha256 || null, mldsaSignature: a.mldsaSig,
    mldsaValid: ops[a.signer] ? pqVerify(hexlify(ops[a.signer].mldsaPublicKey), d, a.mldsaSig) : false }));
}
function startApi() {
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x'); const p = u.pathname.replace(/^\/api\/bridge/, '');
      if (req.method !== 'GET') return send(res, 405, { error: 'read-only' });
      // relayerSet is embedded in /status too, so the public gateway (fixed route allowlist) can serve it without a gateway restart.
      if (p === '/status' || p === '/') return send(res, 200, { ...statusDoc(), relayerSet: gov || null });
      if (p === '/relayers' || p === '/decentralization') return send(res, 200, gov || { note: 'not loaded yet' });
      if (p === '/invariant') return send(res, 200, health.invariant || { ok: null, note: 'not checked yet' });
      if (p === '/transfers') {
        const a = (u.searchParams.get('address') || '').toLowerCase();
        let list = Object.values(transfers).map(publicTransfer).filter((t) => !a || t.sender.toLowerCase() === a || t.recipient.toLowerCase().endsWith(a.slice(2)));
        list = list.sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || '')).slice(0, Math.min(100, Number(u.searchParams.get('limit') || 50)));
        return send(res, 200, { transfers: list });
      }
      if (p === '/transfer') { const t = transfers[u.searchParams.get('id') || '']; return t ? send(res, 200, publicTransfer(t)) : send(res, 404, { error: 'not found' }); }
      if (p === '/events') { // points hook: append-only log, poll with ?since=<seq>
        const since = Number(u.searchParams.get('since') || 0); const lim = Math.min(500, Number(u.searchParams.get('limit') || 200));
        const ev = existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.seq > since).slice(0, lim) : [];
        return send(res, 200, { events: ev, lastSeq: eventSeq });
      }
      if (p === '/attestations') { const id = u.searchParams.get('id') || ''; if (!/^\d+-\d+$/.test(id)) return send(res, 400, { error: 'id=<srcChainId>-<nonce>' }); return send(res, 200, { id, attestations: await pqEntries(id) }); }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 500, { error: 'internal' }); }
  }).listen(API_PORT, '127.0.0.1', () => log('api on 127.0.0.1:' + API_PORT));
}

// ------------------------------------------------------------------ main loop
log('relayer', NAME, myAddrs.join(','), API ? '(api+indexer+invariant)' : '', 'network', NETWORK, 'home rpc', HOME.rpc, 'state', STATE_DIR);
if (API) startApi();
let lastInv = 0; let registered = false;
for (;;) {
  try {
    if (refreshConfig()) {
      try { await verifyRemotes(); } catch (e) { health.errors.verify = String(e.shortMessage || e.message).slice(0, 160); }
      if (!registered && dep.home.board) { await registerSelf(); registered = true; }
      for (const c of chains.values()) {
        if (!c.home && !verified.has(c.rec.chainId)) continue;
        try { await scanChain(c); delete health.errors[c.rec.chainId]; }
        catch (e) { health.errors[c.rec.chainId] = String(e.shortMessage || e.message).slice(0, 160); }
      }
      try { await attestPending(); } catch (e) { health.errors.attestLoop = String(e.shortMessage || e.message).slice(0, 160); }
      try { await submitPending(); } catch (e) { health.errors.submitLoop = String(e.shortMessage || e.message).slice(0, 160); }
      if (API) {
        if (Date.now() - lastInv > 30_000) { lastInv = Date.now(); await checkInvariant(); }
        if (Date.now() - lastGov > 60_000) { lastGov = Date.now(); try { gov = await governance(); } catch (e) { health.errors.governance = String(e.shortMessage || e.message).slice(0, 160); } }
        writeJson(statusFile, statusDoc());
      }
    }
    health.lastLoop = new Date().toISOString();
  } catch (e) { log('loop error', e.shortMessage || e.message); }
  await sleep(POLL_MS);
}
