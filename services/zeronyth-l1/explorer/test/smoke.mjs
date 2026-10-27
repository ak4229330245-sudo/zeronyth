// Smoke test against a running explorer (usage: node test/smoke.mjs [base])
const B = process.argv[2] || 'http://127.0.0.1:9815';
const TX = '0xae71b3c741ea3251f356a85373ff3802bae04ba96b48165639182f82ff0876e0', ADDR = '0x365a14dbd81fa56d8bd805c0e99625c6e18ec744', ZUSDC = '0x9F14EE55af5C72a4393f66BA16456926fb8eb475';
const j = async (p) => { const r = await fetch(B + p); if (!r.ok) throw new Error(`${p} -> ${r.status}`); return r.json(); };
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const s = await j('/api/stats'); ok(s.chainId === 9127 && s.lag < 10, `stats head ${s.head} indexed ${s.indexed}`);
const t = await j(`/api/tx/${TX}`); ok(t.status === 1 && t.decoded?.method === 'setPrice' && t.logs[0]?.decoded?.event === 'PriceSet', 'VPS price tx decoded');
const a = await j(`/api/address/${ADDR}`); ok(BigInt(a.balance) > 0n && a.txCount >= 1, `user address balance ${a.balance} txs ${a.txCount}`);
const h = await j(`/api/token/${ZUSDC}/holders`); ok(h.total > 0 && h.holders.length > 0, `zUSDC holders ${h.total}`);
const q = await j('/api/search?q=zUSDC'); ok(q.type === 'token', 'search zUSDC -> token');
for (const p of [`/tx/${TX}`, `/address/${ADDR}`, '/block/1', `/token/${ZUSDC}`, '/']) { const r = await fetch(B + p); ok(r.status === 200 && (r.headers.get('content-type') || '').includes('text/html'), `page ${p}`); }
