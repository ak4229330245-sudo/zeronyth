// BIP39 mnemonic encoding of the wallet master seed.
//
// The master seed is 32 bytes of entropy. It is encoded as a 24-word
// phrase using the STANDARD BIP39 entropy->mnemonic construction:
//   bits = entropy || first (entropyBits/32) bits of SHA-256(entropy)
//   split into 11-bit groups, each indexing the English wordlist.
// Decoding validates wordlist membership, the word count, and the
// checksum, so a mistyped or transposed phrase is rejected instead of
// silently restoring the wrong wallet.
//
// This is an ENCODING ONLY. The BIP39 seed-derivation step (PBKDF2
// with the "mnemonic" salt / optional passphrase) is deliberately NOT
// used: the phrase decodes back to exactly the 32-byte master seed,
// which feeds the wallet's own KDF (see hd.mjs).

import { sha256 } from '@noble/hashes/sha2.js';
import { BIP39_WORDLIST } from './bip39-wordlist.mjs';

const WORD_INDEX = new Map(BIP39_WORDLIST.map((w, i) => [w, i]));

/** Entropy lengths (bytes) BIP39 supports; the wallet uses 32 (24 words). */
export const ENTROPY_LENGTHS = Object.freeze([16, 20, 24, 28, 32]);

function bitsOf(bytes) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits;
}

/**
 * Encode entropy bytes as a BIP39 phrase (array of words).
 * 32 bytes -> 24 words. Throws on an unsupported entropy length.
 */
export function entropyToMnemonic(entropy) {
  if (!(entropy instanceof Uint8Array) || !ENTROPY_LENGTHS.includes(entropy.length)) {
    throw Error(`Entropy must be one of ${ENTROPY_LENGTHS.join('/')} bytes`);
  }
  const checksumBits = entropy.length / 4; // entropyBits / 32
  const digest = sha256(entropy);
  const bits = bitsOf(entropy) + bitsOf(digest).slice(0, checksumBits);
  const words = [];
  for (let i = 0; i < bits.length; i += 11) {
    words.push(BIP39_WORDLIST[parseInt(bits.slice(i, i + 11), 2)]);
  }
  return words;
}

/**
 * Normalize user input (string or word array) to a lowercase word array:
 * trims, lowercases, and splits on any run of whitespace (including
 * full-width spaces common in Japanese IME input).
 */
export function normalizeMnemonic(input) {
  const text = Array.isArray(input) ? input.join(' ') : String(input ?? '');
  return text
    .toLowerCase()
    .split(/[\s\u3000]+/)
    .filter((w) => w.length > 0);
}

/**
 * Decode a phrase back to its entropy bytes, validating the word
 * count, wordlist membership, and the BIP39 checksum.
 * Throws Error('Recovery phrase must have 12, 15, 18, 21 or 24 words'),
 * Error('Unknown word in recovery phrase: <word>'), or
 * Error('Recovery phrase checksum mismatch').
 */
export function mnemonicToEntropy(input) {
  const words = normalizeMnemonic(input);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw Error('Recovery phrase must have 12, 15, 18, 21 or 24 words');
  }
  let bits = '';
  for (const word of words) {
    const idx = WORD_INDEX.get(word);
    if (idx === undefined) throw Error(`Unknown word in recovery phrase: ${word}`);
    bits += idx.toString(2).padStart(11, '0');
  }
  const entropyBits = (bits.length / 33) * 32;
  const checksumBits = bits.length - entropyBits;
  const entropy = new Uint8Array(entropyBits / 8);
  for (let i = 0; i < entropy.length; i++) {
    entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  const expected = bitsOf(sha256(entropy)).slice(0, checksumBits);
  if (bits.slice(entropyBits) !== expected) {
    throw Error('Recovery phrase checksum mismatch');
  }
  return entropy;
}

/** True when the phrase decodes cleanly (count + words + checksum). */
export function isValidMnemonic(input) {
  try {
    mnemonicToEntropy(input);
    return true;
  } catch {
    return false;
  }
}
