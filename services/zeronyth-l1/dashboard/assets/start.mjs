// Beginner start page: live status + "add network" only. Never asks for keys; no transactions are sent from here.
const $ = (id) => document.getElementById(id);
const CHAIN = { chainId: '0x23a7', chainName: 'ZERONYTH Testnet', nativeCurrency: { name: 'ZNYT', symbol: 'ZNYT', decimals: 18 },
  rpcUrls: [location.origin + '/rpc'], blockExplorerUrls: ['https://scan.zeronyth.dpdns.org'] };
async function status() {
  const s = $('status');
  try {
    const r = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
    const j = await r.json(); const n = Number(BigInt(j.result));
    s.textContent = `🟢 ネットワークは動いています（ブロック番号 ${n.toLocaleString('ja-JP')}）`; s.className = 's-status ok';
  } catch { s.textContent = '🔴 いまネットワークにつながりません。少し待ってから再読み込みしてください。'; s.className = 's-status bad'; }
}
$('addChain').addEventListener('click', async () => {
  const m = $('addMsg');
  if (!window.ethereum) { m.textContent = 'ウォレットが見つかりません。先に Rabby か MetaMask を入れて、そのアプリ内のブラウザか、拡張機能を入れたブラウザで開いてください。'; return; }
  try {
    try { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainId }] }); }
    catch { await ethereum.request({ method: 'wallet_addEthereumChain', params: [CHAIN] }); }
    m.textContent = '✅ 追加できました。次は 2 番へ進んでください。';
  } catch (e) { m.textContent = e?.code === 4001 ? 'キャンセルされました。もう一度押せばやり直せます。' : '追加できませんでした: ' + (e?.message || e); }
});
status(); setInterval(status, 15000);
