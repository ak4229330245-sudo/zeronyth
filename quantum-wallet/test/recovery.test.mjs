// Recovery test suite: BIP39 phrase encoding, master-seed derivation,
// master vaults, encrypted backup export/import, and the session-level
// recovery flows (create / restore / reveal). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryStorage } from '../src/core/storage.mjs';
import { toHex, fromHex, utf8Encode, utf8Decode } from '../src/core/bytes.mjs';
import { BIP39_WORDLIST } from '../src/core/bip39-wordlist.mjs';
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  normalizeMnemonic,
  isValidMnemonic,
} from '../src/core/bip39.mjs';
import {
  generateMasterSeed,
  deriveAccountSecret,
  deriveAccountAddress,
} from '../src/core/hd.mjs';
import { addressFromSecret } from '../src/core/crypto.mjs';
import {
  VAULT_KEY,
  vaultExists,
  createVault,
  createMasterVault,
  importVaultBackup,
  unlockVault,
} from '../src/core/vault.mjs';
import { createSession } from '../src/app/session.mjs';
import { PASSWORD, WRONG_PASSWORD, VECTORS, seqBytes } from './fixtures.mjs';

const BACKUP_PASSWORD = 'backup-test-password';
const NEW_PASSWORD = 'restored-wallet-password';

// ---------------------------------------------------------------- wordlist

test('bip39: wordlist is the official 2048-word English list', () => {
  assert.equal(BIP39_WORDLIST.length, 2048);
  assert.equal(new Set(BIP39_WORDLIST).size, 2048, 'all words unique');
  assert.equal(BIP39_WORDLIST[0], 'abandon');
  assert.equal(BIP39_WORDLIST[102], 'art');
  assert.equal(BIP39_WORDLIST[2047], 'zoo');
  const sorted = [...BIP39_WORDLIST].sort();
  assert.deepEqual([...BIP39_WORDLIST], sorted, 'alphabetical order');
  // BIP39 property: the first 4 letters of every word are unique.
  const prefixes = new Set(BIP39_WORDLIST.map((w) => w.slice(0, 4)));
  assert.equal(prefixes.size, 2048, 'first-4-letter prefixes unique');
});

// ------------------------------------------------------------------ vectors

// Official BIP39 test vectors (bitcoin/bips bip-0039 vectors, as also
// published by trezor/python-mnemonic). Cross-checked during
// development against ethers v6's independent BIP39 implementation.
const OFFICIAL_VECTORS = [
  {
    entropy: new Uint8Array(32),
    phrase:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
  },
  {
    entropy: new Uint8Array(32).fill(0x7f),
    phrase:
      'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
  },
  {
    entropy: new Uint8Array(32).fill(0x80),
    phrase:
      'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless',
  },
  {
    entropy: new Uint8Array(32).fill(0xff),
    phrase:
      'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote',
  },
];

test('bip39: official test vectors — entropy encodes to the exact phrase', () => {
  for (const { entropy, phrase } of OFFICIAL_VECTORS) {
    assert.equal(entropyToMnemonic(entropy).join(' '), phrase);
  }
});

test('bip39: official test vectors — phrase decodes back to the entropy', () => {
  for (const { entropy, phrase } of OFFICIAL_VECTORS) {
    assert.deepEqual(mnemonicToEntropy(phrase), entropy);
    assert.equal(isValidMnemonic(phrase), true);
  }
});

test('bip39: random entropies round-trip (encode -> decode)', () => {
  for (let i = 0; i < 10; i++) {
    const entropy = generateMasterSeed();
    const words = entropyToMnemonic(entropy);
    assert.equal(words.length, 24);
    assert.deepEqual(mnemonicToEntropy(words), entropy);
    assert.deepEqual(mnemonicToEntropy(words.join(' ')), entropy);
  }
});

test('bip39: input normalization accepts messy whitespace and case', () => {
  const { entropy, phrase } = OFFICIAL_VECTORS[1];
  const messy = '  ' + phrase.toUpperCase().split(' ').join(' \n\t ') + '  ';
  assert.deepEqual(mnemonicToEntropy(messy), entropy);
  assert.deepEqual(normalizeMnemonic('Legal  WINNER thank'), ['legal', 'winner', 'thank']);
});

test('bip39: checksum failure is rejected', () => {
  const words = entropyToMnemonic(new Uint8Array(32));
  const tampered = [...words.slice(0, 23), 'zoo'].join(' ');
  assert.equal(isValidMnemonic(tampered), false);
  assert.throws(() => mnemonicToEntropy(tampered), /checksum mismatch/);
  // Transposing two words must also fail (order is checksummed).
  const swapped = [...words];
  [swapped[0], swapped[23]] = [swapped[23], swapped[0]];
  assert.equal(isValidMnemonic(swapped.join(' ')), false);
});

test('bip39: unknown word and wrong word count are rejected', () => {
  const words = entropyToMnemonic(new Uint8Array(32));
  const unknown = [...words.slice(0, 23), 'notaword'].join(' ');
  assert.throws(() => mnemonicToEntropy(unknown), /Unknown word in recovery phrase: notaword/);
  assert.throws(() => mnemonicToEntropy(words.slice(0, 23).join(' ')), /must have/);
  assert.throws(() => mnemonicToEntropy(''), /must have/);
  assert.throws(() => entropyToMnemonic(new Uint8Array(10)), /Entropy must be/);
});

// --------------------------------------------------------------- derivation

// Known-answer table for master = seqBytes(32, 0x40) (bytes 0x40..0x5f),
// produced by hd.mjs and pinned here so any KDF change is caught.
const KAT_MASTER = seqBytes(32, 0x40);
const KAT_ADDRESSES = {
  mldsa: [
    '0x818772626a15b617f36cac889bd4feca5a325177',
    '0xaf7418f20e6ac48b81fba5017e12e58b173d4482',
    '0xb7e407ed4621f5ace12317434ec6eeba8acda8c6',
  ],
  falcon: [
    '0x2a80620cf9ad7d0b030bce3315494346febb5be6',
    '0x174ac0d419c5b777e21c4312fcb920dea737ceaa',
    '0xa27dd6e04bbc6058a10d99b9b5aef209d361e0e1',
  ],
  ecdsa: [
    '0x703157af39cbec26cd189367cb728cb17675a872',
    '0xe944607c344ccc907dc52212c41034b761579484',
    '0xfb1ad9d1c0c14e8a42f1a9ee328e8fdfbb94093e',
  ],
};

test('hd: derivation is deterministic and matches the pinned KAT addresses', () => {
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    for (let index = 0; index < 3; index++) {
      const a = deriveAccountSecret(KAT_MASTER, scheme, index);
      const b = deriveAccountSecret(KAT_MASTER, scheme, index);
      assert.deepEqual(a, b, `${scheme}#${index} deterministic`);
      assert.equal(a.length, { mldsa: 32, falcon: 48, ecdsa: 32 }[scheme]);
      assert.equal(deriveAccountAddress(KAT_MASTER, scheme, index), KAT_ADDRESSES[scheme][index]);
      assert.equal(
        addressFromSecret(scheme, a),
        KAT_ADDRESSES[scheme][index],
        'deriveAccountAddress agrees with addressFromSecret(deriveAccountSecret)',
      );
    }
  }
});

test('hd: scheme and index separation — every (scheme, index) differs', () => {
  const seen = new Set();
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    for (let index = 0; index < 3; index++) {
      seen.add(deriveAccountAddress(KAT_MASTER, scheme, index));
    }
  }
  assert.equal(seen.size, 9);
  const other = deriveAccountAddress(seqBytes(32, 0x41), 'mldsa', 0);
  assert.notEqual(other, KAT_ADDRESSES.mldsa[0], 'different master -> different address');
  assert.throws(() => deriveAccountSecret(new Uint8Array(31), 'mldsa', 0), /Master seed must be/);
  assert.throws(() => deriveAccountSecret(KAT_MASTER, 'mldsa', -1), /out of range/);
});

// -------------------------------------------------------------- master vault

/** Decrypt a v2 vault blob's payload JSON with the raw envelope (test-side). */
async function decryptVaultPayload(storage, password) {
  const blob = JSON.parse(storage.getItem(VAULT_KEY));
  const base = await crypto.subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(blob.salt), iterations: 600000 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromHex(blob.iv), additionalData: utf8Encode('ZERONYTH/VAULT/V2') },
    key,
    fromHex(blob.ciphertext),
  );
  return JSON.parse(utf8Decode(new Uint8Array(pt)));
}

test('vault: master create + unlock round-trip reproduces every address', async () => {
  const storage = memoryStorage();
  const vault = await createMasterVault(storage, PASSWORD, KAT_MASTER);
  assert.equal(vault.isMaster, true);
  const added = {};
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    added[scheme] = await vault.addAccount(scheme);
    assert.equal(added[scheme].address, KAT_ADDRESSES[scheme][0]);
    assert.equal(added[scheme].index, 0);
  }
  const extra = await vault.addAccount('mldsa');
  assert.equal(extra.index, 1);
  assert.equal(extra.address, KAT_ADDRESSES.mldsa[1]);

  // The persisted payload is a master payload: master seed + descriptors,
  // and crucially NO per-account secret material anywhere.
  const payload = await decryptVaultPayload(storage, PASSWORD);
  assert.equal(payload.kind, 'master');
  assert.equal(payload.master, toHex(KAT_MASTER));
  assert.equal(payload.accounts.length, 4);
  for (const a of payload.accounts) {
    assert.ok(!('secret' in a), 'master payload must not store account secrets');
    assert.ok(Number.isSafeInteger(a.index));
  }

  vault.lock();
  assert.equal(vault.isMaster, false, 'master reference dropped on lock');
  assert.throws(() => vault.exportMasterSeed(), /locked/);

  const reopened = await unlockVault(storage, PASSWORD);
  assert.equal(reopened.isMaster, true);
  assert.deepEqual(reopened.exportMasterSeed(), KAT_MASTER);
  assert.deepEqual(
    reopened.listAccounts().map((a) => a.address).sort(),
    [...Object.values(added).map((a) => a.address), extra.address].sort(),
  );
});

test('vault: master addAccount rejects injected secrets and duplicate indices', async () => {
  const storage = memoryStorage();
  const vault = await createMasterVault(storage, PASSWORD, KAT_MASTER);
  await assert.rejects(
    () => vault.addAccount('mldsa', { secret: VECTORS.mldsa.secret }),
    /derived, not imported/,
  );
  await vault.addAccount('ecdsa', { index: 2 });
  await assert.rejects(() => vault.addAccount('ecdsa', { index: 2 }), /already exists/);
  const list = vault.listAccounts();
  assert.equal(list.find((a) => a.scheme === 'ecdsa').address, KAT_ADDRESSES.ecdsa[2]);
});

test('vault: legacy vault has no master and exportMasterSeed throws', async () => {
  const storage = memoryStorage();
  const vault = await createVault(storage, PASSWORD);
  assert.equal(vault.isMaster, false);
  assert.throws(() => vault.exportMasterSeed(), /No recovery phrase/);
});

// ------------------------------------------------------------------- backup

test('backup: master wallet export -> import reproduces everything', async () => {
  const from = memoryStorage();
  const vault = await createMasterVault(from, PASSWORD, KAT_MASTER);
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) await vault.addAccount(scheme);
  await vault.addAccount('falcon');
  const before = vault.listAccounts();

  const text = await vault.exportBackup(BACKUP_PASSWORD);
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, 'zeronyth-wallet-backup');
  assert.ok(!text.includes(toHex(KAT_MASTER)), 'backup ciphertext must not contain the master seed');

  const to = memoryStorage();
  const imported = await importVaultBackup(to, text, BACKUP_PASSWORD, NEW_PASSWORD);
  assert.equal(imported.isMaster, true);
  assert.deepEqual(imported.exportMasterSeed(), KAT_MASTER);
  assert.deepEqual(
    imported.listAccounts().map((a) => `${a.scheme}#${a.index}:${a.address}`).sort(),
    before.map((a) => `${a.scheme}#${a.index}:${a.address}`).sort(),
  );
  // The imported vault unlocks with the NEW wallet password.
  const reopened = await unlockVault(to, NEW_PASSWORD);
  assert.equal(reopened.listAccounts().length, before.length);
});

test('backup: legacy wallet export -> import reproduces all accounts', async () => {
  const from = memoryStorage();
  const vault = await createVault(from, PASSWORD);
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    await vault.addAccount(scheme, { secret: VECTORS[scheme].secret });
  }
  const text = await vault.exportBackup(BACKUP_PASSWORD);

  const to = memoryStorage();
  const imported = await importVaultBackup(to, text, BACKUP_PASSWORD, NEW_PASSWORD);
  assert.equal(imported.isMaster, false);
  const list = imported.listAccounts();
  assert.equal(list.length, 3);
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    assert.equal(list.find((a) => a.scheme === scheme).address, VECTORS[scheme].address);
    assert.deepEqual(imported.exportSecret(list.find((a) => a.scheme === scheme).id), VECTORS[scheme].secret);
  }
});

test('backup: wrong password, tampering, garbage, and existing vault all fail cleanly', async () => {
  const from = memoryStorage();
  const vault = await createVault(from, PASSWORD);
  await vault.addAccount('ecdsa', { secret: VECTORS.ecdsa.secret });
  const text = await vault.exportBackup(BACKUP_PASSWORD);

  await assert.rejects(
    () => importVaultBackup(memoryStorage(), text, WRONG_PASSWORD, NEW_PASSWORD),
    /Invalid password or damaged backup/,
  );
  await assert.rejects(() => importVaultBackup(memoryStorage(), 'not json', BACKUP_PASSWORD, NEW_PASSWORD), /Invalid backup/);
  await assert.rejects(
    () => importVaultBackup(memoryStorage(), '{"format":"other"}', BACKUP_PASSWORD, NEW_PASSWORD),
    /Invalid backup/,
  );
  const blob = JSON.parse(text);
  blob.ciphertext = blob.ciphertext.slice(0, -2) + (blob.ciphertext.endsWith('00') ? '01' : '00');
  await assert.rejects(
    () => importVaultBackup(memoryStorage(), JSON.stringify(blob), BACKUP_PASSWORD, NEW_PASSWORD),
    /Invalid password or damaged backup/,
  );
  const occupied = memoryStorage();
  await createVault(occupied, PASSWORD);
  await assert.rejects(
    () => importVaultBackup(occupied, text, BACKUP_PASSWORD, NEW_PASSWORD),
    /Vault already exists/,
  );
});

// ------------------------------------------------------------------ session

function recoveryFakeRpc({ balances = new Map(), nonces = new Map(), down = false } = {}) {
  return {
    async call(method) {
      if (method === 'eth_chainId') return '0xded3d';
      throw Error(`unexpected call ${method}`);
    },
    async getBalance(address) {
      if (down) throw Error('rpc unreachable');
      return balances.get(address) ?? 0n;
    },
    async getTransactionCount(address) {
      if (down) throw Error('rpc unreachable');
      return nonces.get(address) ?? 0;
    },
    async gasPrice() {
      return 1000000000n;
    },
    async estimateGas() {
      return 50000n;
    },
    async sendRawTransaction() {
      return '0x' + 'ab'.repeat(32);
    },
    async getTransactionReceipt() {
      return { status: '0x1' };
    },
  };
}

function recoverySession(storage, rpc) {
  return createSession({ storage, rpcFactory: () => rpc, sleep: async () => {} });
}

test('session: phrase create makes a master wallet with 3 index-0 accounts', async () => {
  const storage = memoryStorage();
  const session = recoverySession(storage, recoveryFakeRpc());
  const words = session.beginPhraseCreate();
  assert.equal(words.length, 24);
  const state = await session.createFromPhrase(PASSWORD);
  assert.equal(state.status, 'unlocked');
  assert.equal(state.hasPhrase, true);
  assert.equal(state.accounts.length, 3);

  const master = mnemonicToEntropy(words);
  for (const scheme of ['mldsa', 'falcon', 'ecdsa']) {
    const acct = state.accounts.find((a) => a.scheme === scheme);
    assert.equal(acct.index, 0);
    assert.equal(acct.address, deriveAccountAddress(master, scheme, 0), `${scheme} address from phrase`);
  }
  // Neither the phrase nor the master seed hex may sit in storage values.
  for (const [, v] of storage._map) {
    assert.ok(typeof v !== 'string' || !v.includes(words.join(' ')), 'phrase leaked into storage');
    assert.ok(typeof v !== 'string' || !v.includes(toHex(master)), 'master seed leaked into storage');
  }
  master.fill(0);
});

test('session: restore from phrase reproduces the exact addresses of the created wallet', async () => {
  const created = recoverySession(memoryStorage(), recoveryFakeRpc());
  const words = created.beginPhraseCreate();
  const createdState = await created.createFromPhrase(PASSWORD);
  const extra = await created.addAccount('mldsa'); // index 1
  const createdAddresses = created.state.accounts.map((a) => a.address).sort();

  // Restore on a fresh device. The probe sees the index-1 ML-DSA
  // account as used (balance > 0), nothing else.
  const balances = new Map([[extra.address, 1000n]]);
  const restored = recoverySession(memoryStorage(), recoveryFakeRpc({ balances }));
  const { snapshot, probed } = await restored.restoreFromPhrase(words.join(' '), NEW_PASSWORD);
  assert.equal(probed, true);
  assert.equal(snapshot.hasPhrase, true);
  assert.deepEqual(snapshot.accounts.map((a) => a.address).sort(), createdAddresses);
  const mldsaIdx = snapshot.accounts.filter((a) => a.scheme === 'mldsa').map((a) => a.index).sort();
  assert.deepEqual(mldsaIdx, [0, 1]);
});

test('session: restore probes nonce activity too, and caps at index 4', async () => {
  const master = seqBytes(32, 0x40);
  const words = entropyToMnemonic(master);
  const nonces = new Map([[deriveAccountAddress(master, 'ecdsa', 4), 3]]);
  const session = recoverySession(memoryStorage(), recoveryFakeRpc({ nonces }));
  const { snapshot, probed } = await session.restoreFromPhrase(words, NEW_PASSWORD);
  assert.equal(probed, true);
  const ecdsaIdx = snapshot.accounts.filter((a) => a.scheme === 'ecdsa').map((a) => a.index).sort((a, b) => a - b);
  assert.deepEqual(ecdsaIdx, [0, 1, 2, 3, 4], 'indices up to the highest used are materialized');
});

test('session: restore with RPC down restores index-0 only and reports probed=false', async () => {
  const words = entropyToMnemonic(seqBytes(32, 0x40));
  const session = recoverySession(memoryStorage(), recoveryFakeRpc({ down: true }));
  const { snapshot, probed } = await session.restoreFromPhrase(words.join('\n'), NEW_PASSWORD);
  assert.equal(probed, false);
  assert.equal(snapshot.accounts.length, 3);
  assert.ok(snapshot.accounts.every((a) => a.index === 0));
});

test('session: restore rejects a bad phrase and writes no vault', async () => {
  const storage = memoryStorage();
  const session = recoverySession(storage, recoveryFakeRpc());
  const bad = entropyToMnemonic(seqBytes(32, 0x40));
  bad[23] = 'zoo';
  await assert.rejects(() => session.restoreFromPhrase(bad.join(' '), NEW_PASSWORD), /checksum/);
  assert.equal(vaultExists(storage), false);
  await assert.rejects(() => session.restoreFromPhrase('abandon '.repeat(24), NEW_PASSWORD), /checksum/);
  assert.equal(vaultExists(storage), false);
});

test('session: reveal requires the wallet password and returns the original phrase', async () => {
  const session = recoverySession(memoryStorage(), recoveryFakeRpc());
  const words = session.beginPhraseCreate();
  await session.createFromPhrase(PASSWORD);
  await assert.rejects(() => session.revealPhrase(WRONG_PASSWORD), /Invalid password/);
  const revealed = await session.revealPhrase(PASSWORD);
  assert.deepEqual(revealed, words);
});

test('session: legacy wallet has no phrase to reveal', async () => {
  const session = recoverySession(memoryStorage(), recoveryFakeRpc());
  const state = await session.create(PASSWORD, 'mldsa');
  assert.equal(state.hasPhrase, false);
  await assert.rejects(() => session.revealPhrase(PASSWORD), /No recovery phrase/);
});

test('session: backup export/import round trip through the session API', async () => {
  const a = recoverySession(memoryStorage(), recoveryFakeRpc());
  const words = a.beginPhraseCreate();
  const createdState = await a.createFromPhrase(PASSWORD);
  const text = await a.exportBackup(BACKUP_PASSWORD);
  assert.equal(typeof text, 'string');

  const b = recoverySession(memoryStorage(), recoveryFakeRpc());
  const state = await b.importBackup(text, BACKUP_PASSWORD, NEW_PASSWORD);
  assert.equal(state.hasPhrase, true);
  assert.deepEqual(
    state.accounts.map((x) => x.address).sort(),
    createdState.accounts.map((x) => x.address).sort(),
  );
  assert.deepEqual(await b.revealPhrase(NEW_PASSWORD), words);
});
