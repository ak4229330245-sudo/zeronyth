// Isolated copy of the public gateway for load tests (same code as the primary's). Backend: the box TEST chain.
import { createGateway } from '../../scripts/replit-gateway.mjs';
createGateway(new URL('../../dashboard', import.meta.url).pathname).listen(Number(process.env.PORT || 11781), '127.0.0.1');
