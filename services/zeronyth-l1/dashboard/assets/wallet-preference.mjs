// A provider hint is not authenticated identity. Never persist addresses or permissions.
export const WALLET_PREFERENCE_KEY = 'zeronyth.wallet-preference.v1';
const validKey = key => typeof key === 'string' && key.length <= 180 &&
  (/^legacy:(metamask|rabby)$/.test(key) || /^rdns:[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(key));

export function walletIdentity(provider, info) {
  const rdns = typeof info?.rdns === 'string' ? info.rdns.toLowerCase() : '';
  if (validKey(`rdns:${rdns}`)) return `rdns:${rdns}`;
  return provider?.isRabby ? 'legacy:rabby' : provider?.isMetaMask ? 'legacy:metamask' : null;
}
export function readWalletPreference(storage) {
  try {
    const raw = storage()?.getItem(WALLET_PREFERENCE_KEY);
    if (!raw || raw.length > 256) return null;
    const value = JSON.parse(raw);
    return value?.version === 1 && validKey(value.key) ? { version: 1, key: value.key } : null;
  } catch { return null; }
}
export function saveWalletPreference(storage, entry) {
  if (!validKey(entry?.restoreKey)) return false;
  try {
    storage().setItem(WALLET_PREFERENCE_KEY, JSON.stringify({ version: 1, key: entry.restoreKey }));
    return true;
  } catch { return false; }
}
export function forgetWalletPreference(storage) {
  try { storage()?.removeItem(WALLET_PREFERENCE_KEY); } catch { /* storage can be blocked */ }
}
export function savedWalletCandidate(entries, preference) {
  if (!validKey(preference?.key)) return null;
  const candidates = entries.filter(entry => entry.restoreKey === preference.key);
  // Never guess between wallets claiming the same identifier.
  return candidates.length === 1 ? candidates[0] : null;
}
