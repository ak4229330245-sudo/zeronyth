// Idle auto-lock (security hardening, v12).
//
// The wallet locks automatically after a period without genuine user
// interaction, and after the tab has been hidden for over a minute.
// Locking drops the decrypted vault from memory (session.lock()); it
// never touches storage. The decision logic lives in IdleTracker — a
// pure state machine over injected timestamps — so it is unit-testable
// without a DOM; createIdleLockController wires it to real events.

export const AUTOLOCK_ENABLED_KEY = 'zeronyth.qwallet.autolock';
export const AUTOLOCK_MINUTES_KEY = 'zeronyth.qwallet.autolockMin';
export const AUTOLOCK_MINUTE_CHOICES = Object.freeze([1, 5, 15]);
export const DEFAULT_AUTOLOCK_MINUTES = 5;
/** Lock after the tab has been hidden longer than this (fixed). */
export const HIDDEN_LOCK_MS = 60_000;

export class IdleTracker {
  #timeoutMs;
  #hiddenLockMs;
  #lastActivity;
  #hiddenSince = null;

  constructor({ timeoutMs, hiddenLockMs = HIDDEN_LOCK_MS, startAt = 0 } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('timeoutMs must be positive');
    this.#timeoutMs = timeoutMs;
    this.#hiddenLockMs = hiddenLockMs;
    this.#lastActivity = startAt;
  }

  /** Genuine interaction (pointer / key) resets the idle clock. */
  activity(now) {
    this.#lastActivity = now;
  }

  hidden(now) {
    if (this.#hiddenSince == null) this.#hiddenSince = now;
  }

  visible(now) {
    // Becoming visible does not count as activity by itself: the lock
    // decision for the hidden period is taken by shouldLock() before
    // this clears the marker (the controller checks first).
    this.#hiddenSince = null;
    this.#lastActivity = now;
  }

  get hiddenSince() {
    return this.#hiddenSince;
  }

  shouldLock(now) {
    if (this.#hiddenSince != null && now - this.#hiddenSince > this.#hiddenLockMs) return true;
    return now - this.#lastActivity >= this.#timeoutMs;
  }
}

/** Read auto-lock preferences from storage (on by default, 5 minutes). */
export function readAutoLockPrefs(storage) {
  const enabled = storage.getItem(AUTOLOCK_ENABLED_KEY) !== '0';
  const minutes = Number(storage.getItem(AUTOLOCK_MINUTES_KEY));
  return {
    enabled,
    minutes: AUTOLOCK_MINUTE_CHOICES.includes(minutes) ? minutes : DEFAULT_AUTOLOCK_MINUTES,
  };
}

export function writeAutoLockPrefs(storage, { enabled, minutes }) {
  storage.setItem(AUTOLOCK_ENABLED_KEY, enabled ? '1' : '0');
  if (AUTOLOCK_MINUTE_CHOICES.includes(minutes)) {
    storage.setItem(AUTOLOCK_MINUTES_KEY, String(minutes));
  }
}

/**
 * Wire an IdleTracker to DOM events. `target` is the document (or any
 * EventTarget with visibility state via `doc`). Returns { stop() }.
 * The controller polls on an interval rather than arming one timeout
 * per event, so high-frequency pointer movement stays cheap.
 */
export function createIdleLockController({
  doc,
  storage,
  isUnlocked,
  onLock,
  now = () => Date.now(),
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
  pollMs = 1000,
} = {}) {
  const prefs = readAutoLockPrefs(storage);
  const tracker = new IdleTracker({
    timeoutMs: prefs.minutes * 60_000,
    startAt: now(),
  });
  let stopped = false;

  const check = () => {
    if (stopped) return;
    if (!readAutoLockPrefs(storage).enabled) return;
    if (!isUnlocked()) return;
    if (tracker.shouldLock(now())) onLock();
  };
  const timer = setIntervalImpl(check, pollMs);

  const onActivity = () => tracker.activity(now());
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      tracker.hidden(now());
    } else {
      // Check the hidden-duration rule BEFORE visible() clears it.
      check();
      tracker.visible(now());
    }
  };
  doc.addEventListener('pointerdown', onActivity, { passive: true });
  doc.addEventListener('keydown', onActivity);
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    tracker,
    stop() {
      stopped = true;
      clearIntervalImpl(timer);
      doc.removeEventListener('pointerdown', onActivity);
      doc.removeEventListener('keydown', onActivity);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
