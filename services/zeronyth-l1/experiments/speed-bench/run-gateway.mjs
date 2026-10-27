// Runs the production gateway code (scripts/replit-gateway.mjs) in front of the BENCH chain only.
// env: ZERONYTH_RPC_PORT=<bench rpc>, GW_PORT=<listen>. ZERONYTH_RPC_TX_PER_MIN is raised by the caller for the
// throughput test only (production keeps its per-IP limit).
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createGateway } from '../../scripts/replit-gateway.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
createGateway(path.join(here, '../../dashboard')).listen(Number(process.env.GW_PORT), '127.0.0.1');
