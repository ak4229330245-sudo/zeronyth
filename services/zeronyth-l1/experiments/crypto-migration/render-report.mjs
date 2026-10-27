/** Generate a self-contained, secret-free report. Never reads private backup files. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../../../generated-artifacts/crypto-migration');
const json = async file => JSON.parse(await readFile(path.join(out, file), 'utf8'));
const [bench, backup, live, tests, backupTests, markdown] = await Promise.all([
  json('benchmark.json'), json('backup-verification.json'), json('live-crypto-audit.json'),
  readFile(path.join(out, 'tests.tap'), 'utf8'), readFile(path.join(out, 'backup-tests.txt'), 'utf8'),
  readFile(path.join(here, 'README.ja.md'), 'utf8'),
]);
const testCount = Number(tests.match(/(?:ℹ |# )tests (\d+)/)?.[1]);
const failCount = Number(tests.match(/(?:ℹ |# )fail (\d+)/)?.[1]);
if (!testCount || failCount !== 0 || !/Ran 5 tests/.test(backupTests) || !/\nOK\b/.test(backupTests)) {
  throw Error('Report generation refused: passing test evidence required');
}
const escape = text => String(text).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function inline(text) {
  return escape(text).replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/https:\/\/[^\s<]+/g, url => `<a href="${url}" rel="noreferrer">${url}</a>`);
}
function render(text) {
  const blocks = []; let para = [], code = [], inCode = false, list = false;
  const flush = () => { if (para.length) { blocks.push(`<p>${inline(para.join('\n'))}</p>`); para = []; } };
  const endList = () => { if (list) { blocks.push('</ul>'); list = false; } };
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      flush(); endList();
      if (inCode) { blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); code = []; }
      inCode = !inCode; continue;
    }
    if (inCode) { code.push(line); continue; }
    const heading = line.match(/^(#{1,4}) (.+)$/);
    if (heading) { flush(); endList(); const level = Math.min(heading[1].length + 1, 5);
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    if (line.startsWith('- ')) { flush(); if (!list) { blocks.push('<ul>'); list = true; }
      blocks.push(`<li>${inline(line.slice(2))}</li>`); continue; }
    if (!line.trim()) { flush(); endList(); continue; }
    endList(); para.push(line);
  }
  flush(); endList(); return blocks.join('\n');
}
const rows = bench.results.map(r => `<tr><th scope="row">${escape(r.algorithm)}</th>
<td>${r.signatureBytes}</td><td>${r.keyGeneration.meanMs.toFixed(3)}</td>
<td>${r.sign.medianMs.toFixed(3)} / ${r.sign.p95Ms.toFixed(3)}</td>
<td>${r.verify.medianMs.toFixed(3)} / ${r.verify.p95Ms.toFixed(3)}</td></tr>`).join('');
const html = `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZERONYTH 暗号方式調査・ML-DSA実験報告</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f1f4f8;color:#142039;font:16px/1.8 system-ui,sans-serif}
main{max-width:1080px;margin:auto;padding:36px 24px 80px}header{background:#122440;color:white;padding:30px;border-radius:12px}
h1{font-size:clamp(25px,4vw,37px);line-height:1.4;margin:8px 0 16px}h2{margin-top:40px;font-size:26px}h3{font-size:23px;margin-top:36px;border-bottom:1px solid #d3dbe5;padding-bottom:8px}
h4{font-size:20px;margin-top:28px}h5{font-size:18px}p,li{overflow-wrap:anywhere}a{color:#155aaa}header p{color:#d8e6fa}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}.card{padding:16px;background:white;border:1px solid #d4dce8;border-radius:10px}.card strong{display:block;font-size:24px}
.note{padding:18px;border-left:4px solid #b87512;background:#fff6e7;border-radius:4px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px;background:white}
th,td{text-align:left;border-bottom:1px solid #d4dce8;padding:12px;vertical-align:top}thead{background:#e3eaf4}td{white-space:nowrap}
code{font:13px/1.6 ui-monospace,monospace;background:#e5ebf2;border-radius:3px;padding:2px 4px}pre{background:#122440;color:#edf5ff;padding:18px;border-radius:8px;overflow:auto}pre code{background:none;color:inherit;padding:0}
details{background:white;padding:15px;border:1px solid #d4dce8;margin:12px 0;border-radius:8px}summary{cursor:pointer;font-weight:650}.small{font-size:13px;color:#46566d}
@media(max-width:620px){main{padding:16px 14px 50px}header{padding:22px}.cards{grid-template-columns:1fr}.card strong{font-size:21px}}
@media print{body{background:white}main{max-width:none;padding:0}header{background:white;color:black;border:1px solid #ccc}header p{color:#333}details{break-inside:avoid}a{color:inherit}pre{white-space:pre-wrap}}
</style><main>
<header><p>ZERONYTH / LOCAL RESEARCH REPORT</p><h1>暗号方式調査・ML-DSA実験報告</h1>
<p>既存4ノードを保持し、独立環境で署名・互換性・性能・鍵更新を検証。</p>
<p>作成根拠: ${escape(bench.capturedUtc)} / ${escape(bench.node)} / OpenSSL ${escape(bench.openssl)}</p></header>
<div class="cards"><div class="card"><strong>4ノード分を保存・照合</strong>325ファイル / 復元DBの読み取り確認は1ノード</div>
<div class="card"><strong>${testCount} + 5 tests PASS</strong>暗号・互換性・鍵更新 / 復元安全性</div>
<div class="card"><strong>既存Besuは変更なし</strong>chain ID 9127 / 4 validators / 3 peers</div></div>
<p class="note"><strong>重要:</strong>バックアップは同一ワークスペース内の未暗号化ファイルです。700/600の権限で制限し、この報告書には秘密鍵を含めていません。ワークスペース消失に備えるには暗号化した外部保管が別途必要です。</p>
<h2>性能測定の要約</h2>
<p>単位は ms/操作。署名・検証は中央値 / p95、鍵生成は平均。各操作10回warmup、鍵生成30回、署名・検証各${bench.results[0].sign.samples}回。メッセージ256バイト。</p>
<div class="scroll"><table><thead><tr><th>方式 / 実装</th><th>署名bytes</th><th>鍵生成 平均ms</th><th>署名 中央値 / p95 ms</th><th>検証 中央値 / p95 ms</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="small">Ethereum行はethers/JavaScriptによる計算済みKeccak digestの署名・送信者復元。ML-DSAはnative OpenSSL。これらをBesuの性能差と解釈しないこと。native ECDSA+SHA256行はEthereum署名ではありません。分散TPS・gas・ネットワーク性能は未測定です。</p>
<p>ML-DSA-65: 公開鍵raw 1952 bytes、署名3309 bytes。65-byte ECDSA署名の約50.9倍。3票の署名部分のみで195 → 9927 bytes。</p>
<h2>実装・調査・変更範囲</h2>${render(markdown)}
<h2>検証根拠（秘密情報なし）</h2>
<details><summary>復元と元ネットワーク再開の確認</summary><pre>${escape(JSON.stringify(backup, null, 2))}</pre></details>
<details><summary>実ブロックのECDSA署名者復元</summary><pre>${escape(JSON.stringify(live, null, 2))}</pre></details>
<details><summary>暗号・互換性・鍵更新テスト結果</summary><pre>${escape(tests)}</pre></details>
<details><summary>復元の安全性テスト</summary><pre>${escape(backupTests)}</pre></details>
<details><summary>全マイクロベンチマーク値</summary><pre>${escape(JSON.stringify(bench, null, 2))}</pre></details>
</main></html>`;
await writeFile(path.join(out, 'report.ja.html'), html);
await writeFile(path.join(out, 'report.ja.md'), markdown);
console.log('Generated secret-free HTML and Markdown reports.');
