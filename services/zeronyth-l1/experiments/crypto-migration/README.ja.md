# ZERONYTH 暗号移行実験

## 範囲と結論

稼働中の Besu 26.9.0 / QBFT / chain ID 9127 は変更していない。
ML-DSA の実験はこのディレクトリと既存の `pq-native/` 内で行い、
別 chain ID 19127・毎回生成する使い捨て鍵・インメモリ状態を使用する。
実際の ZNYT 送金、バリデーター鍵の交換、Besu の改造、公開 RPC 化は行っていない。

ML-DSA は署名方式であり、暗号化・鍵交換方式ではない。
署名だけを置き換えてもネットワーク全体の耐量子化にはならない。
OpenSSL の機能を利用しており、この実装の FIPS 認証や独立した暗号監査は主張しない。

## 1. 4ノードのバックアップ

今回の保存先:
`generated-artifacts/private-backups/20261025T213503159473Z/`

停止中の `services/zeronyth-l1/` を保存した。4つのノードDB・鍵、genesis、
static peers、生成時の networkFiles、設定、起動スクリプト、`.env` を含む。
`node_modules` と外部 Java/Besu ランタイムは対象外であり、復元先では
元の REPLIT.md に従ってランタイムと依存パッケージを準備する。
今回追加した実験コードはバックアップ作成後の変更なので、その時点のアーカイブには含まれない。

- `zeronyth-offline.tar.gz` と `manifest.json` を作成。
- アーカイブ SHA-256 と325ファイルのハッシュを照合。
- 別の空ディレクトリへ4ノード分を復元し、全ファイルのハッシュを再照合。
- 復元した1ノードのDBを、P2Pを無効にして別RPCポートで開いた。
- 保存前ブロックのハッシュ・stateRoot・4バリデーター一覧が一致。
- 元の4ノードは鍵・履歴を保持して再開し、3ピアとブロック高の進行を確認。
- 4ノードすべての復元後の合意再開を検証した災害復旧演習ではない。

**重要:** このバックアップは未暗号化。親ディレクトリ700、ファイル600で制限している。
秘密鍵と環境設定を含むため、HTTP配信・公開Library・Git・公開成果物には含めない。
同じワークスペース内のコピーなので、ワークスペース削除や同一ストレージの消失には備えられない。
外部保管する場合は暗号化し、復号鍵を別経路で管理する必要がある。
SHA-256 は整合性確認であり、改ざん者に対する署名・認証の代わりではない。

### 再実行

ワークスペースルートから、まず稼働中に公開情報だけを取得する:

```sh
node services/zeronyth-l1/experiments/crypto-migration/capture-state.mjs \
  > generated-artifacts/crypto-migration/pre-stop.json
```

その後 Replit の `artifacts/zeronyth: web` を停止する。停止を確認して:

```sh
python3 services/zeronyth-l1/scripts/backup-replit.py \
  --evidence generated-artifacts/crypto-migration/pre-stop.json
```

終わったら同じワークフローを開始する。バックアップ中に並行起動しないこと。
スクリプトはノードが動いている場合に拒否する。既存データを削除する操作はない。

復元はオフラインで、空の別ディレクトリへ:

```sh
python3 services/zeronyth-l1/scripts/restore-replit.py \
  generated-artifacts/private-backups/20261025T213503159473Z \
  generated-artifacts/private-restores/manual-check
```

空でない復元先、破損アーカイブ、ハッシュ不一致、不正なパスやリンクは拒否する。
失敗時には不完全な復元先を起動せず、元のネットワークも上書きしない。
復元データを本番の保存先へ切り替える操作は自動実行しない。

## 2. 現在使われている暗号

### EVM トランザクション

- 通常のアカウント署名は ECDSA / secp256k1。
- 署名前のトランザクション・エンコードを Keccak-256 でハッシュする。
  Keccak-256 は NIST SHA3-256 と同一ではない。
- 署名は r / s / recovery parity。Ethereum の復元可能署名表現は65バイト。
  実際の tx エンコードは legacy の v,r,s、type-2 の yParity,r,s などで異なる。
- EIP-155 / type-2 の chain ID によるリプレイ防止を含む。
- オフラインで通常の legacy / type-2 の署名・シリアライズ・送信者復元を実測テストした。
- ML-DSA の公開鍵・署名をそのまま r,s,v に置き換えることはできない。

### バリデーター / QBFT

- 現在は4バリデーター。確定には3署名が必要で、最大1ノードの障害を許容する。
- 実ブロックの extraData をRLPデコードし、65バイトのcommit sealを3つ確認。
- Besu 26.9.0 の BftBlockHashing と同じ、commit sealsを除くヘッダーの
  Keccak-256 を計算し、secp256k1 ECDSAで3署名者を復元。
  全署名者が現在のバリデーター一覧に含まれることを確認した。
- ML-DSA は現在の Besu / QBFT には接続していない。

### ノード間通信

- 現在は loopback TCP / RLPx、static peers。ディスカバリーは無効。
- ノードID / enode は secp256k1 公開鍵。起動設定ではノード秘密鍵が
  バリデーターの署名にも使用される。
- RLPx handshake: secp256k1 ECDH / ECIES、concat KDF、
  AES-128-CTR、HMAC-SHA256、ECDSA認証。
- フレーム: AES-256-CTR と Keccak ベースのMAC。
- これはプロトコル仕様と該当版の実装・起動設定からの調査結果。
  パケットを採取・復号したわけではない。
- ECDH は耐量子鍵交換ではない。ML-DSA署名を追加してもこの点は解消しない。
- ダッシュボード向けWebRTC signalingはBesuの合意ネットワークではない。
  ブラウザー側のDTLS/SRTP接続まで耐量子化したという主張はしない。

## 3. 独立ML-DSA実装とテスト

Node.js 24.22.1 / OpenSSL 3.5.9 の `node:crypto` を使い、
ML-DSA-44 / 65 / 87 で実際に鍵生成・署名・検証・DERインポートを実行。
ML-DSA-65 の送金・提案署名・投票は既存の `pq-native/pq.mjs` を再利用した。
独自の格子暗号プリミティブを新規実装していない。

テスト対象:

- 正常署名、改ざんメッセージ・署名・異なる鍵の拒否、PKCS8/SPKI往復。
- 普通の EIP-155 / type-2 は引き続きオフライン署名・復元可能。
- ML-DSAの独自JSON tx はEthereum raw txとして受理されない。
- ECDSA / Ed25519 / 異なるML-DSAパラメーターへの暗黙フォールバックを拒否。
- 19127から9127へのクロスチェーンリプレイ、nonce再利用を拒否。
- インメモリ4レプリカで3/4票の送金が同一残高を確定。
- 2/4票・重複票・偽造票・異なるラウンドの票は拒否。

`rotation.mjs` は別の実験用レジストリ:

- account / validator の両ロールについて ML-DSA-only と hybrid-AND をテスト。
- hybrid は ECDSA **かつ** ML-DSA。片方だけでは承認しない。
- chain ID、ロール、ポリシー、安定ID、epoch、nonce、操作ハッシュを署名に含める。
- 鍵更新は旧ML-DSA鍵による承認と新鍵の所有証明を両方要求する。
  hybridではさらに登録済みECDSA鍵の承認を要求する。
- 高さ5での切り替えを例に、直前では旧鍵のみ有効、切り替え後は新鍵のみ有効。
- 更新nonceの再利用、別ポリシー・ロール・チェーン、過去のactivation height、
  同一鍵更新、更新の重複予約、不正proofを拒否し、拒否時に状態を変更しない。
- この安定IDは `lab_…`。Ethereumアドレスでも既存 `qspq_…` アドレスでもない。
  既存の鍵由来アドレスは鍵を変えると別アドレスになる。
- validatorロールの鍵承認をテストしたが、実Besuの委員会更新は行っていない。
  新旧委員会の境界、再起動後のepoch保存、混在バージョン合意は未検証。

```sh
node --test services/zeronyth-l1/experiments/crypto-migration/compatibility.test.mjs \
  services/zeronyth-l1/pq-native/test.mjs
python3 services/zeronyth-l1/experiments/crypto-migration/backup.test.py
node services/zeronyth-l1/experiments/crypto-migration/benchmark.mjs 200
```

## 4. 実際に組み込む場合の変更範囲

### A. アプリ / スマートアカウントによる追加認証

Besuの合意方式を変えず、コントラクトのアカウント認証としてML-DSAを要求する案。
ERC-4337 等を選ぶなら EntryPoint、bundler、wallet、paymaster を別途整備する。
監査済みML-DSA verifier、公開鍵レジストリ、正規化された署名対象、nonce、
有効期限、ガス上限、復旧・guardian・session key を含む全認可経路を設計する。
既存 `contracts/QuantumAccount.sol` は鍵ハッシュの記録と復旧の例であり、
ML-DSA署名検証は実装していない。鍵ハッシュを保存しただけでは耐量子送金にならない。
外部サーバーの「検証済み」という返答だけを無条件に信頼する方式は避ける。
独自precompileを追加する場合は、この案でもクライアントの全ノード更新が必要。

### B. ネイティブ EVM トランザクション署名

新しいEIP-2718 transaction type / scheme ID、公開鍵やkey IDを持つエンコード、
送信者アドレス・鍵登録の規則、署名・nonce・replay検証、gas / サイズ上限、
tx pool・p2p伝搬・RPC・receipts・indexer・wallet・署名機器・SDKが変更対象。
ML-DSAにはECDSAと同じ公開鍵復元がないため、recoverAddress前提を置換する。
Besuの TransactionDecoder、署名型、トランザクション検証、送信者取得、
実行経路・precompileなどにバージョン境界とテストが必要。
legacy txと過去ブロックは旧方式で検証し、新方式を全ノード同じ高さで有効化する。
「既存鍵やアドレスを維持したまま署名だけ交換」はできない。
現在のプレビュー `/rpc` は読み取り専用なので、実送信を提供する場合は
RPC公開方針、認証、rate limit、ガス制限も別途設計する。

### C. QBFT署名・バリデーター検証

合意メッセージとproposal / commit署名、BftExtraData / QBFTの固定長ECDSA seals、
SignatureAlgorithmFactory、検証者取得、鍵ID・公開鍵レジストリを変更する。
4ノードすべてで同じ切替高さ・同じ署名対象・同じ新旧方式ポリシーが必要。
旧履歴の検証は残す。新方式では署名長、ブロックサイズ、CPU予算を制限する。
鍵更新には旧新鍵の証明に加え、委員会のquorum承認、epoch境界、永続的な
失効情報、二重署名防止、オフラインノードの追従、ロールバック対策が必要。
3/4 quorum自体は暗号の交換だけで弱めない。mixed quorumの二重計数を防ぐ。
実験用レジストリだけではこれらの合意プロトコル要件を満たしていない。

### D. ノード間通信

RLPx handshake / 認証 / node ID / enode形式、peer許可リスト、
capability交渉、メッセージサイズ、DoS制限を検討する。
静的なsecp256k1 enodeだけでML-DSAを表現することはできない。
機密性も守るならML-KEM等の鍵交換を別途検討し、
必要に応じて従来ECDHとのハイブリッド鍵交換とダウングレード防止を設計する。
古いpeerとの接続を残す範囲と「耐量子接続」の保証範囲を分ける。

## 5. 性能と鍵管理の判断

実測値は付属HTML・`benchmark.json`。1操作ごとのCPUマイクロベンチマークで、
256バイトのメッセージ、10回warmup、鍵生成30回、署名・検証各200回。
同じホスト上で4ノードも動いているため、負荷と乱数により値は変動する。
Ethereum側のethers/JavaScriptとML-DSA側のOpenSSLを単純比較して
暗号方式の優劣やBesuの速度を断定しない。native ECDSA+SHA256も併記したが
それはEthereumのKeccak署名パイプラインではない。

ML-DSA-65の署名は3309バイト、公開鍵rawは1952バイト。
ECDSAの復元可能65バイト署名に対して約50.9倍。
3票の署名だけで195 → 9927バイト。公開鍵、key ID、ヘッダー、
転送形式、再送などの追加コストは別途必要。
今回の独自PQ JSON txは7231バイト、通常legacy EVM raw tx例は99バイトだが、
形式・チェーン・意味が同一ではなく、同等gasや帯域の比較ではない。

鍵管理ではraw FIPS鍵とSPKI/PKCS8の区別、OID・algorithmチェック、
暗号化保管、外部バックアップ、別管理の復号鍵、HSM対応を検討する。
JavaScriptのGC上の鍵の完全消去は保証しない。
旧鍵を紛失した場合のguardian recovery、鍵流出時の緊急失効やキャンセル、
hardware wallet、別実装間の相互運用性、NIST ACVPベクトルによる検証は未実施。
OpenSSL round-trip成功はこれらの検証の代わりではない。
鍵流出後、攻撃者も旧鍵で新しい鍵の更新を承認できるため、
旧新鍵proofだけでは復旧・防御ポリシーが完成しない。

## 一次資料

- NIST FIPS 204: https://csrc.nist.gov/pubs/fips/204/final
- FIPS本文: https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf
- Node crypto: https://nodejs.org/api/crypto.html
- QBFT仕様説明: https://besu.hyperledger.org/private-networks/how-to/configure/consensus/qbft
- RLPx仕様: https://github.com/ethereum/devp2p/blob/master/rlpx.md
- EIP-155: https://eips.ethereum.org/EIPS/eip-155
- EIP-2718: https://eips.ethereum.org/EIPS/eip-2718
- EIP-1559: https://eips.ethereum.org/EIPS/eip-1559
- Besu 26.9.0 SignatureAlgorithmFactory:
  https://github.com/besu-eth/besu/blob/26.9.0/crypto/algorithms/src/main/java/org/hyperledger/besu/crypto/SignatureAlgorithmFactory.java
- Besu 26.9.0 BftBlockHashing:
  https://github.com/besu-eth/besu/blob/26.9.0/consensus/common/src/main/java/org/hyperledger/besu/consensus/common/bft/BftBlockHashing.java
- Besu 26.9.0 QbftExtraDataCodec:
  https://github.com/besu-eth/besu/blob/26.9.0/consensus/qbft/src/main/java/org/hyperledger/besu/consensus/qbft/QbftExtraDataCodec.java
- Besu 26.9.0 RLPx Framer:
  https://github.com/besu-eth/besu/blob/26.9.0/ethereum/p2p/src/main/java/org/hyperledger/besu/ethereum/p2p/rlpx/framing/Framer.java
