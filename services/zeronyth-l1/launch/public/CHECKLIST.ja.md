# ZERONYTH 公開ローンチ チェックリスト (準備のみ・ライブチェーンは未切替)

> いま動いているチェーン (box 3台 + VPS node4、私用 URL http://YOUR_TAILSCALE_IP:22673/) は**変更していません**。
> ここにあるのは「公開用の新しい genesis」と手順です。切替はユーザー承認後に行います。

## 0. トークン配分 (合計 100,000,000 ZNYT、genesis で確定)
| 区分 | 量 | 受け取り先 |
|---|---|---|
| 報酬プール 30% | 30,000,000 | `0x…E001` EmissionPool (genesis に事前配置。毎年残高の15%を放出、引き出し機能なし) |
| 開発者 2% (即時) | 2,000,000 | developer アドレス |
| 開発者 13% (ロック) | 13,000,000 | `0x…E002` DevVesting (1年クリフ → 3年で均等解放) |
| グラント 20% | 20,000,000 | grants (マルチシグ推奨) |
| トレジャリー 15% | 14,999,000 + 1,000 | treasury + opsDeployer (初期デプロイのガス代) |
| 流動性 10% | 10,000,000 | liquidity |
| 初期参加者 10% | 9,900,000 + 100,000 | 配布用アドレス + faucet (ガス用少額配布) |

- 旧 genesis にあった公開 Hardhat アカウント (0xf39f…2266) は**使いません** (ビルダーが拒否します)。
- 1年目の放出は 4,500,000 ZNYT (≈ 12,328.77 / 日)。リハーサルで実測確認済み。

## 1. ユーザーが用意するもの (鍵はご自身で管理。こちらでは受け取りません)
- [ ] developer / grants / treasury / liquidity / 初期参加者 / opsDeployer のアドレス (ハードウェアウォレット or マルチシグ推奨)
- [ ] `public-genesis.config.json` の `0xREPLACE_…` をすべて置換
- [ ] ローンチ日時 `launchTime` (DevVesting の開始時刻になります)
- [ ] Cloudflare: ドメイン + `cloudflared tunnel login` (ユーザー本人がブラウザで実施)

## 2. サーバー側で作るもの (box 上、chmod 600、表示しない)
- [ ] `node gen-server-key.mjs faucet` → faucet アドレスを config に記入
- [ ] `node gen-server-key.mjs coordinator` → 報酬コーディネーター用
- [ ] **新しいバリデーター鍵 4つ** (テストネットの鍵は再利用しない)。box に3、VPS に1。各 key は chmod 600 + オフライン バックアップ
- [ ] テストネットの鍵・アドレスを公開チェーンで使い回さない (同じ chainId 9127 のためリプレイ防止)

## 3. genesis 作成と検証
- [ ] `node build-public-genesis.mjs` (プレースホルダーが残っていると停止)
- [ ] `node rehearse.mjs` — box の別ポートで 4 バリデーター起動 → 配分 / コントラクト / faucet 制限を自動検証 (現在 30/30 PASS)
- [ ] genesis.json のハッシュを記録して公開 (改ざん防止)

## 4. 切替当日 (ユーザー承認後のみ)
1. [ ] 旧チェーンの最終バックアップ (`~/zeronyth-backups/backup.sh`)
2. [ ] box で primary 停止 → 新 genesis + 新鍵で起動 (validators 1–3 は box のみ、4 は VPS のみ。**同じ鍵を2台で同時に動かさない**)
3. [ ] opsDeployer で `launch-deploy.mjs` を実行 (最初の取引で ZnytEconomy をデプロイ。nonce 0 でないと停止する安全装置あり)
4. [ ] `public.env.example` の値で faucet/gateway を起動 (1日あたり: 1アドレス1回・1IP3回・全体2,000回、残高がある人は拒否)
5. [ ] `cloudflare/setup.sh <ドメイン>` で公開 (8545/5000/faucet/signaling は直接公開しない。gateway 22780 のみ)
6. [ ] 私用 URL http://YOUR_TAILSCALE_IP:22673/ が引き続き開けることを確認

## 5. 運用・監視
- [ ] `scripts/health.sh` を定期実行 (高さ・ピア・4バリデーターの提案数)
- [ ] 日次バックアップ (VPS 04:30、7世代)。box 側バックアップも追加
- [ ] VPS は 2GB では余裕が小さい (現在 709MB/1967MB 使用)。公開後は 4GB 以上推奨
- [ ] ufw (VPS): `ufw-bootnode.sh` は準備済み・**未適用** (22, 80/443, 30303 のみ許可。適用はユーザーが sudo で)
- [ ] faucet 残高監視 (100,000 ZNYT ÷ 最大 2,000/日 = 最短 50 日)

## 6. 法務メモ (専門家確認を推奨)
- ZNYT を「投資」「値上がり」と宣伝しない。テスト・ユーティリティ用途の明記
- 日本では暗号資産の売買・交換の業としての提供は資金決済法の登録対象になり得る。トークン販売や取引所上場前に弁護士へ相談
- 利用規約・プライバシーポリシー (IP をレート制限に使用する旨) を公開ページに掲載
- 開発者割当 15% (うち 13% ロック) を公開資料に明記
