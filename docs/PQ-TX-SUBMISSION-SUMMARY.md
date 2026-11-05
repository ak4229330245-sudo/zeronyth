<!-- Published copy of the project engineering record. Internal workspace paths were rewritten to this repository's layout (besu-912701/ = reconstructed production source tree, docs/ = deliverables). -->

# 提出物サマリー：912701 量子耐性ネイティブ取引（Falcon-1024 / ML-DSA-65）

日付: 2026-11-05　対象チェーン: 912701（本番・Falcon-1024 QBFT）
**本番反映はオーナーの最終承認後のみ。本書はその判断材料。**

## 結論（要約）

- 本番バイナリの素性を特定し、同等ソースを復元・ビルド可能にした
  （表示バージョン `besu/v26.11-develop-c9aa666` が本番と完全一致）。
- Falcon-1024（0x7E）と ML-DSA-65（0x7F）の両ネイティブ取引を復元ベースへ移植し、
  有効化ブロック・ゲート、方式別ガス、方式束縛の送信者保護まで実装・検証した。
- ライブ E2E は全項目合格（参照実装 23/23、移植版 45/45、本番形状の無効化確認 5/5）。
- **未検証は1件のみ**：混成ネットワークの相互運用（本番バイナリ＋新バイナリの
  混成4台構成）。この検証サンドボックスではノード間接続自体が遮断されるため
  （本番バイナリ同士でも接続不可を確認済み）実施できておらず、接続可能な環境での
  リハーサルを本番判断の前提条件とする（UPGRADE-PLAN.md §1）。

## 提出物一覧

| 文書 | 内容 |
|---|---|
| `docs/BINARY-PROVENANCE.md` | 本番バイナリの素性特定（upstream 26.9.0＋Falcon合意パッチ、JDK 25） |
| `docs/SOURCE-RECONSTRUCTION-REPORT.md` | 復元作業・等価性検証（javap一致、署名相互検証、鍵ファイル一致、ビルド成功） |
| `docs/MLDSA-REFERENCE-REPORT.md` | ML-DSA参照実装：欠陥4件の修正、単体テスト、E2E 23/23（証跡 docs/evidence/e2e-912770-mldsa-reference.json） |
| `docs/PQ-TX-PORT-MANIFEST.md` | 移植のファイル単位マニフェスト（案C除外項目、有効化ゲート設計を含む） |
| `docs/PQ-TX-PORT-REPORT.md` | 移植結果：変更ファイル一覧、ゲート／ガス設計、全テスト結果、E2E 45/45（証跡 docs/evidence/e2e-912772-port.json、無効化確認 docs/evidence/e2e-912772-nogate.json 5/5） |
| `docs/DUAL-SIGNATURE-EVALUATION.md` | 二重署名の評価提案（通常送金には非推奨：約8.5 KB/取引、両方式とも格子系） |
| `docs/UPGRADE-PLAN.md` | アップグレード手順（1台ずつ切替）、有効化ブロックの決め方、ロールバック条件・復旧手順 |
| 本書 | 全体の索引と残件 |

## 再現可能なビルド手順（移植版バイナリ）

前提成果物はすべて本ワークスペース内にあり、外部ネットワークなしで再現できる。

```
# JDK 25:      besu-912701/work/jdk-25
# Gradle 9.3.1: besu-mldsa-tx/tools/gradle-9.3.1
# 依存ミラー:   besu-mldsa-tx/tools/local-repo（オフライン用）
cd besu-912701
besu-912701/work/run-gradle-port.sh installDist
# → build/install/besu/bin/besu が生成される
```

単体テストは Gradle のテストワーカーがサンドボックス制約で動かないため、
JUnit コンソールランチャーで実行した（正確なコマンドと結果は各 REPORT に記載）。

## 必須テスト対応表（オーナー指定項目）

| 項目 | 結果 |
|---|---|
| Falcon ZNYT 送金 | ✅ E2E（912772） |
| ML-DSA ZNYT 送金 | ✅ E2E（912770 / 912772） |
| 不正署名の拒否 | ✅ 両方式（改ざんで Invalid signature） |
| 二重支払い／リプレイ防止 | ✅ 両方式（Nonce too low） |
| PQ取引によるコントラクト実行 | ✅ 作成＋store(42)＋読み戻し |
| 有効化ブロック前後の互換性 | ✅ 有効化前は全経路で拒否／ECDSA は前後不変、設定なし＝常時無効も確認 |
| PQアカウントを ECDSA で操作できないこと | ✅ 保護テスト 10/10 |
| 0x7F 形式の衝突チェック | ✅ 衝突なし |
| ブロック生成・同期・ファイナリティ（多ノード） | ⚠️ 未実施（環境制約）— リハーサル必須 |
| 既存資産・履歴の保護 | ✅ 方式束縛の送信者導出と無効化デフォルトで担保（多ノードでの最終確認はリハーサルに含む） |

## オーナー判断事項

1. 混成相互運用リハーサルをどの環境で実施するか（接続可能な別ホスト等）。
2. リハーサル合格後、本番反映の最終承認と有効化ブロックの方針。
