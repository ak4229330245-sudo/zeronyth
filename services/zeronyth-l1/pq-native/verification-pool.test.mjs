import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENESIS_KIND, generateIdentity, signTransaction } from './pq.mjs';
import { Ledger } from './ledger.mjs';
import { SignatureVerificationPool } from './verification-pool.mjs';

function fixture() {
  const validators = Array.from({ length:4 }, generateIdentity);
  const source = generateIdentity();
  const recipient = generateIdentity();
  const ledger = new Ledger({
    kind:GENESIS_KIND, chainId:'19127',
    validators:validators.map(({ publicKey }) => ({ publicKey })),
    allocations:[{ address:source.address, balance:'10000' }],
  });
  const signed = Array.from({ length:12 }, (_, index) => signTransaction({
    chainId:'19127', nonce:String(index), to:recipient.address, value:'1',
  }, source.privateKey));
  return { ledger, signed, source };
}

test('parallel ML-DSA preverification is independent, complete and non-mutating', async () => {
  const x = fixture();
  const pool = new SignatureVerificationPool({ workers:2 });
  try {
    assert.equal(await x.ledger.preverifyTransactionsAsync(x.signed, pool), 12);
    assert.equal(x.ledger.balance(x.source.address), 10000n);
    assert.equal(x.ledger.nonce(x.source.address), 0n);
    const next = x.ledger.simulate(x.signed);
    assert.equal(next.accounts.get(x.source.address).nonce, 12n);
    assert.equal(next.accounts.get(x.source.address).balance, 9988n);
    assert.equal(await x.ledger.preverifyTransactionsAsync(x.signed, pool), 12);
  } finally { await pool.close(); }
});

test('bad signature fails parallel batch but does not permanently disable validator', async () => {
  const x = fixture();
  const pool = new SignatureVerificationPool({ workers:2 });
  try {
    const forged = x.signed.map(tx => ({ ...tx }));
    forged[3].to = generateIdentity().address;
    await assert.rejects(x.ledger.preverifyTransactionsAsync(forged, pool), /Invalid ML-DSA/);
    assert.equal(await x.ledger.preverifyTransactionsAsync(x.signed, pool), 12);
    assert.throws(() => x.ledger.simulate(forged), /Invalid ML-DSA/);
    await assert.rejects(x.ledger.preverifyTransactionsAsync(x.signed, {
      verifyTransactions:async () => x.signed.map(() => ({ sender:x.source.address, nonce:'0', value:'1' })),
    }), /verification pool/);
  } finally { await pool.close(); }
});

test('parallel worker count is bounded and closed pool fails closed', async () => {
  assert.throws(() => new SignatureVerificationPool({ workers:17 }), /1\.\.16/);
  const x = fixture();
  const pool = new SignatureVerificationPool({ workers:1 });
  await pool.close();
  await assert.rejects(pool.verifyTransactions(x.signed, '19127'), /unavailable/);
});
