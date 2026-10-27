// End-to-end bridge test: for each chosen remote chain, an ephemeral test wallet locks ZNYT on the home vault, waits for
// the relayers to post signatures to the board + one of them to mint wZNYT, then burns the wZNYT and waits for the ZNYT release.
// Also checks: re-submitting the same signatures reverts (replay) and a non-relayer signature is rejected.
//   BRIDGE_NETWORK=main node script/e2e.mjs --chains=31337001,31337002 --amount=1
import { Wallet, parseEther, formatEther, getBytes, Contract } from 'ethers';
import path from 'node:path';
import { HOME } from '../lib/chains.mjs';
import { adminWallet } from '../lib/keys.mjs';
import { provider as mkProvider, vaultContract, minterContract, tokenContract, loadDeployment, readJson, writeJson,
  toB32, digest, pqVerify, sleep, STATE_DIR, NETWORK } from '../lib/bridge.mjs';
import { bridgeRoot } from '../lib/keys.mjs';
import { boardContract, attestationsFor, operatorsFrom, pickSigs, verifyMldsa } from '../lib/board.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const dep = loadDeployment();
const amount = parseEther(String(args.amount || '1'));
const chainIds = String(args.chains || Object.keys(dep.remotes).join(',')).split(',').map(Number);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const home = mkProvider(HOME.rpc, dep.home.chainId);
const admin = adminWallet(home);
const user = Wallet.createRandom().connect(home); // ephemeral, never persisted; leftovers are returned to admin
const gp = async (p) => (await p.getFeeData()).gasPrice ?? 1_000_000_000n;
const vault = vaultContract(dep.home.vault, user);
const out = { network: NETWORK, startedAt: new Date().toISOString(), testWallet: user.address, amount: formatEther(amount), runs: [] };
const outFile = path.join(bridgeRoot, 'deployments', args.out ? `${NETWORK}-e2e-${String(args.out).replace(/[^a-z0-9-]/gi, '')}.json` : `${NETWORK}-e2e.json`);
const transfer = (id) => readJson(path.join(STATE_DIR, 'transfers.json'), {})[id];
async function waitFor(fn, label, ms = Number(args.timeout || 300) * 1000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`); await sleep(2000); }
}
async function expectRevert(p, label) {
  try { await p; return `UNEXPECTED SUCCESS (${label})`; } catch (e) { return `reverted as expected: ${e.revert?.name || e.shortMessage || 'revert'}`; }
}

const need = amount * BigInt(chainIds.length) + parseEther('0.2');
const f = await (await admin.sendTransaction({ to: user.address, value: need, gasPrice: await gp(home) })).wait();
out.fundTx = f.hash; log('funded test wallet', user.address, formatEther(need), f.hash);

for (const cid of chainIds) {
  const rec = dep.remotes[cid]; const run = { chainId: cid, chain: rec.name, standIn: !!rec.standIn };
  out.runs.push(run);
  const rp = mkProvider(rec.rpc, cid);
  const ru = user.connect(rp); const radmin = adminWallet(rp);
  const token = tokenContract(rec.token, rp); const minter = minterContract(rec.minter, ru);
  // 1. lock
  const nonce = await vault.nextNonce();
  const lr = await (await vault.lock(cid, toB32(user.address), { value: amount, gasPrice: await gp(home) })).wait();
  run.lockTx = lr.hash; const id = `${dep.home.chainId}-${nonce}`; run.lockTransfer = id; log(rec.id, 'locked', id, lr.hash);
  // 2. attested + minted by the relayers
  const t = await waitFor(() => { const x = transfer(id); return x?.status === 'minted' && x; }, `mint ${id}`);
  // dstTx can lag (settled via processed() before the remote Minted event is finalized); wait briefly for the backfill.
  for (let i = 0; i < 60 && !transfer(id)?.dstTx; i++) await new Promise((r) => setTimeout(r, 5000));
  run.mintTx = transfer(id)?.dstTx || t.dstTx || null; run.mintSignatures = t.signatures;
  run.wznytBalance = formatEther(await token.balanceOf(user.address)); log(rec.id, 'minted', run.mintTx, run.wznytBalance, 'wZNYT');
  // 3. signatures come from the public BridgeAttestationBoard on 9127 (no coordinator); verify ECDSA + ML-DSA-65 there
  const board = boardContract(dep.home.board, home);
  const d = digest({ srcChainId: dep.home.chainId, srcContract: dep.home.vault, dstChainId: cid, dstContract: rec.minter, nonce, recipient: toB32(user.address), amount });
  const atts = await attestationsFor(board, d, dep.home.boardDeployBlock || 0);
  const ops = await operatorsFrom(board, dep.home.boardDeployBlock || 0);
  const mset = new Set(await minterContract(rec.minter, rp).relayers()); const th = Number(await minterContract(rec.minter, rp).threshold());
  run.mintBoardAttestations = atts.map((a) => ({ signer: a.signer, machine: ops[a.signer]?.machine || null, tx: a.tx }));
  run.mintSubmitter = t.submittedBy || t.submitter || null; run.mintSigners = t.signers || null; run.threshold = `${th}-of-${mset.size}`;
  run.mldsa65ValidSignatures = verifyMldsa(atts, ops, d);
  const { sigs } = pickSigs(atts, mset, th);
  // 4. replay: same signatures again must revert
  run.replayMint = await expectRevert(minterContract(rec.minter, radmin).mint.staticCall(nonce, toB32(user.address), amount, sigs), 'replay');
  // 5. wrong signer: a random key + (threshold-1) real relayers must be rejected
  const fake = Wallet.createRandom(); const d2 = digest({ srcChainId: dep.home.chainId, srcContract: dep.home.vault, dstChainId: cid, dstContract: rec.minter, nonce: 999999n, recipient: toB32(user.address), amount });
  const fsig = [fake.signMessageSync(getBytes(d2)), ...sigs.slice(0, th - 1)];
  run.wrongSigner = await expectRevert(minterContract(rec.minter, radmin).mint.staticCall(999999n, toB32(user.address), amount, fsig), 'wrong signer');
  run.tooFewSignatures = await expectRevert(minterContract(rec.minter, radmin).mint.staticCall(nonce, toB32(user.address), amount, sigs.slice(0, th - 1)), 'too few');
  // 6. burn back (test wallet gets remote gas from admin; on stand-ins this is local Anvil ETH)
  const g = await (await radmin.sendTransaction({ to: user.address, value: parseEther(rec.standIn ? '1' : '0.0005') })).wait(); run.remoteGasTx = g.hash;
  const bNonce = await minter.nextNonce();
  const br = await (await minter.burn(amount, user.address)).wait(); run.burnTx = br.hash; const bid = `${cid}-${bNonce}`; run.burnTransfer = bid;
  log(rec.id, 'burned', bid, br.hash);
  const t2 = await waitFor(() => { const x = transfer(bid); return x?.status === 'released' && x; }, `release ${bid}`);
  run.releaseTx = t2.dstTx; run.releaseSignatures = t2.signatures; run.releaseSigners = t2.signers || null; run.releaseSubmitter = t2.submittedBy || t2.submitter || null; log(rec.id, 'released', run.releaseTx);
  run.wznytAfter = formatEther(await token.balanceOf(user.address));
  run.outstandingAfter = formatEther(await vaultContract(dep.home.vault, home).outstanding(cid));
  writeJson(outFile, out);
}
// return leftover ZNYT to admin
const bal = await home.getBalance(user.address); const price = await gp(home);
if (bal > 21000n * price) { const r = await (await user.sendTransaction({ to: admin.address, value: bal - 21000n * price, gasPrice: price })).wait(); out.refundTx = r.hash; }
out.finishedAt = new Date().toISOString(); writeJson(outFile, out);
console.log(JSON.stringify(out, null, 2));
