// TCP proxy that adds a fixed one-way delay in BOTH directions (emulates the box<->VPS ssh tunnel for validator 4).
// usage: node delay-proxy.mjs <listenPort> <targetPort> <oneWayMs>
import net from 'node:net';
const [lp, tp, ms] = process.argv.slice(2).map(Number);
const pipe = (from, to) => from.on('data', (d) => setTimeout(() => { if (!to.destroyed) to.write(d); }, ms));
net.createServer((c) => {
  const u = net.connect(tp, '127.0.0.1'); c.setNoDelay(true); u.setNoDelay(true);
  pipe(c, u); pipe(u, c);
  const end = () => { c.destroy(); u.destroy(); }; c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end);
}).listen(lp, '127.0.0.1');
