// Block indexer: backfills from genesis and follows the head. QBFT has immediate finality, but the parent-hash
// chain is still checked; on a mismatch the last blocks are dropped and re-indexed (token balances rebuilt).
const T_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const T_DEPOSIT = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c'; // WETH-style Deposit(address,uint256)
const T_WITHDRAWAL = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';
const ZERO = '0x0000000000000000000000000000000000000000';
const hex = (n) => '0x' + n.toString(16);
const num = (h) => (h == null ? null : Number(BigInt(h)));
const topicAddr = (t) => '0x' + t.slice(26).toLowerCase();
const approx = (v) => Number(v) || 0;

export function makeIndexer({ db, rpc, known, erc20, log = console }) {
  const st = {
    getMeta: db.prepare('SELECT v FROM meta WHERE k=?'), setMeta: db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v'),
    hashAt: db.prepare('SELECT hash FROM blocks WHERE n=?'),
    block: db.prepare('INSERT OR REPLACE INTO blocks(n,hash,parent,ts,miner,gas_used,gas_limit,tx_count,size) VALUES(?,?,?,?,?,?,?,?,?)'),
    tx: db.prepare('INSERT OR REPLACE INTO txs(hash,block,idx,ts,from_a,to_a,value,gas,gas_price,gas_used,status,nonce,type,input,created,nlogs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    atx: db.prepare('INSERT OR IGNORE INTO addr_txs(addr,block,idx,hash) VALUES(?,?,?,?)'),
    log: db.prepare('INSERT OR REPLACE INTO logs(block,li,tx,address,t0,t1,t2,t3,data) VALUES(?,?,?,?,?,?,?,?,?)'),
    tr: db.prepare('INSERT OR REPLACE INTO transfers(block,li,tx,token,from_a,to_a,value,ts) VALUES(?,?,?,?,?,?,?,?)'),
    tokenNew: db.prepare('INSERT OR IGNORE INTO tokens(address,first_block) VALUES(?,?)'),
    balGet: db.prepare('SELECT value FROM balances WHERE token=? AND holder=?'),
    balSet: db.prepare('INSERT INTO balances(token,holder,value,approx) VALUES(?,?,?,?) ON CONFLICT(token,holder) DO UPDATE SET value=excluded.value, approx=excluded.approx'),
    balDel: db.prepare('DELETE FROM balances WHERE token=? AND holder=?'),
    contract: db.prepare('INSERT OR IGNORE INTO contracts(address,creator,tx,block) VALUES(?,?,?,?)'),
  };
  const meta = (k) => st.getMeta.get(k)?.v;
  const state = { next: Number(meta('next') || 0), head: 0, lastError: null, startedAt: Date.now(), backfillDoneAt: meta('backfillDoneAt') || null, rewinds: Number(meta('rewinds') || 0) };

  function addBal(token, holder, delta) {
    if (holder === ZERO) return;
    const cur = BigInt(st.balGet.get(token, holder)?.value || '0') + delta;
    if (cur === 0n) st.balDel.run(token, holder); else st.balSet.run(token, holder, cur.toString(), approx(cur));
  }
  function transfer(b, li, tx, token, from, to, value, ts) {
    st.tokenNew.run(token, b);
    st.tr.run(b, li, tx, token, from, to, value.toString(), ts);
    addBal(token, from, -value); addBal(token, to, value);
  }

  const write = db.transaction((blocks, receiptsByHash) => {
    for (const b of blocks) {
      const n = num(b.number), ts = num(b.timestamp);
      st.block.run(n, b.hash, b.parentHash, ts, b.miner?.toLowerCase(), num(b.gasUsed), num(b.gasLimit), b.transactions.length, num(b.size));
      const rcpts = receiptsByHash.get(b.hash) || [];
      const rByTx = new Map(rcpts.map((r) => [r.transactionHash, r]));
      for (const t of b.transactions) {
        const r = rByTx.get(t.hash) || {};
        const idx = num(t.transactionIndex), from = t.from.toLowerCase(), to = t.to?.toLowerCase() || null, created = r.contractAddress?.toLowerCase() || null;
        st.tx.run(t.hash, n, idx, ts, from, to, BigInt(t.value).toString(), num(t.gas), BigInt(r.effectiveGasPrice || t.gasPrice || 0).toString(),
          num(r.gasUsed), r.status == null ? null : num(r.status), num(t.nonce), num(t.type || '0x0'), t.input, created, (r.logs || []).length);
        for (const a of new Set([from, to, created].filter(Boolean))) st.atx.run(a, n, idx, t.hash);
        if (created) st.contract.run(created, from, t.hash, n);
        for (const l of r.logs || []) {
          const li = num(l.logIndex), addr = l.address.toLowerCase(), tp = l.topics;
          st.log.run(n, li, t.hash, addr, tp[0] || null, tp[1] || null, tp[2] || null, tp[3] || null, l.data);
          if (tp[0] === T_TRANSFER && tp.length === 3 && l.data.length === 66) {
            const f = topicAddr(tp[1]), to2 = topicAddr(tp[2]);
            transfer(n, li, t.hash, addr, f, to2, BigInt(l.data), ts);
            for (const a of [f, to2]) if (a !== ZERO) st.atx.run(a, n, idx, t.hash);
          } else if ((tp[0] === T_DEPOSIT || tp[0] === T_WITHDRAWAL) && tp.length === 2 && addr === known().wznyt && l.data.length === 66) {
            const who = topicAddr(tp[1]), v = BigInt(l.data);
            if (tp[0] === T_DEPOSIT) transfer(n, li, t.hash, addr, ZERO, who, v, ts); else transfer(n, li, t.hash, addr, who, ZERO, v, ts);
          }
        }
      }
      state.next = n + 1;
    }
    st.setMeta.run('next', String(state.next));
  });

  async function fetchMeta() {
    const rows = db.prepare('SELECT address FROM tokens WHERE meta_ok=0 LIMIT 20').all();
    for (const { address } of rows) {
      const call = (f) => rpc('eth_call', [{ to: address, data: erc20.encodeFunctionData(f) }, 'latest']).then((d) => erc20.decodeFunctionResult(f, d)[0]).catch(() => null);
      const [name, symbol, decimals] = [await call('name'), await call('symbol'), await call('decimals')];
      db.prepare('UPDATE tokens SET name=?, symbol=?, decimals=?, meta_ok=1 WHERE address=?')
        .run(name == null ? null : String(name).slice(0, 64), symbol == null ? null : String(symbol).slice(0, 24), decimals == null ? 18 : Number(decimals), address);
    }
  }

  function rewind(to) {
    log.warn?.(`[explorer] parent-hash mismatch: rewinding to block ${to}`);
    db.transaction(() => {
      for (const t of ['blocks WHERE n', 'txs WHERE block', 'addr_txs WHERE block', 'logs WHERE block', 'transfers WHERE block', 'contracts WHERE block']) db.prepare(`DELETE FROM ${t} >= ?`).run(to);
      db.prepare('DELETE FROM balances').run();
      const sum = new Map();
      for (const r of db.prepare('SELECT token, from_a, to_a, value FROM transfers').iterate()) {
        const v = BigInt(r.value);
        for (const [h, d] of [[r.from_a, -v], [r.to_a, v]]) if (h !== ZERO) { const k = r.token + '|' + h; sum.set(k, (sum.get(k) || 0n) + d); }
      }
      for (const [k, v] of sum) if (v !== 0n) { const [tk, h] = k.split('|'); st.balSet.run(tk, h, v.toString(), approx(v)); }
      state.next = to; state.rewinds++; st.setMeta.run('next', String(to)); st.setMeta.run('rewinds', String(state.rewinds));
    })();
  }

  async function step(batch) {
    state.head = num(await rpc('eth_blockNumber'));
    if (state.next > state.head) return 0;
    const to = Math.min(state.head, state.next + batch - 1);
    const nums = []; for (let n = state.next; n <= to; n++) nums.push(n);
    const blocks = await rpc.batch(nums.map((n) => ['eth_getBlockByNumber', [hex(n), true]]));
    if (blocks.some((b) => !b)) return 0;
    // continuity: first block vs stored parent, then within the batch
    if (state.next > 0) { const prev = st.hashAt.get(state.next - 1)?.hash; if (prev && prev !== blocks[0].parentHash) { rewind(Math.max(0, state.next - 12)); return 0; } }
    for (let i = 1; i < blocks.length; i++) if (blocks[i].parentHash !== blocks[i - 1].hash) return 0;
    const withTx = blocks.filter((b) => b.transactions.length);
    const rc = await rpc.batch(withTx.map((b) => ['eth_getBlockReceipts', [b.hash]]));
    const receiptsByHash = new Map(withTx.map((b, i) => [b.hash, rc[i] || []]));
    write(blocks, receiptsByHash);
    if (withTx.length) await fetchMeta();
    if (!state.backfillDoneAt && state.next > state.head) { state.backfillDoneAt = new Date().toISOString(); st.setMeta.run('backfillDoneAt', state.backfillDoneAt); }
    return blocks.length;
  }

  async function run({ batch = 50, idleMs = 1000, backfillPauseMs = 25 } = {}) {
    for (;;) {
      try {
        const n = await step(batch);
        state.lastError = null;
        await new Promise((r) => setTimeout(r, n === 0 ? idleMs : n < batch ? 300 : backfillPauseMs));
      } catch (e) {
        state.lastError = String(e?.message || e).slice(0, 200);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  return { run, state, fetchMeta };
}
