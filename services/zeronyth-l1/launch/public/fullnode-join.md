# 外部フルノード / 将来のバリデーター候補の接続設定 (公開チェーン)

Cloudflare Tunnel は HTTP(S) だけを通します。P2P (30303 TCP/UDP) は通らないため、外部ノードの接続先 (bootnode) は
**VPS のグローバル IP** を使います (ufw-bootnode.sh 適用後。適用はユーザー承認が必要)。

```
static-nodes.json:
["enode://<VPS node4 の公開鍵>@YOUR_VPS_IP:30303"]
```
- VPS node4 の公開鍵は `besu public-key export --node-private-key-file=node-data/node4/key` で出します (公開鍵だけ。鍵本体は出さない)。
- 公開 genesis 切替後、node4 の p2p を `--p2p-host=YOUR_VPS_IP --p2p-interface=0.0.0.0 --p2p-port=30303` に変更 (現状はトンネル用 127.0.0.1:31306)。
- 外部フルノードの起動例:
```
besu --genesis-file=genesis.json --network-id=9127 --sync-mode=FULL --data-storage-format=FOREST \
  --static-nodes-file=static-nodes.json --discovery-enabled=false --min-gas-price=1000000000 \
  --rpc-http-enabled --rpc-http-host=127.0.0.1
```
- バリデーター追加は既存バリデーターの過半数による `qbft_proposeValidatorVote` (審査フロー: 項目4 で作成)。
