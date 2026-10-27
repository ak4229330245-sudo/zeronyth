// Cross-check indexed ERC-20 balances against balanceOf() on the node (usage: node test/verify-balances.mjs [api] [rpc])
const API = process.argv[2] || 'http://127.0.0.1:9815', RPC = process.argv[3] || 'http://127.0.0.1:9545';
const call = async (to, data) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json()).result;
const { tokens } = await (await fetch(API + '/api/tokens')).json();
let bad = 0, n = 0;
for (const tk of tokens) {
  const { holders } = await (await fetch(`${API}/api/token/${tk.address}/holders?size=100`)).json();
  for (const hd of holders) { n++; const v = BigInt(await call(tk.address, '0x70a08231' + hd.address.slice(2).toLowerCase().padStart(64, '0'))); if (v.toString() !== hd.value) { bad++; console.log('MISMATCH', tk.symbol, hd.address, hd.value, v.toString()); } }
}
console.log(`checked ${n} holder balances across ${tokens.length} tokens, mismatches: ${bad}`);
process.exit(bad ? 1 : 0);
