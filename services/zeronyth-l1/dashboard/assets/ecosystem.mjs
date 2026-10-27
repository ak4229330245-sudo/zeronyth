import { BRIDGE_ROUTES, NETWORKS, getNetwork } from './ecosystem-registry.mjs';
import { lookupTransaction, probeNetwork } from './ecosystem-rpc.mjs';
import {
  connectEvmWallet,
  connectSolanaWallet,
  discoverEvmWallets,
  discoverSolanaWallet,
  shortAddress,
  switchEvmNetwork,
} from './ecosystem-wallet.mjs';
import { ecoI18n, setupEcosystemLanguage } from './ecosystem-i18n.mjs';

const $ = (id) => document.getElementById(id);
const state = { evmWallets: [], solanaWallets: [], wallet: null };

function setStatus(element, message, kind = 'info') {
  if (!element) return;
  element.textContent = message;
  element.dataset.status = kind;
}

function setNetworkLive(card, message, status) {
  const target = card.querySelector('[data-network-live]');
  if (target) target.textContent = message;
  card.dataset.rpcStatus = status;
}

function selectedWalletEntry() {
  const family = $('eco-wallet-type')?.value || 'evm';
  const index = Number($('eco-wallet-provider')?.value);
  const wallets = family === 'solana' ? state.solanaWallets : state.evmWallets;
  return Number.isInteger(index) ? wallets[index] || null : null;
}

function updateWalletControls() {
  const connected = Boolean(state.wallet);
  const family = $('eco-wallet-type')?.value || 'evm';
  for (const button of document.querySelectorAll('[data-action="switch-network"]')) {
    button.disabled = !connected || state.wallet.kind !== 'evm';
  }
  for (const button of document.querySelectorAll('[data-action="connect-solana"]')) {
    button.disabled = connected && state.wallet.kind === 'evm';
  }
  const disconnect = $('eco-disconnect-wallet');
  if (disconnect) disconnect.disabled = !connected;
  const connect = $('eco-connect-wallet');
  if (connect) connect.disabled = !selectedWalletEntry() || connected;
  if (family === 'solana' && !state.solanaWallets.length) {
    setStatus($('eco-wallet-status'), ecoI18n.t('wallet.noneSolana'), 'error');
  } else if (family === 'evm' && !state.evmWallets.length) {
    setStatus($('eco-wallet-status'), ecoI18n.t('wallet.none'), 'error');
  }
}

function renderProviderOptions() {
  const family = $('eco-wallet-type')?.value || 'evm';
  const select = $('eco-wallet-provider');
  if (!select) return;
  const wallets = family === 'solana' ? state.solanaWallets : state.evmWallets;
  select.replaceChildren();
  if (!wallets.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = ecoI18n.t(family === 'solana' ? 'wallet.noneSolana' : 'wallet.none');
    select.appendChild(option);
  } else {
    wallets.forEach((wallet, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = wallet.label;
      select.appendChild(option);
    });
  }
  updateWalletControls();
}

function renderWallet(wallet, label) {
  state.wallet = wallet;
  const status = $('eco-wallet-status');
  const message = wallet.kind === 'solana'
    ? ecoI18n.t('wallet.solanaReady')
    : ecoI18n.t('wallet.connected', { wallet: label });
  setStatus(status, message, 'connected');
  const address = $('eco-wallet-address');
  if (address) {
    address.hidden = false;
    address.textContent = shortAddress(wallet.address);
    address.title = wallet.address;
  }
  updateWalletControls();
}

function clearWallet() {
  state.wallet = null;
  const address = $('eco-wallet-address');
  if (address) {
    address.hidden = true;
    address.textContent = '';
    address.removeAttribute('title');
  }
  setStatus($('eco-wallet-status'), ecoI18n.t('wallet.disconnected'), 'idle');
  updateWalletControls();
}

async function initWalletPanel() {
  const family = $('eco-wallet-type');
  if (!family) return;
  setStatus($('eco-wallet-status'), ecoI18n.t('wallet.detecting'), 'loading');
  [state.evmWallets, state.solanaWallets] = await Promise.all([
    discoverEvmWallets(),
    Promise.resolve(discoverSolanaWallet()),
  ]);
  renderProviderOptions();
  family.addEventListener('change', renderProviderOptions);
  $('eco-wallet-provider')?.addEventListener('change', updateWalletControls);
  $('eco-connect-wallet')?.addEventListener('click', async () => {
    const entry = selectedWalletEntry();
    if (!entry) {
      setStatus($('eco-wallet-status'), ecoI18n.t('wallet.noProvider'), 'error');
      return;
    }
    const button = $('eco-connect-wallet');
    button.disabled = true;
    try {
      if (family.value === 'solana') {
        renderWallet(await connectSolanaWallet(entry.provider), entry.label);
      } else {
        const wallet = await connectEvmWallet(entry.provider);
        renderWallet(wallet, entry.label);
        try {
          const chainHex = await entry.provider.request({ method: 'eth_chainId' });
          const chain = Number(BigInt(chainHex));
          const mapped = NETWORKS.find((item) => item.family === 'evm' && item.chainId === chain);
          setStatus(
            $('eco-wallet-status'),
            `${ecoI18n.t('wallet.connected', { wallet: entry.label })} · ${mapped?.name || `Chain ${chain}`}`,
            'connected',
          );
        } catch {
          // The account was connected successfully; chain information is optional.
        }
        entry.provider.on?.('accountsChanged', (accounts) => {
          if (!Array.isArray(accounts) || !accounts[0]) clearWallet();
          else renderWallet({ ...wallet, address: accounts[0] }, entry.label);
        });
        entry.provider.on?.('chainChanged', (chainHex) => {
          try {
            const chain = Number(BigInt(chainHex));
            const mapped = NETWORKS.find((item) => item.family === 'evm' && item.chainId === chain);
            setStatus($('eco-wallet-status'), `${ecoI18n.t('wallet.connected', { wallet: entry.label })} · ${mapped?.name || `Chain ${chain}`}`, 'connected');
          } catch {
            setStatus($('eco-wallet-status'), ecoI18n.t('wallet.connected', { wallet: entry.label }), 'connected');
          }
        });
      }
    } catch (error) {
      setStatus($('eco-wallet-status'), ecoI18n.t('wallet.connectFailed', { reason: error?.message || 'Unknown error' }), 'error');
      button.disabled = false;
    }
  });
  $('eco-disconnect-wallet')?.addEventListener('click', async () => {
    const provider = state.wallet?.provider;
    if (state.wallet?.kind === 'solana') {
      try { await provider?.disconnect?.(); } catch { /* Local display is cleared even if the wallet declines. */ }
    }
    clearWallet();
  });
  updateWalletControls();
}

function initNetworkCards() {
  for (const card of document.querySelectorAll('[data-network-id]')) {
    const network = getNetwork(card.dataset.networkId);
    if (!network) continue;
    const probeButton = card.querySelector('[data-action="probe-network"]');
    probeButton?.addEventListener('click', async () => {
      probeButton.disabled = true;
      probeButton.textContent = ecoI18n.t('network.probePending');
      setNetworkLive(card, ecoI18n.t('network.probePending'), 'checking');
      try {
        const result = await probeNetwork(network.id, { pageUrl: location.href });
        if (result.state === 'mismatch') {
          setNetworkLive(card, ecoI18n.t('network.mismatch', result), 'mismatch');
        } else if (network.family === 'solana') {
          setNetworkLive(card, ecoI18n.t('network.solanaOnline'), 'online');
        } else if (network.id === 'zeronyth-9127') {
          setNetworkLive(card, ecoI18n.t('network.zeronythOnline'), 'online');
        } else {
          setNetworkLive(card, ecoI18n.t('network.online'), 'online');
        }
      } catch (error) {
        setNetworkLive(card, ecoI18n.t('network.error', { reason: error?.message || 'RPC unavailable' }), 'error');
      } finally {
        probeButton.disabled = false;
        probeButton.textContent = ecoI18n.t('network.probe');
      }
    });
    card.querySelector('[data-action="switch-network"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (state.wallet?.kind !== 'evm') {
        setStatus($('eco-wallet-status'), ecoI18n.t('wallet.noProvider'), 'error');
        return;
      }
      button.disabled = true;
      try {
        await switchEvmNetwork(state.wallet.provider, network);
        setStatus($('eco-wallet-status'), `${ecoI18n.t('wallet.connected', { wallet: shortAddress(state.wallet.address) })} · ${network.name}`, 'connected');
      } catch (error) {
        setStatus($('eco-wallet-status'), error?.message || 'Network switch failed', 'error');
      } finally {
        updateWalletControls();
      }
    });
    card.querySelector('[data-action="connect-solana"]')?.addEventListener('click', async () => {
      const wallet = state.solanaWallets[0];
      if (!wallet) {
        setStatus($('eco-wallet-status'), ecoI18n.t('wallet.noneSolana'), 'error');
        return;
      }
      try { renderWallet(await connectSolanaWallet(wallet.provider), wallet.label); }
      catch (error) { setStatus($('eco-wallet-status'), error?.message || 'Solana wallet connection failed', 'error'); }
    });
  }
  updateWalletControls();
}

function initBridge() {
  const container = $('bridge-provider-links');
  if (!container) return;
  const route = BRIDGE_ROUTES.find((entry) => entry.id === 'sepolia-to-base-sepolia');
  if (!route) return;
  container.replaceChildren();
  for (const provider of route.providers) {
    const link = document.createElement('a');
    link.className = 'btn';
    link.href = provider.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = ecoI18n.t('bridge.openProvider', { provider: provider.name });
    container.appendChild(link);
  }
  const providerState = $('bridge-provider-state');
  if (providerState) {
    providerState.textContent = `${ecoI18n.t('bridge.handoff')} · Sepolia → Base Sepolia · ETH test asset only`;
    providerState.dataset.providerState = 'documented-external-handoff';
  }
  const docs = document.createElement('a');
  docs.href = route.documentation;
  docs.target = '_blank';
  docs.rel = 'noopener noreferrer';
  docs.textContent = 'Base official bridge documentation ↗';
  container.appendChild(docs);
}

function addActivityRow(result) {
  const body = $('activity-rows');
  if (!body) return;
  if (body.querySelector('#activity-row-template')) body.replaceChildren();
  const empty = $('activity-empty');
  if (empty) empty.hidden = true;
  const row = document.createElement('tr');
  row.dataset.activityChain = result.chain;
  row.dataset.activityHash = result.hash;
  row.dataset.activityType = result.type;
  row.dataset.activityState = result.state;
  const chain = document.createElement('td');
  chain.textContent = result.chain;
  const hash = document.createElement('td');
  const code = document.createElement('code');
  code.textContent = result.hash;
  hash.appendChild(code);
  const type = document.createElement('td');
  type.textContent = result.type;
  const stateCell = document.createElement('td');
  stateCell.textContent = ecoI18n.t(`activity.${result.state}`, {});
  if (result.state === 'not-found') stateCell.textContent = ecoI18n.t('activity.notFound');
  const explorer = document.createElement('td');
  if (result.explorerUrl && result.explorerUrl.startsWith('https://')) {
    const link = document.createElement('a');
    link.href = result.explorerUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open ↗';
    explorer.appendChild(link);
  } else {
    explorer.textContent = 'No verified explorer';
  }
  row.append(chain, hash, type, stateCell, explorer);
  body.prepend(row);
}

function initActivity() {
  const form = $('activity-lookup-form');
  if (!form) return;
  for (const id of ['activity-loading', 'activity-error', 'activity-unsupported']) {
    const element = $(id);
    if (element) element.hidden = true;
  }
  const networkSelect = $('activity-network');
  for (const network of NETWORKS) {
    const option = document.createElement('option');
    option.value = network.id;
    option.textContent = network.name;
    networkSelect.appendChild(option);
  }
  const submit = $('activity-lookup-button');
  const status = $('activity-result-status');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const networkId = networkSelect.value;
    const hash = $('activity-hash').value.trim();
    submit.disabled = true;
    setStatus(status, ecoI18n.t('network.probePending'), 'loading');
    try {
      const result = await lookupTransaction(networkId, hash, { pageUrl: location.href });
      addActivityRow(result);
      const label = result.state === 'confirmed' ? ecoI18n.t('activity.confirmed')
        : result.state === 'failed' ? ecoI18n.t('activity.failed')
          : result.state === 'pending' ? ecoI18n.t('activity.pending')
            : ecoI18n.t('activity.notFound');
      setStatus(status, `${result.chain}: ${label}${result.confirmations ? ` · ${result.confirmations} confirmations` : ''}`, result.state);
    } catch (error) {
      setStatus(status, error?.message || 'Transaction lookup failed', 'error');
    } finally {
      submit.disabled = false;
    }
  });
}

function initSwapPage() {
  const select = $('swap-network');
  if (!select) return;
  select.replaceChildren();
  for (const network of NETWORKS) {
    const option = document.createElement('option');
    option.value = network.id;
    option.textContent = `${network.name} · no verified pool`;
    select.appendChild(option);
  }
  select.disabled = true;
  const status = $('swap-route-status');
  if (status) status.textContent = 'No verified testnet DEX deployment or pool is registered; quotes and signing remain disabled.';
}

setupEcosystemLanguage();
await initWalletPanel();
initNetworkCards();
initBridge();
initActivity();
initSwapPage();
