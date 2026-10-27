// Easy display of RPC, chain info, native token, and key addresses
import { NETWORKS } from './ecosystem-registry.mjs';

function addInfoToCards() {
  for (const net of NETWORKS) {
    const card = document.querySelector(`[data-network-id="${net.id}"]`);
    if (!card || card.querySelector('.info-block')) continue;

    const block = document.createElement('div');
    block.className = 'info-block';

    const rows = [
      ['Chain ID', String(net.chainId || '—')],
      ['Native', net.nativeAsset?.symbol || '—'],
      ['RPC', net.rpcUrl || '—'],
    ];

    // Add DEX router if present
    if (net.dex?.swapRouter02) rows.push(['Swap Router', net.dex.swapRouter02]);
    else if (net.dex?.swapRouter) rows.push(['Swap Router', net.dex.swapRouter]);
    else if (net.dex?.router) rows.push(['Router', net.dex.router]);

    if (net.id === 'zeronyth-9127') {
      rows.push(['Token', 'ZNYT (testnet, no value)']);
      rows.push(['Explorer', net.explorerUrl]);
    }

    // No inline style attributes: the CSP (style-src 'self') blocks them. Layout lives in styles.css (.rpc-key/.rpc-val).
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    block.innerHTML = rows.map(([k, v]) => `
      <div class="rpc-line">
        <span class="rpc-key">${esc(k)}</span>
        <code class="rpc-val">${esc(v)}</code>
        <button class="btn ghost" type="button" data-copy="${esc(v)}">Copy</button>
      </div>
    `).join('') + `<div class="rpc-warn">Testnet only · Not quantum-resistant · No real value</div>`;

    // Faucet button
    if (net.faucetUrl) {
      const faucetBtn = document.createElement('a');
      faucetBtn.href = net.faucetUrl;
      faucetBtn.target = '_blank';
      faucetBtn.rel = 'noopener noreferrer';
      faucetBtn.className = 'btn';
      faucetBtn.style.marginTop = '8px';
      faucetBtn.textContent = 'Faucet';
      block.appendChild(faucetBtn);
    }

    const actions = card.querySelector('.eco-card-actions');
    if (actions) actions.before(block);
    else card.append(block);
  }

  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const val = btn.dataset.copy;
      if (!val || val.startsWith('(')) return;
      try {
        await navigator.clipboard.writeText(val);
        const orig = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => btn.textContent = orig, 1000);
      } catch {}
    });
  });
}

if (document.querySelector('[data-network-id]')) addInfoToCards();
