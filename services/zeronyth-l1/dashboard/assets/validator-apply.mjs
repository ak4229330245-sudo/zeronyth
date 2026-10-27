// Validator application builder: runs fully in the browser, sends nothing. Derives the validator (QBFT signer) address
// from the enode public key: address = keccak256(pubkey64)[12:]. The operator verifies the same derivation and the live
// connection with launch/validator/review-application.mjs before any vote.
import { keccak_256 } from './vendor-noble.mjs';
const $ = (id) => document.getElementById(id);
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const ENODE = /^enode:\/\/([0-9a-fA-F]{128})@([A-Za-z0-9.\-]{1,253}|\[[0-9a-fA-F:]+\]):(\d{1,5})(\?discport=\d{1,5})?$/;
function derive(enode) {
  const m = ENODE.exec(enode.trim()); if (!m || Number(m[3]) < 1 || Number(m[3]) > 65535) return null;
  const pub = Uint8Array.from(m[1].match(/../g), (h) => parseInt(h, 16));
  const a = hex(keccak_256(pub).slice(12)); const h = hex(keccak_256(new TextEncoder().encode(a)));
  return { pubkey: m[1].toLowerCase(), host: m[2], port: Number(m[3]), address: '0x' + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('') };
}
$('vaEnode').addEventListener('input', () => { const d = derive($('vaEnode').value); $('vaAddr').value = d ? d.address : ''; });
$('vaForm').addEventListener('submit', (ev) => {
  ev.preventDefault(); const msg = $('vaMsg'); msg.className = 'j-err';
  const d = derive($('vaEnode').value), name = $('vaName').value.trim(), contact = $('vaContact').value.trim();
  if (!name || !contact) { msg.textContent = 'お名前と連絡先を入力してください / Name and contact are required'; return; }
  if (!d) { msg.textContent = 'enode の形式が正しくありません（enode://128桁の16進@ホスト:ポート） / Invalid enode'; return; }
  if (/^(127\.|10\.|192\.168\.|localhost)/.test(d.host)) { msg.textContent = 'enode のホストは外部から届くアドレスにしてください / Use a publicly reachable host'; return; }
  if (!['vaC1', 'vaC2', 'vaC3'].every((id) => $(id).checked)) { msg.textContent = '3 つの確認にチェックしてください / Please accept all three'; return; }
  const app = { kind: 'zeronyth-validator-application', version: 1, chainId: 9127, createdAt: new Date().toISOString(), name, contact,
    enode: $('vaEnode').value.trim(), validatorAddress: d.address, host: $('vaHost').value, spec: $('vaSpec').value.trim(), region: $('vaRegion').value.trim(),
    commitments: { uptime247: true, oneValidatorPerOperator: true, keepNodeKeyPrivate: true } };
  const json = JSON.stringify(app, null, 2); $('vaOut').textContent = json; $('vaOut').hidden = false;
  const dl = $('vaDl'); dl.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); dl.hidden = false;
  msg.className = 'j-ok'; msg.textContent = `申請データができました。アドレス ${d.address}。ダウンロードして公式の連絡先に送ってください。`;
});
