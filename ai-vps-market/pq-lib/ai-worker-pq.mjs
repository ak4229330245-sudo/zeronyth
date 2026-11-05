// ZERONYTH AI worker post-quantum attestation (ML-DSA-65, FIPS 204) — shared by the ai-chat
// worker (signs) and the site gateway (verifies). Crypto: @noble/post-quantum via ./pq-noble.mjs
// (the same bundle proven against chain 912701 in the PQ wallet E2E).
// Payload spec (public): UTF8("ZERONYTH/AI-WORKER/ATTEST/V1" + "\n" +
//   JSON.stringify({ v: 1, id, model, q, a, ts }))
//   q = keccak256(JSON.stringify(messages)) hex — the conversation the client sent
//   a = keccak256(answer) hex                 — the exact answer text streamed
// The worker address is chain-style: keccak256(publicKey)[12:].
import { readFileSync } from "node:fs";
import { ml_dsa65, keccak_256 } from "./pq-noble.mjs";

export const ATTEST_DOMAIN = "ZERONYTH/AI-WORKER/ATTEST/V1";
const enc = new TextEncoder();
export const hex = (u8) => Buffer.from(u8).toString("hex");
export const keccakHex = (s) => hex(keccak_256(enc.encode(s)));
export const workerAddress = (pub) => "0x" + hex(keccak_256(pub).slice(12));

export function payloadBytes(f) {
  return enc.encode(ATTEST_DOMAIN + "\n" + JSON.stringify({ v: 1, id: f.id, model: f.model, q: f.q, a: f.a, ts: f.ts }));
}

export function makeAttestation(secretKey, publicKey, { id, model, messages, answer }) {
  const f = { id, model, q: keccakHex(JSON.stringify(messages)), a: keccakHex(answer), ts: new Date().toISOString() };
  return { type: "attestation", alg: "ML-DSA-65", worker: workerAddress(publicKey), ...f, signature: hex(ml_dsa65.sign(payloadBytes(f), secretKey)) };
}

export function verifyAttestation(att, publicKey) {
  try {
    if (!att || att.alg !== "ML-DSA-65" || att.worker !== workerAddress(publicKey)) return false;
    const sig = Buffer.from(att.signature || "", "hex");
    if (sig.length !== 3309) return false;
    return ml_dsa65.verify(sig, payloadBytes(att), publicKey) === true;
  } catch { return false; }
}

export function loadSeed(path) {
  const b = Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  if (b.length !== 32) throw new Error("bad worker seed");
  return new Uint8Array(b);
}
export const keysFromSeed = (seed) => ml_dsa65.keygen(seed);
