// Funded XRP live proof (completes the checkpoint §5 step-2 XRP item).
//
// Flow on Altnet:
//   1. POST the public faucet -> a funded account + family seed
//      (the seed is used in memory only, never printed or written).
//   2. Convert the faucet seed into a raw private key (XRPL key
//      derivation) and REQUIRE deriveAddress(key) === faucet address
//      before proceeding — the conversion is self-verifying.
//   3. Faucet account -> our wallet-derived account (hd xrp idx0,
//      test master 0x42): 30 XRP (creates the account, >= reserve).
//      Signed with the engine's own serializers.
//   4. OUR account -> faucet address: 5 XRP with DestinationTag,
//      driven end-to-end by createXrpClient (prepareSend /
//      executeSend / getTxStatus) exactly as the wallet session does.
//   5. Raw `tx` lookup confirms the validated DestinationTag.
//
// Writes xrp-funded-probe-output.json. No secrets in the output.
import { writeFile } from 'node:fs/promises';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { deriveAccountSecret } from '../../src/core/hd.mjs';
import { deriveAddress as deriveXrpAddress, createXrpClient, serializePayment, paymentSigningHash, computeTxId, bytesToHexUpper, accountIdFromAddress, accountIdFromPublicKey, classicAddressFromAccountId, sha512Half } from '../../src/core/chains/xrp.mjs';
import { base58CheckDecode, XRP_ALPHABET } from '../../src/core/enc.mjs';
import { publicKeyFromSecret } from '../../src/core/crypto.mjs';

const ALTNET = 'https://s.altnet.rippletest.net:51234';
const FAUCET_URL = 'https://faucet.altnet.rippletest.net/accounts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { generatedAt: new Date().toISOString(), network: 'altnet', steps: {} };
const rec = (k, v) => { out.steps[k] = v; console.error(`[xrp-funded] ${k}: ${JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))}`); };

async function rpc(method, params = {}) {
  const res = await fetch(ALTNET, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json();
  if (json?.result?.status === 'error') throw Error(`${method}: ${json.result.error_message ?? json.result.error}`);
  return json.result;
}

// ------------------------------------------------ faucet seed -> raw key
const ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'); // secp256k1 n
const toScalar = (bytes32) => {
  let v = BigInt('0x' + Buffer.from(bytes32).toString('hex')) % ORDER;
  return v;
};
function u32be(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; }
function concat(...arrs) { const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }

function keypairFromFamilySeed(seedText) {
  const payload = base58CheckDecode(seedText, XRP_ALPHABET); // version || entropy (XRPL seeds use the XRP alphabet)
  // The altnet faucet currently issues Ed25519 seeds whose payload is
  // a 3-byte prefix + 16 bytes of entropy (found empirically
  // 2026-11-06: only skip=3/len=16 reproduces the issued address).
  // Rather than trust one layout, generate candidates across the
  // plausible layouts; the caller accepts ONLY a candidate whose
  // derived classic address equals the faucet-issued address.
  const edCandidates = [];
  if (payload[0] === 0x01 && payload[1] === 0xe1) {
    for (const skip of [2, 3]) {
      for (const len of [16, 17]) {
        const ent = payload.slice(skip, skip + len);
        if (ent.length < len) continue;
        const secret = sha512Half(ent);
        const pub = ed25519.getPublicKey(secret);
        edCandidates.push({ secret, pubField: concat(new Uint8Array([0xed]), pub) });
      }
    }
    if (edCandidates.length) return { kind: 'ed25519', candidates: edCandidates };
  }
  if (payload.length === 17 && payload[0] === 0x21) {
    const entropy = payload.slice(1);
    const privGen = toScalar(sha512Half(entropy));
    if (privGen === 0n) throw Error('invalid private generator');
    const pubGen = secp256k1.getPublicKey(Uint8Array.from(Buffer.from(privGen.toString(16).padStart(64, '0'), 'hex')), true);
    const candidates = [];
    for (const suffix of [[0, 0], [0]]) {
      const parts = [pubGen, ...suffix.map(u32be)];
      const h = toScalar(sha512Half(concat(...parts)));
      const acct = (privGen + h) % ORDER;
      if (acct !== 0n) candidates.push(acct.toString(16).padStart(64, '0'));
    }
    return { kind: 'secp256k1', candidates };
  }
  throw Error(`unrecognized seed payload (len ${payload.length}, v=${payload[0]})`);
}

async function signAndSubmit({ from, to, amountDrops, feeDrops, sequence, lastLedgerSequence, destinationTag, signingPubKeyField, sign }) {
  const tx = {
    accountId: accountIdFromAddress(from),
    destinationId: accountIdFromAddress(to),
    amountDrops: BigInt(amountDrops),
    feeDrops: BigInt(feeDrops),
    sequence,
    lastLedgerSequence,
    destinationTag,
    signingPubKey: signingPubKeyField,
  };
  const signingData = serializePayment(tx);
  const hash = paymentSigningHash(signingData);
  // ECDSA signs the sha512half digest; Ed25519 signs the full
  // prefixed signing data (53545800 ‖ data) — verified byte-for-byte
  // against xrpl.js Wallet.sign output 2026-11-06.
  const prefixed = concat(new Uint8Array([0x53, 0x54, 0x58, 0x00]), signingData);
  const sig = sign({ hash, prefixed });
  const blob = serializePayment({ ...tx, txnSignature: sig });
  const id = computeTxId(blob);
  const res = await fetch(ALTNET, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'submit', params: [{ tx_blob: bytesToHexUpper(blob) }] }),
    signal: AbortSignal.timeout(30000),
  });
  const result = (await res.json())?.result ?? {};
  if (result.status === 'error' || (result.engine_result && result.engine_result.startsWith('tem'))) {
    throw Error(`submit detail: ${JSON.stringify(result).slice(0, 400)}`);
  }
  return { id, engineResult: result.engine_result, engineMessage: result.engine_result_message ?? null };
}

async function waitValidated(hash, tries = 20) {
  const client = createXrpClient(ALTNET);
  for (let i = 0; i < tries; i++) {
    const s = await client.getTxStatus(hash).catch(() => 'pending');
    if (s !== 'pending') return s;
    await sleep(3000);
  }
  return 'pending';
}

try {
  // ---------------------------------------------------------- our account
  const master = new Uint8Array(32).fill(0x42);
  const ourSecret = deriveAccountSecret(master, 'xrp', 0);
  const ourAddress = deriveXrpAddress(ourSecret, 'testnet');
  rec('ourAccount', { address: ourAddress });

  // ---------------------------------------------------------- faucet
  const fRes = await fetch(FAUCET_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(60000) });
  const fJson = await fRes.json();
  const faucetAddress = fJson?.account?.classicAddress ?? fJson?.account?.address;
  const faucetSeed = fJson?.account?.secret ?? fJson?.seed;
  if (!faucetAddress || !faucetSeed) throw Error(`faucet response missing account/secret: ${JSON.stringify(fJson).slice(0, 200)}`);
  rec('faucetAccount', { address: faucetAddress, httpStatus: fRes.status, amountXrp: fJson?.amount ?? null });

  const kp = keypairFromFamilySeed(faucetSeed);
  let faucetSecret = null; // 32-byte hex secret for the engine path (secp256k1 only)
  if (kp.kind === 'secp256k1') {
    for (const candHex of kp.candidates) {
      const sec = Uint8Array.from(Buffer.from(candHex, 'hex'));
      if (deriveXrpAddress(sec, 'testnet') === faucetAddress) { faucetSecret = sec; break; }
    }
    if (!faucetSecret) throw Error('seed conversion did not reproduce the faucet address');
    rec('seedConversion', { kind: 'secp256k1', addressReproduced: true });
  } else {
    let matched = null;
    for (const cand of kp.candidates) {
      const addr = classicAddressFromAccountId(accountIdFromPublicKey(cand.pubField));
      if (addr === faucetAddress) { matched = cand; break; }
    }
    if (!matched) throw Error('ed25519 seed conversion did not reproduce the faucet address');
    kp.secret = matched.secret;
    kp.pubField = matched.pubField;
    rec('seedConversion', { kind: 'ed25519', addressReproduced: true, note: 'faucet leg signed manually with engine serializers' });
  }

  // wait for the faucet account to be validated/funded
  const client = createXrpClient(ALTNET);
  let faucetBalance = 0n;
  for (let i = 0; i < 20; i++) {
    faucetBalance = await client.getBalance(faucetAddress).catch(() => 0n);
    if (faucetBalance > 0n) break;
    await sleep(3000);
  }
  rec('faucetBalance', { drops: faucetBalance });
  if (faucetBalance < 35_000_000n) throw Error('faucet account not funded enough');

  const info = await rpc('server_info', {});
  const lastLedger = Number(info.info.validated_ledger.seq) + 20;
  const feeRes = await rpc('fee', {}).catch(() => null);
  const feeDrops = feeRes ? BigInt(feeRes.drops.base_fee) : 12n;
  const fInfo = await rpc('account_info', { account: faucetAddress, ledger_index: 'validated' });

  // ------------------------------------------------- leg 1: fund ours
  let leg1;
  if (faucetSecret) {
    const plan = await client.prepareSend({ from: faucetAddress, to: ourAddress, amount: 30_000_000n });
    leg1 = await client.executeSend(plan, faucetSecret);
    leg1 = { hash: leg1.hash, engineResult: leg1.engineResult, via: 'engine' };
  } else {
    const sig = ({ prefixed }) => ed25519.sign(prefixed, kp.secret);
    leg1 = await signAndSubmit({
      from: faucetAddress, to: ourAddress, amountDrops: 30_000_000n, feeDrops,
      sequence: Number(fInfo.account_data.Sequence), lastLedgerSequence: lastLedger,
      signingPubKeyField: kp.pubField, sign: sig,
    });
    leg1 = { hash: leg1.id, engineResult: leg1.engineResult, via: 'manual-ed25519' };
  }
  rec('fundOurs', leg1);
  const leg1Status = await waitValidated(leg1.hash);
  rec('fundOursStatus', { status: leg1Status });
  if (leg1Status !== 'success') throw Error('funding payment did not validate as success');

  const ourBalance = await client.getBalance(ourAddress);
  rec('ourBalanceAfterFunding', { drops: ourBalance });

  // ------------------------------------------------- leg 2: tagged payment from OUR engine account
  const TAG = 20261106;
  const plan2 = await client.prepareSend({ from: ourAddress, to: faucetAddress, amount: 5_000_000n, opts: { destinationTag: TAG } });
  const send2 = await client.executeSend(plan2, ourSecret);
  rec('taggedPayment', { hash: send2.hash, engineResult: send2.engineResult, destinationTag: TAG, fee: plan2.fee, sequence: plan2.sequence });
  const status2 = await waitValidated(send2.hash);
  rec('taggedPaymentStatus', { status: status2 });

  const txRaw = await rpc('tx', { transaction: send2.hash, binary: false });
  rec('validatedTx', {
    result: txRaw.meta?.TransactionResult ?? txRaw.metaData?.TransactionResult,
    destinationTag: txRaw.tx_json?.DestinationTag ?? txRaw.DestinationTag ?? null,
    amount: txRaw.tx_json?.Amount ?? txRaw.Amount ?? null,
    validated: txRaw.validated,
  });
  out.ok = leg1Status === 'success' && status2 === 'success'
    && (txRaw.tx_json?.DestinationTag ?? txRaw.DestinationTag) === TAG;
} catch (e) {
  out.error = String(e?.stack ?? e);
  out.ok = false;
}
const render = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 1);
await writeFile(new URL('./xrp-funded-probe-output.json', import.meta.url), render(out));
console.log(render(out));
