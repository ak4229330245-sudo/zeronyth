import { walletIdentity } from './wallet-preference.mjs';
export const CHAIN_ID = '0x23a7';
export const validAccount = (value) => typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value);
export function walletError(error) {
  const code = error?.code ?? error?.data?.originalError?.code;
  if (code === 4001) return '接続・ネットワーク変更はキャンセルされました。';
  if (code === -32002) return 'ウォレットに確認待ちの要求があります。ウォレットを開いて確認してください。';
  return String(error?.message || error || 'ウォレットでエラーが発生しました。').slice(0, 300);
}

export function discoverWallets(host, changed) {
  const entries = [];
  const add = (provider, label, info) => {
    if (!provider || typeof provider.request !== 'function') return;
    const existing = entries.find(e => e.provider === provider);
    if (existing) {
      let updated = false;
      const restoreKey = info ? walletIdentity(provider, info) : existing.restoreKey;
      if (restoreKey && restoreKey !== existing.restoreKey) { existing.restoreKey = restoreKey; updated = true; }
      if (typeof label === 'string' && existing.name !== label) { existing.name = label.slice(0, 80); updated = true; }
      if (updated) changed([...entries]);
      return;
    }
    if (entries.length >= 32) return;
    entries.push({ id: `wallet-${entries.length}`, name: typeof label === 'string' ? label.slice(0, 80) : 'EVM Wallet',
      restoreKey: walletIdentity(provider, info), provider });
    changed([...entries]);
  };
  const legacy = () => {
    const providers = Array.isArray(host.ethereum?.providers) ? host.ethereum.providers : [host.ethereum];
    for (const p of providers) add(p, p?.isRabby ? 'Rabby' : p?.isMetaMask ? 'MetaMask' : 'EVM Wallet');
  };
  const announced = event => add(event.detail?.provider, event.detail?.info?.name, event.detail?.info);
  host.addEventListener('eip6963:announceProvider', announced);
  host.addEventListener('ethereum#initialized', legacy);
  legacy();
  host.dispatchEvent(new Event('eip6963:requestProvider'));
  return { entries, rescan: legacy, close() {
    host.removeEventListener('eip6963:announceProvider', announced);
    host.removeEventListener('ethereum#initialized', legacy);
  } };
}

export function walletRpcUrl(location, configured) {
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  const url = new URL(configured || './rpc', location.href);
  if (url.username || url.password || url.hash || url.search ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw Error('RPC URLは認証情報やクエリーを含まないHTTPS URLにしてください。');
  }
  if (!local && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw Error('外部のウォレットにはlocalhostのRPCを設定できません。');
  }
  return url.href;
}

export function formatZnyt(hex) {
  if (typeof hex !== 'string' || !/^0x[\da-f]{1,64}$/i.test(hex)) throw Error('Invalid balance');
  const value = BigInt(hex);
  const unit = 10n ** 18n;
  const fraction = (value % unit).toString().padStart(18, '0').replace(/0+$/, '');
  return `${value / unit}${fraction ? `.${fraction}` : ''} ZNYT`;
}

export class WalletController {
  constructor(changed = () => {}) {
    this.provider = null;
    this.changed = changed;
    this.version = 0;
    this.session = 0;
    this.listeners = [];
    this.state = { account: null, chainId: null, busy: false, error: '' };
  }
  update(patch) { this.state = { ...this.state, ...patch }; this.changed({ ...this.state }); }
  detach() {
    for (const [provider, event, handler] of this.listeners) provider.removeListener?.(event, handler);
    this.listeners = [];
  }
  disconnect() {
    this.version++;
    this.session++;
    this.detach();
    this.provider = null;
    this.update({ account: null, chainId: null, busy: false, error: '' });
  }
  async restore(provider) {
    // Explicit user action; only inspect permissions already granted to this origin.
    return this.connect(provider, { authorizedOnly: true });
  }
  async connect(provider, { authorizedOnly = false } = {}) {
    if (this.state.busy) throw Error('ウォレットの確認を完了してから操作してください。');
    this.disconnect();
    if (typeof provider?.request !== 'function') throw Error('ウォレットが見つかりません。');
    this.provider = provider;
    const token = ++this.version;
    this.update({ busy: true });
    try {
      const accounts = await provider.request({ method: authorizedOnly ? 'eth_accounts' : 'eth_requestAccounts' });
      if (token !== this.version || provider !== this.provider) return this.state;
      if (!Array.isArray(accounts) || !validAccount(accounts[0])) throw Error('接続するアカウントが選択されていません。');
      for (const event of ['accountsChanged', 'chainChanged', 'connect']) {
        const handler = () => { void this.refresh(); };
        provider.on?.(event, handler);
        this.listeners.push([provider, event, handler]);
      }
      const handler = () => this.disconnect();
      provider.on?.('disconnect', handler);
      this.listeners.push([provider, 'disconnect', handler]);
      await this.refresh();
      if (provider === this.provider) this.update({ busy: false });
      return this.state;
    } catch (error) {
      if (token === this.version && provider === this.provider) {
        this.disconnect();
        this.update({ error: walletError(error) });
      }
      throw error;
    }
  }
  async refresh() {
    const provider = this.provider;
    if (!provider) return;
    const token = ++this.version;
    try {
      const [accounts, chainId] = await Promise.all([
        provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
      ]);
      if (token !== this.version || provider !== this.provider) return;
      if (!Array.isArray(accounts) || !accounts.length) { this.disconnect(); return; }
      if (!validAccount(accounts[0]) || typeof chainId !== 'string' || !/^0x[\da-f]{1,64}$/i.test(chainId)) {
        throw Error('ウォレットから不正なアカウント・ネットワーク情報が返されました。');
      }
      this.update({ account: accounts[0], chainId: `0x${BigInt(chainId).toString(16)}`, error: '' });
    } catch (error) {
      if (token === this.version && provider === this.provider) {
        this.disconnect();
        this.update({ error: walletError(error) });
      }
    }
  }
  async switchChain(rpcUrl, probe) {
    const provider = this.provider;
    if (!provider || !this.state.account) throw Error('先にウォレットを接続してください。');
    if (this.state.busy) throw Error('確認待ちの操作を完了してください。');
    const session = this.session;
    const selectedAccount = this.state.account;
    const selectedChain = this.state.chainId;
    this.update({ busy: true, error: '' });
    try {
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
      } catch (error) {
        if ((error?.code ?? error?.data?.originalError?.code) !== 4902) throw error;
        if (!rpcUrl) throw Error('ウォレット用RPC URLが未設定です。');
        if (await probe(rpcUrl) !== CHAIN_ID) throw Error('RPCのChain IDが9127と一致しません。');
        if (provider !== this.provider || session !== this.session ||
            selectedAccount !== this.state.account || selectedChain !== this.state.chainId) {
          throw Error('接続状態が変わりました。もう一度操作してください。');
        }
        await provider.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: CHAIN_ID, chainName: 'ZERONYTH Devnet',
          nativeCurrency: { name: 'ZERONYTH', symbol: 'ZNYT', decimals: 18 }, rpcUrls: [rpcUrl],
          blockExplorerUrls: ['https://scan.zeronyth.dpdns.org'],
        }] });
        if (provider !== this.provider || session !== this.session || selectedAccount !== this.state.account) return;
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
      }
      if (provider === this.provider && session === this.session) {
        await this.refresh();
        if (this.state.chainId !== CHAIN_ID) throw Error('ウォレットのネットワーク切替が完了していません。');
      }
    } catch (error) {
      if (provider === this.provider && session === this.session) this.update({ error: walletError(error) });
      throw error;
    } finally {
      if (provider === this.provider && session === this.session) this.update({ busy: false });
    }
  }
}
