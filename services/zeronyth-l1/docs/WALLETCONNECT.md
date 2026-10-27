# WalletConnect Support

## Added
- `connectWalletConnect(projectId)` in ecosystem-wallet.mjs
- UI option on the networks page wallet panel
- Testnet chains only (Sepolia, Base Sepolia, Arbitrum Sepolia, BSC Testnet, ZERONYTH 9127, etc.)

## Requirements
- A WalletConnect Cloud projectId
- `@walletconnect/ethereum-provider` available at runtime
- User scans QR or approves in mobile wallet

## Constraints
- Testnet only
- External wallets are ECDSA (not quantum-resistant)
- Native ZERONYTH path remains ML-DSA when used
