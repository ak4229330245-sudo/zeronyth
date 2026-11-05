// ZERONYTH VPS paid-order Discord notifier.
// Uses the existing zeronyth-discord bot token (read locally from .env; never printed).
// Commands:
//   setup-channel  -> create (or reuse) the private #vps-orders channel, save its id, post a hello message
//   send "<text>"  -> post text to the saved channel
// `send` attaches an ML-DSA-65 attestation (attestation.json) signed by the dedicated notifier
// key (seed: ./notify-mldsa.seed, 0600, on-host only; public identity published at
// https://zeronyth.dpdns.org/discord-notify-identity.json). Payload:
//   UTF8("ZERONYTH/DISCORD-NOTIFY/V1" + "\n" + JSON.stringify({content, ts}))
// If the seed or the PQ bundle is unavailable — or the signed send fails — it falls back to the
// plain unsigned post: notifications must never break.
import fs from 'node:fs';

const DIR = new URL('.', import.meta.url).pathname;
const env = fs.readFileSync(DIR + '.env', 'utf8');
const token = (env.match(/DISCORD_TOKEN=(.+)/) || [])[1]?.trim();
if (!token) { console.error('DISCORD_TOKEN not found'); process.exit(1); }

const API = 'https://discord.com/api/v10';
const H = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
const CFG = DIR + 'data/vps-notify.json';
const KNOWN_GUILD = '1564628118466207915';
const CHANNEL_NAME = 'vps-orders';
const NOTIFY_DOMAIN = 'ZERONYTH/DISCORD-NOTIFY/V1';

let pq = null;
try {
  if (fs.existsSync(DIR + 'notify-mldsa.seed')) {
    const m = await import(new URL('../zeronyth-falcon-912701/pq-lib/pq-noble.mjs', import.meta.url));
    const seed = new Uint8Array(Buffer.from(fs.readFileSync(DIR + 'notify-mldsa.seed', 'utf8').trim(), 'hex'));
    if (seed.length === 32) {
      const kp = m.ml_dsa65.keygen(seed);
      pq = { ml_dsa65: m.ml_dsa65, kp, signer: '0x' + Buffer.from(m.keccak_256(kp.publicKey).slice(12)).toString('hex') };
    }
  }
} catch { pq = null; }

async function api(path, opts = {}) {
  const r = await fetch(API + path, { headers: H, ...opts });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${r.status}: ${typeof j === 'object' ? (j.message || t) : t}`);
  return j;
}

const cmd = process.argv[2];

if (cmd === 'setup-channel') {
  const me = await api('/users/@me');
  const guilds = await api('/users/@me/guilds');
  const guild = guilds.find((g) => g.id === KNOWN_GUILD) || guilds[0];
  if (!guild) { console.error('bot is in no guild'); process.exit(1); }
  const channels = await api(`/guilds/${guild.id}/channels`);
  let ch = channels.find((c) => c.type === 0 && c.name === CHANNEL_NAME);
  let created = false;
  if (!ch) {
    ch = await api(`/guilds/${guild.id}/channels`, {
      method: 'POST',
      body: JSON.stringify({
        name: CHANNEL_NAME,
        type: 0,
        topic: 'ZERONYTH AI VPS 着金通知（運営専用）',
        permission_overwrites: [
          { id: guild.id, type: 0, deny: '1024' },          // @everyone: cannot view (private / locked)
          { id: me.id, type: 1, allow: '3072' },            // the bot: view + send
        ],
      }),
    });
    created = true;
  }
  fs.writeFileSync(CFG, JSON.stringify({ guild_id: guild.id, channel_id: ch.id, name: CHANNEL_NAME }, null, 2));
  const m = await api(`/channels/${ch.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content: '🔔 ZERONYTH AI VPS の着金通知チャンネルを開設しました。新しい注文の支払いが確認されるたびに、ここへ自動で通知します。' }),
  });
  console.log(JSON.stringify({ ok: true, guild: guild.name, channel_id: ch.id, created, hello_message_id: m.id }));
} else if (cmd === 'send') {
  const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  const content = process.argv[3];
  if (!content) { console.error('usage: send "<text>"'); process.exit(1); }
  if (pq) {
    try {
      const ts = Math.floor(Date.now() / 1000);
      const payload = new TextEncoder().encode(NOTIFY_DOMAIN + '\n' + JSON.stringify({ content, ts }));
      const att = { v: 1, alg: 'ML-DSA-65', signer: pq.signer, content, ts, signature: Buffer.from(pq.ml_dsa65.sign(payload, pq.kp.secretKey)).toString('hex') };
      const fd = new FormData();
      fd.set('payload_json', JSON.stringify({ content }));
      fd.append('files[0]', new Blob([JSON.stringify(att, null, 2)], { type: 'application/json' }), 'attestation.json');
      const r = await fetch(`${API}/channels/${cfg.channel_id}/messages`, { method: 'POST', headers: { Authorization: `Bot ${token}` }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`signed send -> ${r.status}: ${j.message || 'unknown error'}`);
      console.log(JSON.stringify({ ok: true, message_id: j.id }));
      process.exit(0);
    } catch (e) { console.error('signed send failed, falling back to unsigned:', e.message); }
  }
  const m = await api(`/channels/${cfg.channel_id}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
  console.log(JSON.stringify({ ok: true, message_id: m.id }));
} else {
  console.error('usage: notify-vps.mjs setup-channel | send "<text>"');
  process.exit(1);
}
