# ZERONYTH Quantum Wallet — セキュリティモデル / Security Model

この文書は Quantum Wallet（v12）のセキュリティモデルを、実装されている通りに正直に説明するものです。「絶対に安全」という主張はしません。ウェブウォレットである以上、原理的に守れない範囲が存在し、それも明記します。

## 守るもの・守り方（実装済み）

### 鍵の保管
- 秘密鍵・シードはブラウザの `localStorage` に **暗号化された金庫（vault）** としてのみ保存されます。暗号化は PBKDF2-SHA256（600,000回）でパスワードから鍵を導出し、AES-256-GCM で認証付き暗号化します。
- 新規ウォレットは 32 バイトのマスターシード 1 つから全アカウントを決定論的に導出します（keccak KDF、用途別ドメイン分離 `ZERONYTH/WALLET/V2/{MLDSA,FALCON,ECDSA,SOLANA,SUI,APTOS,XRP,BTC}`）。復旧フレーズはこのシードを BIP39 単語リストで符号化したもので、**このウォレット専用**です。他のウォレットアプリとは互換性がありません。
- BTC と XRP の鍵は EVM の鍵とは別ドメインで導出され、使い回しはしません。

### パスワードとロック
- パスワードは **メモリ上だけ** に存在します。ストレージには一切保存されません（過去バージョンの「ログイン状態を保持」機能は廃止し、起動時に旧キーも消去します）。
- リロード／タブを閉じるとロックされます。さらに **アイドル自動ロック**（初期値 5 分、1/5/15 分に変更可、タブが 1 分以上非表示でもロック）が有効です。
- ロック解除の失敗には **段階的なバックオフ** がかかります（3 回失敗以降 5 秒→10 秒→…最大 300 秒）。これは総当たりの速度を落とす「速度制限」であり、暗号強度そのものを上げるものではありません。

### 耐量子署名（ZERONYTH チェーン上）
- ZERONYTH（Chain 912701）では ECDSA / Falcon-1024 / ML-DSA-65 の 3 方式が使えます。PQ アカウント（Falcon / ML-DSA）のアドレスは PQ 公開鍵から導出され、**ECDSA では絶対に操作できません**（方式に紐付いた送信者導出、フォールバックなし）。
- PQ 署名は ZERONYTH 上でのみ有効です。他ネットワークでは PQ アカウントは UI でもセッション層でも送金不可にゲートされています。

### マルチチェーンの署名安全
- 送金前に接続先 RPC の `chainId` を必ず検証し、不一致なら署名しません。署名は EIP-155 で対象チェーンに束縛されます。
- 送金レビュー画面ではネットワーク名・チェーン ID・**宛先アドレス全文**・金額・手数料（資産単位）を表示します。初回送金先には警告と明示的な確認チェック、コントラクト宛には別途警告を出します。
- Solana のスワップ（Jupiter）は、外部が組み立てたトランザクションを検証なしに署名することはしません。この検証を実装できないため、v12 では **提供しません**。

### クリップボード
- コピーしたアドレスは 30 秒後に自動消去します（クリップボードの中身がコピーしたものと完全一致する場合のみ。他のものを消すことはありません）。

### カスタム RPC
- ネットワークごとに RPC を変更できます。悪意のある RPC は残高や履歴を偽って表示できますが、**鍵を盗むことはできません**（署名は端末内で行われます）。

### バックアップ
- 暗号化バックアップのエクスポートには独立したバックアップ用パスワード（12 文字以上）を使います。バックアップファイルはオフラインで攻撃され得るため、推測されにくいパスワードを選んでください。

## 守れないもの（正直な限界）

- **端末自体が侵害されている場合**（マルウェア、キーロガー、画面の盗み見）：パスワード入力も署名も端末上で行われるため、ウェブウォレットでは防げません。
- **フィッシング**：偽サイトにパスワードや復旧フレーズを入力してしまえば、金庫は開きます。公式の接続先は **https://zeronyth.dpdns.org だけ** です。URL を必ず確認してください。復旧フレーズを他人に教えることは絶対にありません（運営・開発者が尋ねることもありません）。
- **アンロック中のセッション**：ロック解除中は復号された金庫がメモリ内にあります。その間に端末を他人に使われれば操作されます。自動ロックは緩和策です。
- **バックオフの限界**：失敗回数カウンタはストレージにあります。ストレージを直接触れる攻撃者はカウンタを消去できます。バックオフは偶発的・機械的な総当たりへの速度制限に過ぎません。金庫の強さはパスワードの強さと PBKDF2 の計算コストで決まります。
- **表示の信頼性**：画面に表示される残高・履歴は接続先 RPC の回答に依存します。検証が必要な場合はブロックエクスプローラ等、独立した情報源と照合してください。
- **ソフトウェアの成熟度**：本ウォレットは未監査のソフトウェアです。外部セキュリティ監査は未実施です（監査範囲文書は別途整備中）。ZNYT に金銭的価値はありませんが、他チェーンの実資産をこのウォレットで扱う場合は、まず少額で試してください。

## 脆弱性の報告

問題を見つけた場合は、公開の場に詳細を書く前にプロジェクトオーナーへ連絡してください。再現手順と影響範囲があると助かります。

---

# Security Model (English)

This document describes the Quantum Wallet (v12) security model exactly as implemented. It makes no claim of absolute security: as a web wallet there are things it fundamentally cannot protect against, and those are stated plainly.

## What is protected, and how (implemented)

### Key storage
- Secret keys and seeds exist in the browser only as an **encrypted vault** in `localStorage`: PBKDF2-SHA256 (600,000 iterations) derives the key from the wallet password; AES-256-GCM provides authenticated encryption.
- New wallets derive every account deterministically from one 32-byte master seed (keccak KDF, domain-separated: `ZERONYTH/WALLET/V2/{MLDSA,FALCON,ECDSA,SOLANA,SUI,APTOS,XRP,BTC}`). The recovery phrase is a BIP39-wordlist encoding of that seed and is **specific to this wallet**; it is not compatible with other wallet apps.
- BTC and XRP keys are derived under separate domains and are never reused from the EVM key.

### Password and locking
- The password exists **only in memory**. It is never persisted (the old stay-unlocked feature was removed, and its legacy storage key is scrubbed at startup).
- Reloading or closing the tab locks the wallet. **Idle auto-lock** (default 5 minutes; 1/5/15 selectable; also after the tab is hidden for over a minute) is on by default.
- Failed unlock attempts trigger **escalating backoff** (from the 3rd failure: 5 s, 10 s, … up to 300 s). This is a speed bump against guessing, not an increase in cryptographic strength.

### Post-quantum signatures (on ZERONYTH)
- On ZERONYTH (chain 912701), ECDSA, Falcon-1024 and ML-DSA-65 coexist. PQ account addresses are derived from the PQ public key and **can never be operated via ECDSA** (scheme-bound sender derivation, no fallback).
- PQ accounts are gated to ZERONYTH in both the UI and the session layer; they cannot send on any other network.

### Multi-chain signing safety
- Before signing, the RPC's `chainId` is verified; a mismatch aborts the send. Signatures are EIP-155-bound to the intended chain.
- The review screen shows the network name, chain ID, the **full recipient address**, amount, and fee in asset units. First-time recipients require an explicit acknowledgement checkbox; contract recipients get a separate warning.
- Solana swaps via Jupiter are **not offered in v12**: the wallet will not blind-sign externally constructed transactions, and a defensible pre-sign validation was not implemented.

### Clipboard
- Copied addresses are cleared after 30 s — only if the clipboard still contains exactly what was copied (user content copied afterwards is never clobbered).

### Custom RPC endpoints
- RPC URLs can be changed per network. A malicious RPC can lie about balances and history, but **cannot steal keys** — signing happens on this device.

### Backups
- Encrypted backup export uses a separate backup password (minimum 12 characters). A backup file can be attacked offline; choose a hard-to-guess password.

## What cannot be protected (honest limits)

- **A compromised device** (malware, keyloggers, screen capture): password entry and signing happen on the device; no web wallet can defend against this.
- **Phishing**: if you type your password or recovery phrase into a fake site, the vault opens. The only official origin is **https://zeronyth.dpdns.org** — always check the URL. No one from the project will ever ask for your phrase.
- **An unlocked session**: while unlocked, the decrypted vault is in memory. Anyone using your device in that window can operate the wallet. Auto-lock mitigates, not eliminates.
- **Backoff limits**: the failure counter lives in storage; an attacker who can write storage can erase it. Backoff is purely a rate limit. Vault strength rests on password strength and the PBKDF2 work factor.
- **Display trust**: balances and history shown are whatever the connected RPC answers. For verification, cross-check with an independent source such as a block explorer.
- **Maturity**: this wallet is unaudited software; no external security audit has been performed yet (an audit-scope document is being prepared separately). ZNYT has no monetary value, but if you use this wallet for real assets on other chains, start with small amounts.

## Reporting

If you find a problem, contact the project owner before posting details publicly. Reproduction steps and an impact assessment help most.
