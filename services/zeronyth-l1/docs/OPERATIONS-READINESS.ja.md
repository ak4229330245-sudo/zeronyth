# 安全性強化・次段階の受入手順

この資料は本番運用の完了証明ではない。現行4ノード・DB・genesis・鍵・設定を
置換せずに準備するための手順であり、公開ネットワークの立上げ許可でもない。

## 保全と隔離復元

```sh
python3 services/zeronyth-l1/scripts/backup-readiness.py audit PRIVATE_BACKUP_DIRECTORY
python3 services/zeronyth-l1/scripts/backup-readiness.py restore-bytes PRIVATE_BACKUP_DIRECTORY --confirm-isolated
```

既存保存先はowner-onlyのまま読み、元ファイルのchmod・展開・上書きをしない。
2番目のコマンドは、既存のowner-only `generated-artifacts/private-restores` 配下に
ランダムな新規ディレクトリだけを作る。全325ファイルのbyte復元を検証しても、
**Besu DBを開く・リプレイする・鍵を使って署名する処理は行わない**。
同じvalidator鍵を2台で稼働させない。公開ディレクトリやGitに復元物を移さない。
エラー時の途中復元物は保全し、自動削除・修復・再初期化しない。
SHA-256はローカル整合性検査であり、第三者による真正性保証ではない。

実バックアップの暗号化には所有者のオフライン端末で作成したPQ age公開受信者を使う。
所有者の秘密identityはこのサイト、チャット、Gitへ送らない。
独立調査ブランチの `research/pq-audit/encrypt_backup.py` は検証済みarchiveと
manifestを直接暗号化する補助ツールで、`age1pq1`受信者のみ受け付ける。
復号・誤鍵拒否・改ざん拒否はsynthetic fixture試験と、実バックアップの受入試験を区別する。

外部保管の完了条件:
1. 所有者の公開受信者と、承認済みの外部保存先が決まっている。
2. 新しい暗号文だけを作り、既存のarchive/manifestを変更していない。
3. 所有者側で復号・ハッシュ照合し、秘密identityはオフラインで管理する。
4. 外部保存先から再ダウンロードし、暗号文ハッシュと復号結果を照合する。
5. owner-only workspace内のコピーと、暗号化済み外部コピーを区別して記録する。

## 読取り専用の4ノード監視

```sh
python3 services/zeronyth-l1/scripts/observe-devnet.py --interval 5
```

4プロセスの継続と、既に有効なローカルRPCのChain ID、peer数、高さの前進を観測する。
現状RPCが有効なのは1ノードだけで、残り3ノードのRPCを有効化しない。
従って全ノード個別の高さをRPCで確認したという報告にはしない。
異常でも自動restart/reset/修復はしない。この単発観測は常時監視や通知を代替しない。
別ホスト化には独立運営者、複数障害ドメイン、認証済み通信、監視担当者、
incident response、鍵管理とガバナンスを別途決める。

## 公開RPC・Faucetの準備

`experiments/operations-policy.mjs` は**未適用の参考実装**。
HTTPS origin、read-only RPC allowlist、64KiB body上限、
client数/頻度の制限、Faucetの明示的有効化・認証・devnet限定・cooldownを試験する。
live gatewayやFaucetへは接続しない。admittedは実行済みを意味しない。

実サービスへの適用前に必要なもの:
- 信頼できるreverse proxyによるclient IP確定。利用者提供X-Forwarded-Forを信じない。
- 本物の認証・authorization、複数worker共通の永続quota/idempotency、global資金上限。
- batch/nested RPC・parameter/responseサイズ・同時実行数・timeoutの制限。
- TLS証明書、WAF/DDoS対策、監査ログ、アラートと運用担当。
- validator RPCを直接公開せず、専用のsentry/RPC層を設ける。

## ウォレット受入と復帰

記憶はopt-inで、provider hintだけを保存する。復帰はクリック後の`eth_accounts`/
`eth_chainId`読取りのみ。アカウント・秘密鍵・取引レビュー・同意は永続化しない。
識別子は自己申告なので、同じhintが複数見つかれば復帰を拒否する。
切断・失効・遅れて戻る応答・別chain・storage拒否を試験する。
mock試験は本物のMetaMask/Rabby/iOS/Android確認ではない。
実機チェックリストは公開ページの `wallet-acceptance-checklist.md` を使い、
実際の端末・バージョン・結果を記録する。mainnetや実資産は使わない。

## 耐量子化・ブラウザーノードの次段階

独立研究Chain ID 29127と現行9127を混同しない。実験4workerのTCPはlocalhostだけで、
複数ホスト、PQ鍵交換、完全QBFT、EVM送金、商用TPSを証明しない。
将来の鍵更新/失効、歴史互換、crash、DoS、third-party auditを統合の受入条件にする。

Web Node Labはbounded hash/P2P研究であり、L1 validatorや実報酬ではない。
実ネットワーク化には、計算結果検証、悪意あるpeer・Sybil・不正claim対策、
経済設計、資金源、報酬contractと独立監査が必要。現行残高・token発行・合意方式を
この作業で変更しない。ブラウザーの常時稼働やスマホの可用性も保証しない。

## ロールバック

本変更は静的UI、独立ツール・研究コードのみ。現行ノードの巻戻しは不要。
研究workerはハーネスが所有する子プロセスだけを終了する。
問題時は原本・ログ・途中状態を保全し、live DB展開や鍵再生成をしない。
UI復帰が必要なら変更対象の静的ファイルだけを承認済み差分で戻す。
validatorを所有するweb launcherのrestartは行わない。
