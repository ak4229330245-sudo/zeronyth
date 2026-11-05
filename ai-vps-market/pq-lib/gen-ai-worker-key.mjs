// One-shot generator for the AI worker ML-DSA-65 identity. RUN ON THE VPS ONLY: the seed is
// created there and never leaves the host. Refuses to overwrite an existing seed.
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { ml_dsa65, keccak_256 } from "./pq-noble.mjs";

const SEED = "/home/solbot/zeronyth-falcon-912701/net/secrets/ai-worker-mldsa.seed";
const PUB = "/home/solbot/zeronyth-falcon-912701/site/ai-worker-identity.json";
if (existsSync(SEED)) { console.log("seed already exists — aborting"); process.exit(1); }
const seed = randomBytes(32);
const kp = ml_dsa65.keygen(new Uint8Array(seed));
const address = "0x" + Buffer.from(keccak_256(kp.publicKey).slice(12)).toString("hex");
writeFileSync(SEED, seed.toString("hex") + "\n", { mode: 0o600 });
writeFileSync(PUB, JSON.stringify({ algorithm: "ML-DSA-65", address, public_key_hex: Buffer.from(kp.publicKey).toString("hex"), domain: "ZERONYTH/AI-WORKER/ATTEST/V1", created: new Date().toISOString() }, null, 2) + "\n", { mode: 0o644 });
console.log("worker address:", address);
