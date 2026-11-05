// Clipboard hygiene (security hardening, v12).
//
// Addresses copied from the wallet are cleared from the clipboard after
// 30 s — but ONLY if the clipboard still holds exactly what we put
// there (never clobber something the user copied afterwards). Secrets
// are never placed on the clipboard by any flow: the recovery phrase
// has no copy path at all, and the encrypted backup text is copied only
// when the user explicitly taps "copy" on the export they initiated
// (that copy is user data they asked for, and it is ciphertext).

export const CLIPBOARD_CLEAR_MS = 30_000;

/**
 * Schedule a conditional clipboard clear. Returns the timer handle.
 * All clipboard access is best-effort: read failures (permission
 * prompts, unsupported browsers) simply skip the clear.
 */
export function scheduleClipboardClear({
  clipboard,
  text,
  delayMs = CLIPBOARD_CLEAR_MS,
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  if (!clipboard || typeof clipboard.writeText !== 'function') return null;
  return setTimeoutImpl(async () => {
    try {
      if (typeof clipboard.readText !== 'function') return;
      const current = await clipboard.readText();
      if (current === text) await clipboard.writeText('');
    } catch {
      /* clipboard unreadable — leave it alone */
    }
  }, delayMs);
}
