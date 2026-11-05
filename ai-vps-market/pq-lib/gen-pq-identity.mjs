// Generic one-shot ML-DSA-65 identity generator. RUN ON THE VPS ONLY: the seed is created
// there and never leaves the host. Refuses to overwrite an existing seed.
// Usage: node gen-pq-identity.mjs <seedPath> <domain> <payloadSpec> <identityOut1> [identityOut2 ...]
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { ml_dsa65, keccak_256 } from "./pq-noble.mjs";

const [seedPath, domain, spec, ...outs] = process.argv.slice(2);
if (!seedPath || !domain || !outs.length) { console.error("usage: gen-pq-identity.mjs <seedPath> <domain> <payloadSpec> <identityOut...>"); process.exit(1); }
if (existsSync(seedPath)) { console.log("seed already exists — aborting"); process.exit(1); }
const seed = randomBytes(32);
const kp = ml_dsa65.keygen(new Uint8Array(seed));
const address = "0x" + Buffer.from(keccak_256(kp.publicKey).slice(12)).toString("hex");
writeFileSync(seedPath, seed.toString("hex") + "\n", { mode: 0o600 });
const identity = { algorithm: "ML-DSA-65", address, public_key_hex: Buffer.from(kp.publicKey).toString("hex"), domain, payload: spec, created: new Date().toISOString() };
for (const out of outs) writeFileSync(out, JSON.stringify(identity, null, 2) + "\n", { mode: 0o644 });
console.log("address:", address);
