// PQ relayer demo + gas measurement (BOX TEST CHAIN ONLY, valueless ZNYT).
//  1. user makes an ML-DSA-65 key (local, never sent anywhere; secret stays in memory of this demo)
//  2. a PqRelayAccount is deployed for its public key; relayer = test role `pq-relayer` (gas payer, via nonce queue)
//  3. user signs an intent -> relayer verifies it IN FULL (lib/mldsa.mjs, native OpenSSL on Node>=24 or noble)
//     -> submits execute() with the 3309-byte signature in calldata, reimbursed `fee` from the account
//  4. audit: an independent check re-reads the tx from chain, recomputes the intent and re-verifies the signature
//  5. negatives: tampered intent / bad signature refused by relayer; non-relayer caller and over-limit refused on chain
// Prints gas: plain ECDSA transfer vs PQ relayed transfer.
import { ml_dsa65 } from '../dashboard/assets/vendor-noble.mjs';
import { ContractFactory, Contract, Interface, getBytes, concat, toUtf8Bytes, parseEther, formatEther, Wallet, keccak256 } from 'ethers';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { provider, artifact, roleWallet, queuedRole, GAS_PRICE } from './lib/common.mjs';
import { verifyMldsa65, BACKEND } from './lib/mldsa.mjs';
import { QueuedSigner } from './lib/signer-queue.mjs';

const MSG_PREFIX = toUtf8Bytes('ZERONYTH-PQ-RELAY-v1:');
const pqMessage = (intent) => getBytes(concat([MSG_PREFIX, intent]));
const out = { backend: BACKEND, node: process.version, gasPriceWei: GAS_PRICE.toString() };
const log = (...a) => console.log(...a);
const ov = { gasPrice: GAS_PRICE, type: 0 };

const dep = await queuedRole('deployer');
const relayerW = roleWallet('pq-relayer'); const relayer = new QueuedSigner(relayerW, { chainId: 9127 });
if ((await provider.getBalance(relayerW.address)) < parseEther('2')) await (await dep.sendTransaction({ to: relayerW.address, value: parseEther('3'), ...ov })).wait();

// 1. user key
const kp = ml_dsa65.keygen(randomBytes(32));
// 2. account
const a = artifact('PqRelayAccount');
const acct = await new ContractFactory(a.abi, a.bytecode, relayer).deploy(kp.publicKey, relayerW.address, parseEther('5'), ov);
const deployRc = await acct.deploymentTransaction().wait(); const acctAddr = await acct.getAddress();
out.deployGas = Number(deployRc.gasUsed);
await (await dep.sendTransaction({ to: acctAddr, value: parseEther('10'), ...ov })).wait();
log(`account ${acctAddr} deployed (gas ${out.deployGas}), funded 10 test ZNYT, dailyLimit 5`);

// relayer-side check: full ML-DSA-65 verification, then submit
async function relay({ to, value, data = '0x', fee, deadline, sig }) {
  const n = await acct.nonce();
  const intent = await acct.intentHash(n, to, value, data, fee, deadline);
  if (!verifyMldsa65(sig, pqMessage(intent), kp.publicKey)) throw new Error('relayer: ML-DSA-65 signature invalid -> refused');
  const tx = await acct.execute(to, value, data, fee, deadline, sig, { ...ov, gasLimit: 300000n });
  return { tx, rc: await tx.wait(), intent };
}
const userSign = async (to, value, fee, deadline, data = '0x') => {
  const intent = await acct.intentHash(await acct.nonce(), to, value, data, fee, deadline);
  return ml_dsa65.sign(pqMessage(intent), kp.secretKey);
};
const dest = Wallet.createRandom().address; const deadline = Math.floor(Date.now() / 1000) + 600; const fee = parseEther('0.01');

// 3. good relayed transfer
const sig = await userSign(dest, parseEther('1'), fee, deadline);
const { tx, rc } = await relay({ to: dest, value: parseEther('1'), fee, deadline, sig });
out.pqRelayedTransferGas = Number(rc.gasUsed); out.calldataBytes = getBytes(tx.data).length;
log(`relayed 1 ZNYT -> ${dest.slice(0, 10)}… gas ${rc.gasUsed}, calldata ${out.calldataBytes} B, dest balance ${formatEther(await provider.getBalance(dest))}`);

// second relayed transfer (storage slots already non-zero, existing destination) = steady-state cost
{ const s2 = await userSign(dest, parseEther('0.5'), fee, deadline); const r2 = await relay({ to: dest, value: parseEther('0.5'), fee, deadline, sig: s2 });
  out.pqRelayedTransferGasSteady = Number(r2.rc.gasUsed); log(`2nd relayed transfer gas ${r2.rc.gasUsed}`); }
// plain ECDSA transfer for comparison
const plain = await (await dep.sendTransaction({ to: dest, value: 1n, ...ov })).wait(); out.plainTransferGas = Number(plain.gasUsed);

// 4. independent audit from chain data only
{
  const t = await provider.getTransaction(rc.hash); const iface = new Interface(a.abi);
  const p = iface.parseTransaction({ data: t.data });
  const keyLog = (await provider.getLogs({ address: acctAddr, fromBlock: deployRc.blockNumber, toBlock: deployRc.blockNumber })).map((l) => iface.parseLog(l)).find((l) => l?.name === 'PqKey');
  const ev = rc.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((l) => l?.name === 'Executed');
  const pk = getBytes(keyLog.args.publicKey);
  const okKey = keccak256(pk) === (await acct.pqKeyHash());
  const okSig = verifyMldsa65(getBytes(p.args.sig), pqMessage(ev.args.intent), pk);
  out.audit = { keyMatchesOnChainHash: okKey, signatureVerifiesFromChainData: okSig };
  log('audit from chain data:', out.audit);
}
// 5. negatives
const neg = {};
try { const s2 = await userSign(dest, parseEther('1'), fee, deadline); await relay({ to: dest, value: parseEther('2'), fee, deadline, sig: s2 }); neg.tamperedValue = 'ACCEPTED (bad)'; } catch (e) { neg.tamperedValue = e.message.slice(0, 60); }
try { const s3 = await userSign(dest, parseEther('1'), fee, deadline); s3[100] ^= 1; await relay({ to: dest, value: parseEther('1'), fee, deadline, sig: s3 }); neg.bitFlippedSig = 'ACCEPTED (bad)'; } catch (e) { neg.bitFlippedSig = e.message.slice(0, 60); }
try { const other = new Contract(acctAddr, a.abi, dep); await other.execute.staticCall(dest, 1n, '0x', 0n, deadline, sig); neg.nonRelayerCaller = 'ACCEPTED (bad)'; } catch (e) { neg.nonRelayerCaller = e.revert?.name || e.shortMessage?.slice(0, 60); }
try { await acct.execute.staticCall(dest, parseEther('4'), '0x', 0n, deadline, sig); neg.overDailyLimit = 'ACCEPTED (bad)'; } catch (e) { neg.overDailyLimit = e.revert?.name || e.shortMessage?.slice(0, 60); }
out.negatives = neg; log('negatives:', neg);
out.overheadVsPlainFirst = +(out.pqRelayedTransferGas / out.plainTransferGas).toFixed(2); out.overheadVsPlainSteady = +(out.pqRelayedTransferGasSteady / out.plainTransferGas).toFixed(2);
out.relayerFeeZnyt = formatEther(fee); out.relayerGasCostZnyt = formatEther(BigInt(out.pqRelayedTransferGas) * GAS_PRICE);
log(JSON.stringify(out));
writeFileSync(new URL('./results/pq-relayer-gas.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
process.exit(0);
