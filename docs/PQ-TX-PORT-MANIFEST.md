<!-- Published copy of the project engineering record. Internal workspace paths were rewritten to this repository's layout (besu-912701/ = reconstructed production source tree, docs/ = deliverables). -->

# PQネイティブ取引の本番ベース移植マニフェスト

作成日: 2026-11-05
目的: 復元済み本番ベース（`besu-912701/` = upstream Besu 26.9.0 +
Falcon合意パッチのみ）へ、Falcon-1024 ネイティブ取引（0x7E）と ML-DSA-65 ネイティブ取引
（0x7F）を移植する際の、ファイル単位の作業指示。**まだ適用しない。**
適用は「本番バイナリとの混成相互運用テストで復元ベースの等価性が証明された後」に行う
（先に取引コードを入れると等価性証明が汚染されるため）。

## 1. 現状（実測 2026-11-05）

| ツリー | Falcon取引 | ML-DSA取引 | Transaction.java のPQフィールド |
|---|---|---|---|
| 復元ベース R | なし | なし | なし（原形） |
| 案Cツリー A（`besu-falcon/`） | あり（未検証） | あり（tarball由来） | 両方あり（各14参照） |
| ML-DSA参照ツリー T（`besu-mldsa-tx/`） | なし | あり（検証中・修正済み） | ML-DSAのみ |

## 2. 移植元ファイル

### Falcon-1024 取引（A から）
- `crypto/algorithms/.../Falcon1024TransactionCrypto.java`（新規）
- `ethereum/core/.../encoding/FalconTransactionEncoder.java` / `FalconTransactionDecoder.java`（新規）
- `crypto/algorithms/src/test/.../Falcon1024TransactionCryptoTest.java`（新規・要実行検証）

### ML-DSA-65 取引（T から、参照実装の検証完了後の版を使う）
- `crypto/algorithms/.../MlDsa65TransactionCrypto.java`
- `ethereum/core/.../encoding/MlDsaTransactionEncoder.java` / `MlDsaTransactionDecoder.java`
- T で加えた修正一式（MainnetTransactionValidator の受付検証、Transaction、デコーダ、
  MlDsaTransactionTest 等）— T の REPORT.md の変更ファイル一覧が正

### 共通の変更（A の Transaction.java を土台に、T の修正と突き合わせて統合）
- `datatypes/.../TransactionType.java`：FALCON1024(0x7E) と MLDSA65(0x7F) を追加
- `ethereum/core/.../Transaction.java`：両方式のフィールド・送信者復元・signAndBuild
- `ethereum/core/.../encoding/TransactionEncoder.java` / `TransactionDecoder.java`：両方式を登録
- `ethereum/core/.../MainnetProtocolSpecs.java`：受付タイプ集合に両方式を追加
  （ただし有効化ゲートと組み合わせること。下記4参照）
- `ethereum/eth/.../PendingTransaction.java`、`ethereum/api/.../TransactionBaseResult.java`

## 3. A から持ち込まないもの（明示的に除外）

- `MlDsa65Consensus*`、`MlDsaConsensus`、`PqConsensus`（合意を ML-DSA に替える案Cの中核。
  オーナー指示で不採用が確定）
- PQ-only ゲート（`PqOnlyTransactions` と MainnetTransactionValidator の該当ハンク。
  ECDSA との共存仕様に反する）
- `mldsa65consensus` ジェネシス設定

## 4. 新規に作るもの：有効化ブロック・ゲート

どちらのツリーも「常時有効」実装のため、本番向けに以下を新規実装する。

- ジェネシス設定 `pqTxActivationBlock`（未設定 = 無効のまま）
- 有効化ブロック未満では 0x7E / 0x7F を、TxPool 受付・`eth_sendRawTransaction`・
  ブロック取り込み検証の3経路すべてで拒否する
- 有効化前後で既存（ECDSA）取引と Falcon 合意の挙動が変わらないことを
  互換性テストで確認する（オーナー必須テスト）

## 5. 方式別ガス／DoS（統合時に実装）

- 固有ガスに、公開鍵＋署名のバイト単価と検証コスト分を方式別に上乗せする
  （Falcon: 鍵1,793B＋署名最大約1,462B／ML-DSA: 鍵1,952B＋署名3,309B）
- TxPool に方式別の検証上限（単位時間あたりの検証回数）とサイズ上限を設ける

## 6. PQアカウント保護の確認点

- 送信者導出は方式ごとに束縛され、ECDSA 署名では PQ アカウントの送信者になれない
  ことを、統合テストで明示的に検証する（方式偽装取引の拒否を含む）
