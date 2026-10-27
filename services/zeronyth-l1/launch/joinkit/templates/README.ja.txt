ZERONYTH 参加アプリ（テストネット）
====================================

■ はじめかた（ダブルクリックだけ）
  Windows … 「START.bat」をダブルクリック
  Mac     … 「START.command」をダブルクリック
            （初回だけ「開発元を確認できません」と出たら、右クリック →「開く」）
  Linux   … 「start.sh」を実行

  ブラウザに状態ページ（http://127.0.0.1:8899/）が開きます。
  止めたいときは、黒いウィンドウを閉じるだけです。

■ 安心して使うために
  ・CPU は最大 50% だけ、いちばん低い優先度で使います。
  ・バッテリー駆動中・PC が熱いとき・PC が忙しいときは自動で一時停止します。
  ・鍵（ウォレット）はこのフォルダの data/keys.json に自動で作られます。
    誰にも送らないでください。運営が鍵を聞くことは絶対にありません。
  ・必要なら Node.js（公式版）をこのフォルダの runtime/ にだけ自動ダウンロードします。
    PC 本体には何もインストールしません。フォルダを消せば完全に削除できます。

■ 報酬
  検証した仕事量に応じてテスト用 ZNYT がたまります（L1 40% / AI 30% / VPS 30%）。
  テストネットの ZNYT に現在お金としての価値はありません。

■ 接続先
  defaults.json の "server" が接続先です（通常は変更不要）。

--- English ---
Double-click START.bat (Windows) or START.command (Mac), or run start.sh (Linux).
A status page opens at http://127.0.0.1:8899/. Close the window to stop.
Uses at most 50% CPU at lowest priority; pauses on battery, heat or a busy PC.
Your keys are created locally in data/keys.json; never share them. Testnet ZNYT has no monetary value.
