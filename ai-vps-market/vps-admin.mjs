// ZERONYTH VPS market operator tool — PQ-signed admin actions (ML-DSA-65).
// Reads the operator seed from net/secrets/vps-admin-mldsa.seed (never printed) and signs
// UTF8("ZERONYTH/VPS-ADMIN/V1" + "\n" + JSON.stringify({action, id, access, ts})) exactly as
// the site gateway verifies it. Usage:
//   node vps-admin.mjs fulfill <leaseId> <accessText>
//   node vps-admin.mjs cancel <leaseId>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { ml_dsa65 } = await import(new URL("../../pq-lib/pq-noble.mjs", import.meta.url));
const SEED_PATH = fileURLToPath(new URL("../secrets/vps-admin-mldsa.seed", import.meta.url));
const GATEWAY = "http://127.0.0.1:22781";
const DOMAIN = "ZERONYTH/VPS-ADMIN/V1";

const [action, id, accessText] = process.argv.slice(2);
if ((action !== "fulfill" && action !== "cancel") || !id || (action === "fulfill" && accessText === undefined)) {
  console.error('usage: vps-admin.mjs fulfill <id> <accessText> | cancel <id>');
  process.exit(1);
}
const seed = new Uint8Array(Buffer.from(readFileSync(SEED_PATH, "utf8").trim(), "hex"));
if (seed.length !== 32) { console.error("bad operator seed"); process.exit(1); }
const kp = ml_dsa65.keygen(seed);
const access = action === "fulfill" ? accessText : null;
const ts = Math.floor(Date.now() / 1000);
const payload = new TextEncoder().encode(DOMAIN + "\n" + JSON.stringify({ action, id, access, ts }));
const signature = Buffer.from(ml_dsa65.sign(payload, kp.secretKey)).toString("hex");
const body = action === "fulfill" ? { id, access, ts, signature } : { id, ts, signature };
const r = await fetch(`${GATEWAY}/api/vps/admin/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
console.log(r.status, await r.text());
