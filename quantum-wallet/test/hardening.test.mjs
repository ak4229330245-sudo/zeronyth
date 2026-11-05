// Security-hardening tests (v12): escalating unlock backoff with a fake
// clock, the idle auto-lock decision machine, conditional clipboard
// clearing, auto-lock preference handling, and the no-secret-logging
// gate over the whole src/ tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { memoryStorage } from '../src/core/storage.mjs';
import {
  createSession,
  unlockDelaySeconds,
  UNLOCK_FAIL_KEY,
} from '../src/app/session.mjs';
import {
  IdleTracker,
  HIDDEN_LOCK_MS,
  readAutoLockPrefs,
  writeAutoLockPrefs,
  AUTOLOCK_MINUTE_CHOICES,
  DEFAULT_AUTOLOCK_MINUTES,
} from '../src/app/idle.mjs';
import { scheduleClipboardClear, CLIPBOARD_CLEAR_MS } from '../src/app/clipboard.mjs';
import { PASSWORD, WRONG_PASSWORD } from './fixtures.mjs';

function makeSession(storage, now) {
  return createSession({
    storage,
    rpcFactory: () => {
      throw Error('no RPC in hardening tests');
    },
    sleep: async () => {},
    now,
  });
}

// ------------------------------------------------------------- backoff

test('backoff schedule: free below 3 fails, then 5s doubling, capped at 300s', () => {
  assert.equal(unlockDelaySeconds(0), 0);
  assert.equal(unlockDelaySeconds(1), 0);
  assert.equal(unlockDelaySeconds(2), 0);
  assert.equal(unlockDelaySeconds(3), 5);
  assert.equal(unlockDelaySeconds(4), 10);
  assert.equal(unlockDelaySeconds(5), 20);
  assert.equal(unlockDelaySeconds(6), 40);
  assert.equal(unlockDelaySeconds(7), 80);
  assert.equal(unlockDelaySeconds(8), 160);
  assert.equal(unlockDelaySeconds(9), 300);
  assert.equal(unlockDelaySeconds(30), 300);
  assert.equal(unlockDelaySeconds(-1), 0);
});

test('backoff: persisted counter blocks even the CORRECT password until the wait elapses', async () => {
  const storage = memoryStorage();
  let clock = 1_000_000;
  const session = makeSession(storage, () => clock);
  await session.create(PASSWORD, 'ecdsa');
  session.lock();

  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => session.unlock(WRONG_PASSWORD), /Invalid password/);
  }
  const saved = JSON.parse(storage.getItem(UNLOCK_FAIL_KEY));
  assert.equal(saved.count, 3);
  assert.equal(saved.nextAllowedAt, clock + 5000);

  // still inside the window: correct password is NOT even tried
  await assert.rejects(() => session.unlock(PASSWORD), /Too many attempts — wait 5s/);
  clock += 4000;
  await assert.rejects(() => session.unlock(WRONG_PASSWORD), /Too many attempts — wait 1s/);

  // window over: a wrong attempt is allowed through (and escalates)
  clock += 1000;
  await assert.rejects(() => session.unlock(WRONG_PASSWORD), /Invalid password/);
  assert.equal(JSON.parse(storage.getItem(UNLOCK_FAIL_KEY)).count, 4);
  await assert.rejects(() => session.unlock(PASSWORD), /Too many attempts — wait 10s/);

  // after the longer wait the right password opens and clears the counter
  clock += 10000;
  const state = await session.unlock(PASSWORD);
  assert.equal(state.status, 'unlocked');
  assert.equal(storage.getItem(UNLOCK_FAIL_KEY), null);
});

test('backoff: counter lives in storage only and contains no secrets', async () => {
  const storage = memoryStorage();
  const session = makeSession(storage, () => 5_000_000);
  await session.create(PASSWORD, 'ecdsa');
  session.lock();
  await assert.rejects(() => session.unlock(WRONG_PASSWORD), /Invalid password/);
  for (const [, v] of storage._map) {
    assert.ok(!String(v).includes(PASSWORD), 'password never persisted');
  }
  const raw = storage.getItem(UNLOCK_FAIL_KEY);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['count', 'nextAllowedAt']);
});

// ------------------------------------------------------------- idle lock

test('idle tracker: locks at the timeout, activity resets, boundary is inclusive', () => {
  const t = new IdleTracker({ timeoutMs: 300_000, startAt: 0 });
  assert.equal(t.shouldLock(299_999), false);
  assert.equal(t.shouldLock(300_000), true);
  t.activity(250_000);
  assert.equal(t.shouldLock(549_999), false);
  assert.equal(t.shouldLock(550_000), true);
});

test('idle tracker: hidden beyond the hidden threshold locks even if recently active', () => {
  const t = new IdleTracker({ timeoutMs: 300_000, startAt: 0 });
  t.activity(1000);
  t.hidden(2000);
  assert.equal(t.shouldLock(2000 + HIDDEN_LOCK_MS), false);
  assert.equal(t.shouldLock(2000 + HIDDEN_LOCK_MS + 1), true);
  // a fresh tracker validated: constructor rejects non-positive timeouts
  assert.throws(() => new IdleTracker({ timeoutMs: 0 }), /positive/);
});

test('autolock prefs: default on/5min; writes validate against the choices', () => {
  const storage = memoryStorage();
  assert.deepEqual(readAutoLockPrefs(storage), { enabled: true, minutes: DEFAULT_AUTOLOCK_MINUTES });
  writeAutoLockPrefs(storage, { enabled: false, minutes: 15 });
  assert.deepEqual(readAutoLockPrefs(storage), { enabled: false, minutes: 15 });
  // an out-of-choices minutes value is ignored, never persisted
  writeAutoLockPrefs(storage, { enabled: true, minutes: 7 });
  assert.equal(readAutoLockPrefs(storage).minutes, 15);
  for (const m of AUTOLOCK_MINUTE_CHOICES) {
    writeAutoLockPrefs(storage, { enabled: true, minutes: m });
    assert.equal(readAutoLockPrefs(storage).minutes, m);
  }
  // garbage in storage falls back to the default rather than crashing
  storage.setItem('zeronyth.qwallet.autolockMin', 'banana');
  assert.equal(readAutoLockPrefs(storage).minutes, DEFAULT_AUTOLOCK_MINUTES);
});

// ------------------------------------------------------------- clipboard

function fakeTimer() {
  let fn = null;
  let ms = null;
  return {
    impl: (f, delay) => {
      fn = f;
      ms = delay;
      return 'timer-1';
    },
    fire: async () => fn && (await fn()),
    get delay() {
      return ms;
    },
  };
}

test('clipboard: clears after 30s only while the clipboard still holds our text', async () => {
  const timer = fakeTimer();
  let stored = '0xAbC copied address';
  const writes = [];
  const clipboard = {
    writeText: async (t) => {
      writes.push(t);
      stored = t;
    },
    readText: async () => stored,
  };
  scheduleClipboardClear({ clipboard, text: '0xAbC copied address', setTimeoutImpl: timer.impl });
  assert.equal(timer.delay, CLIPBOARD_CLEAR_MS);
  await timer.fire();
  assert.deepEqual(writes, ['']);
  assert.equal(stored, '');
});

test('clipboard: never clobbers something the user copied afterwards', async () => {
  const timer = fakeTimer();
  const writes = [];
  const clipboard = {
    writeText: async (t) => writes.push(t),
    readText: async () => 'something the user copied later',
  };
  scheduleClipboardClear({ clipboard, text: 'our copied text', setTimeoutImpl: timer.impl });
  await timer.fire();
  assert.deepEqual(writes, []);
});

test('clipboard: unreadable clipboard is a silent no-op; missing writeText returns null', async () => {
  const timer = fakeTimer();
  const clipboard = {
    writeText: async () => {
      throw Error('should not be called');
    },
    readText: async () => {
      throw Error('permission prompt denied');
    },
  };
  scheduleClipboardClear({ clipboard, text: 'x', setTimeoutImpl: timer.impl });
  await timer.fire(); // must not throw
  assert.equal(scheduleClipboardClear({ clipboard: { readText: async () => '' }, text: 'x' }), null);
  assert.equal(scheduleClipboardClear({ clipboard: null, text: 'x' }), null);
});

// ------------------------------------------------------------- logging gate

test('no-secret-logging gate: src/ has no console output at all', async () => {
  const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
  const offenders = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.mjs')) {
        const text = await readFile(path, 'utf8');
        text.split('\n').forEach((line, i) => {
          if (/\bconsole\s*\./.test(line)) offenders.push(`${path}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  }
  await walk(srcRoot);
  assert.deepEqual(offenders, [], `console output found in src/:\n${offenders.join('\n')}`);
});
