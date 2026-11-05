// Vault v2 + migration test suite. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryStorage } from '../src/core/storage.mjs';
import { addressFromSecret } from '../src/core/crypto.mjs';
import {
  VAULT_KEY,
  VAULT_BACKUP_KEY,
  vaultExists,
  createVault,
  unlockVault,
  lockVault,
} from '../src/core/vault.mjs';
import {
  PASSWORD,
  WRONG_PASSWORD,
  VECTORS,
  V1_PASSWORD,
  V1_FIXTURE,
  encryptV1,
  seqBytes,
} from './fixtures.mjs';

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

// ------------------------------------------------------------ crypto vectors

test('crypto: known-answer address vectors for all three schemes', () => {
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    assert.equal(
      addressFromSecret(scheme, VECTORS[scheme].secret),
      VECTORS[scheme].address,
      `${scheme} address vector`,
    );
  }
});

// ------------------------------------------------------------ v2 round-trip

test('vault: create + add all schemes + lock/unlock round-trip', async () => {
  const storage = memoryStorage();
  const vault = await createVault(storage, PASSWORD);
  assert.equal(vaultExists(storage), true);
  assert.equal(JSON.parse(storage.getItem(VAULT_KEY)).version, 2);

  const added = {};
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    added[scheme] = await vault.addAccount(scheme, { secret: VECTORS[scheme].secret });
    assert.equal(added[scheme].address, VECTORS[scheme].address, `${scheme} address`);
    assert.equal(added[scheme].scheme, scheme);
  }
  assert.equal(vault.listAccounts().length, 3);

  lockVault(vault);
  assert.equal(vault.locked, true);
  assert.throws(() => vault.listAccounts(), /locked/);

  const reopened = await unlockVault(storage, PASSWORD);
  assert.equal(reopened.migratedFromV1, false);
  const list = reopened.listAccounts();
  assert.equal(list.length, 3);
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    const acct = list.find((a) => a.scheme === scheme);
    assert.ok(acct, `${scheme} present after reopen`);
    assert.equal(acct.address, VECTORS[scheme].address);
    assert.equal(acct.id, added[scheme].id, 'account id persists across unlock');
  }
});

test('vault: random accounts round-trip with distinct well-formed addresses', async () => {
  const storage = memoryStorage();
  const vault = await createVault(storage, PASSWORD);
  const before = [];
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    before.push(await vault.addAccount(scheme));
  }
  for (const a of before) assert.match(a.address, ADDRESS_RE);
  assert.equal(new Set(before.map((a) => a.address)).size, 3, 'addresses distinct');

  const reopened = await unlockVault(storage, PASSWORD);
  assert.deepEqual(
    reopened.listAccounts().map((a) => a.address).sort(),
    before.map((a) => a.address).sort(),
  );
});

// ------------------------------------------------------------ guards

test('vault: create refuses to overwrite; short password rejected', async () => {
  const storage = memoryStorage();
  await createVault(storage, PASSWORD);
  await assert.rejects(() => createVault(storage, PASSWORD), /Vault already exists/);

  const fresh = memoryStorage();
  await assert.rejects(() => createVault(fresh, 'short'), /minimum 12 characters/);
  assert.equal(vaultExists(fresh), false);
});

test('vault: wrong password rejected and vault untouched', async () => {
  const storage = memoryStorage();
  const vault = await createVault(storage, PASSWORD);
  await vault.addAccount('mldsa', { secret: VECTORS.mldsa.secret });
  const blobBefore = storage.getItem(VAULT_KEY);

  await assert.rejects(
    () => unlockVault(storage, WRONG_PASSWORD),
    /Invalid password or damaged backup/,
  );
  assert.equal(storage.getItem(VAULT_KEY), blobBefore, 'blob unchanged after failed unlock');

  const ok = await unlockVault(storage, PASSWORD);
  assert.equal(ok.listAccounts()[0].address, VECTORS.mldsa.address);
});

test('vault: tampered v2 ciphertext rejected', async () => {
  const storage = memoryStorage();
  const vault = await createVault(storage, PASSWORD);
  await vault.addAccount('ecdsa', { secret: VECTORS.ecdsa.secret });
  const blob = JSON.parse(storage.getItem(VAULT_KEY));
  const last = blob.ciphertext.at(-1);
  blob.ciphertext = blob.ciphertext.slice(0, -1) + (last === '0' ? '1' : '0');
  storage.setItem(VAULT_KEY, JSON.stringify(blob));
  await assert.rejects(
    () => unlockVault(storage, PASSWORD),
    /Invalid password or damaged backup/,
  );
});

test('vault: unlock with no vault present throws', async () => {
  await assert.rejects(() => unlockVault(memoryStorage(), PASSWORD), /No vault found/);
});

// ------------------------------------------------------------ secrets & lock

test('vault: exportSecret returns an independent copy of the secret', async () => {
  const storage = memoryStorage();
  const vault = await createVault(storage, PASSWORD);
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    const { id } = await vault.addAccount(scheme, { secret: VECTORS[scheme].secret });
    const exported = vault.exportSecret(id);
    assert.deepEqual(exported, VECTORS[scheme].secret, `${scheme} secret round-trips`);
    exported.fill(0xff); // mutating the copy must not affect the vault
    assert.deepEqual(vault.exportSecret(id), VECTORS[scheme].secret);
  }
  assert.throws(() => vault.exportSecret('no-such-id'), /No such account/);
});

test('vault: lock blocks every operation until a fresh unlock', async () => {
  const storage = memoryStorage();
  const vault = await createVault(storage, PASSWORD);
  const { id } = await vault.addAccount('falcon', { secret: VECTORS.falcon.secret });

  vault.lock();
  assert.equal(vault.locked, true);
  assert.throws(() => vault.listAccounts(), /locked/);
  assert.throws(() => vault.exportSecret(id), /locked/);
  await assert.rejects(() => vault.addAccount('ecdsa'), /locked/);

  const reopened = await unlockVault(storage, PASSWORD);
  assert.equal(reopened.listAccounts()[0].address, VECTORS.falcon.address);
});

// ------------------------------------------------------------ v1 migration

test('migration: genuine v1 bundle fixture migrates to the identical address', async () => {
  const storage = memoryStorage();
  storage.setItem(VAULT_KEY, V1_FIXTURE);

  const vault = await unlockVault(storage, V1_PASSWORD);
  assert.equal(vault.migratedFromV1, true);
  const list = vault.listAccounts();
  assert.equal(list.length, 1);
  assert.equal(list[0].scheme, 'mldsa');
  // THE critical assertion: seed carried verbatim -> identical address,
  // funds at the v1 wallet's address remain spendable.
  assert.equal(list[0].address, VECTORS.mldsa.address);
  assert.deepEqual(vault.exportSecret(list[0].id), VECTORS.mldsa.secret);

  // Original v1 blob preserved byte-for-byte under the backup key.
  assert.equal(storage.getItem(VAULT_BACKUP_KEY), V1_FIXTURE);
  // Main key now holds a v2 vault.
  assert.equal(JSON.parse(storage.getItem(VAULT_KEY)).version, 2);

  // Second unlock goes down the v2 path and yields the same account.
  const again = await unlockVault(storage, V1_PASSWORD);
  assert.equal(again.migratedFromV1, false);
  assert.equal(again.listAccounts()[0].address, VECTORS.mldsa.address);
  assert.equal(storage.getItem(VAULT_BACKUP_KEY), V1_FIXTURE, 'backup not overwritten');
});

test('migration: wrong password on a v1 blob writes nothing', async () => {
  const storage = memoryStorage();
  storage.setItem(VAULT_KEY, V1_FIXTURE);
  await assert.rejects(
    () => unlockVault(storage, WRONG_PASSWORD),
    /Invalid password or damaged backup/,
  );
  assert.equal(storage.getItem(VAULT_KEY), V1_FIXTURE, 'v1 blob still in place');
  assert.equal(storage.getItem(VAULT_BACKUP_KEY), null, 'no backup written on failure');
});

test('migration: transcribed v1 encryptor blob (random seed) migrates', async () => {
  const seed = seqBytes(32, 0xa0);
  const blob = await encryptV1(seed, PASSWORD);
  const storage = memoryStorage();
  const raw = JSON.stringify(blob);
  storage.setItem(VAULT_KEY, raw);

  const vault = await unlockVault(storage, PASSWORD);
  assert.equal(vault.migratedFromV1, true);
  assert.equal(vault.listAccounts()[0].address, addressFromSecret('mldsa', seed));
  assert.equal(storage.getItem(VAULT_BACKUP_KEY), raw);
});

test('migration: unsupported or malformed blobs rejected', async () => {
  const storage = memoryStorage();
  storage.setItem(VAULT_KEY, '{"version":99}');
  await assert.rejects(() => unlockVault(storage, PASSWORD), /Unsupported vault/);

  const storage2 = memoryStorage();
  storage2.setItem(VAULT_KEY, 'not json');
  await assert.rejects(() => unlockVault(storage2, PASSWORD), /Invalid vault/);

  // v1 envelope with a wrong iterations header must be rejected like v1 did.
  const bad = { ...JSON.parse(V1_FIXTURE), iterations: 1 };
  const storage3 = memoryStorage();
  storage3.setItem(VAULT_KEY, JSON.stringify(bad));
  await assert.rejects(() => unlockVault(storage3, V1_PASSWORD), /Unsupported vault/);
});
