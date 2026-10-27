import Database from 'better-sqlite3';
export function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL'); db.pragma('cache_size = -16000'); db.pragma('busy_timeout = 3000');
  db.exec(`
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS blocks(n INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, parent TEXT, ts INTEGER, miner TEXT, gas_used INTEGER, gas_limit INTEGER, tx_count INTEGER, size INTEGER);
  CREATE INDEX IF NOT EXISTS blocks_miner ON blocks(miner, n);
  CREATE INDEX IF NOT EXISTS blocks_txc ON blocks(n) WHERE tx_count > 0;
  CREATE TABLE IF NOT EXISTS txs(hash TEXT PRIMARY KEY, block INTEGER, idx INTEGER, ts INTEGER, from_a TEXT, to_a TEXT, value TEXT, gas INTEGER,
    gas_price TEXT, gas_used INTEGER, status INTEGER, nonce INTEGER, type INTEGER, input TEXT, created TEXT, nlogs INTEGER);
  CREATE UNIQUE INDEX IF NOT EXISTS txs_pos ON txs(block, idx);
  CREATE TABLE IF NOT EXISTS addr_txs(addr TEXT, block INTEGER, idx INTEGER, hash TEXT, PRIMARY KEY(addr, block, idx)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS logs(block INTEGER, li INTEGER, tx TEXT, address TEXT, t0 TEXT, t1 TEXT, t2 TEXT, t3 TEXT, data TEXT, PRIMARY KEY(block, li)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS logs_tx ON logs(tx);
  CREATE INDEX IF NOT EXISTS logs_addr ON logs(address, block);
  CREATE TABLE IF NOT EXISTS transfers(block INTEGER, li INTEGER, tx TEXT, token TEXT, from_a TEXT, to_a TEXT, value TEXT, ts INTEGER, PRIMARY KEY(block, li)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS tr_token ON transfers(token, block);
  CREATE INDEX IF NOT EXISTS tr_from ON transfers(from_a, block);
  CREATE INDEX IF NOT EXISTS tr_to ON transfers(to_a, block);
  CREATE INDEX IF NOT EXISTS tr_tx ON transfers(tx);
  CREATE TABLE IF NOT EXISTS tokens(address TEXT PRIMARY KEY, name TEXT, symbol TEXT, decimals INTEGER, first_block INTEGER, meta_ok INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS balances(token TEXT, holder TEXT, value TEXT, approx REAL, PRIMARY KEY(token, holder)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS bal_holder ON balances(holder);
  CREATE INDEX IF NOT EXISTS bal_rank ON balances(token, approx DESC);
  CREATE TABLE IF NOT EXISTS contracts(address TEXT PRIMARY KEY, creator TEXT, tx TEXT, block INTEGER);
  `);
  return db;
}
