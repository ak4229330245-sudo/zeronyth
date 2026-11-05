// ZNYT amount parsing / formatting (native coin, 18 decimals).
//
// UI amounts are decimal strings ("1.5"); the chain speaks wei (bigint).
// Parsing is strict: digits with an optional fractional part of at most
// 18 decimals — no signs, exponents, whitespace inside, or bare ".".

export const ZNYT_DECIMALS = 18;
const WEI_PER_ZNYT = 10n ** 18n;
const AMOUNT_RE = /^([0-9]+)(?:\.([0-9]{1,18}))?$/;

/** Decimal ZNYT string -> wei (bigint). Throws Error('Invalid amount'). */
export function parseZnyt(text) {
  if (typeof text !== 'string') throw Error('Invalid amount');
  const m = AMOUNT_RE.exec(text.trim());
  if (!m) throw Error('Invalid amount');
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? '').padEnd(ZNYT_DECIMALS, '0') || '0');
  return whole * WEI_PER_ZNYT + frac;
}

/** Wei (bigint) -> canonical decimal ZNYT string (trailing zeros trimmed). */
export function formatZnyt(wei) {
  const w = typeof wei === 'bigint' ? wei : BigInt(wei);
  if (w < 0n) throw Error('amount cannot be negative');
  const whole = w / WEI_PER_ZNYT;
  const frac = w % WEI_PER_ZNYT;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(ZNYT_DECIMALS, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

/**
 * Generic fixed-decimal amount parsing/formatting (multi-chain v12).
 * parseZnyt/formatZnyt above are the 18-decimal special case; other
 * networks use their native decimals (SOL/SUI 9, BTC 8, APT 8, XRP 6).
 */
export function parseAmount(text, decimals) {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw Error('Invalid decimals');
  }
  if (typeof text !== 'string') throw Error('Invalid amount');
  const re = new RegExp(`^([0-9]+)(?:\\.([0-9]{1,${decimals}}))?$`);
  const m = re.exec(text.trim());
  if (!m) throw Error('Invalid amount');
  const scale = 10n ** BigInt(decimals);
  const frac = BigInt((m[2] ?? '').padEnd(decimals, '0') || '0');
  return BigInt(m[1]) * scale + frac;
}

export function formatAmount(value, decimals) {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw Error('Invalid decimals');
  }
  const w = typeof value === 'bigint' ? value : BigInt(value);
  if (w < 0n) throw Error('amount cannot be negative');
  const scale = 10n ** BigInt(decimals);
  const whole = w / scale;
  const frac = w % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

/** Address shape check ("0x" + 40 hex chars). */
export function isAddress(text) {
  return typeof text === 'string' && /^0x[0-9a-fA-F]{40}$/.test(text);
}

/** "0x"-hex data shape check (empty "0x" allowed). */
export function isHexData(text) {
  return typeof text === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(text);
}
