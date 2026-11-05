// One-shot generator for the VPS market treasury ML-DSA-65 account. RUN ON THE VPS ONLY.
// The seed never leaves the host; the market only receives payments (spending is operator work).
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { ml_dsa65, keccak_256 } from "./pq-noble.mjs";

const SEED = "/home/solbot/zeronyth-falcon-912701/net/secrets/vps-treasury-mldsa.seed";
const PUB = "/home/solbot/zeronyth-falcon-912701/site/vps-treasury.json";
if (existsSync(SEED)) { console.log("seed already exists — aborting"); process.exit(1); }
const seed = randomBytes(32);
const kp = ml_dsa65.keygen(new Uint8Array(seed));
const address = "0x" + Buffer.from(keccak_256(kp.publicKey).slice(12)).toString("hex");
writeFileSync(SEED, seed.toString("hex") + "\n", { mode: 0o600 });
writeFileSync(PUB, JSON.stringify({ algorithm: "ML-DSA-65", address, public_key_hex: Buffer.from(kp.publicKey).toString("hex"), purpose: "ZERONYTH VPS market payment treasury (receive-only)", created: new Date().toISOString() }, null, 2) + "\n", { mode: 0o644 });
console.log("treasury address:", address);
