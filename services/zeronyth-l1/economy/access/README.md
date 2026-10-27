# 10日 ZNYT プラン（AI / コンテナ VPS）— box テストチェーン専用

**実物か模擬か**
| 項目 | 状態 |
|---|---|
| プラン購入 `subscribe(kind)`・期限 `expiry`・エスクロー・精算 | **実物**（box テストチェーン 9127 上の `ZnytEconomy`＝10日、`ZnytEconomyFastTest`＝30秒）。ZNYT は無価値のテスト通貨。live チェーンには未導入。 |
| ログイン | **実物**：ウォレットでチャレンジ文に署名（EIP-191）→ 1時間の HMAC セッション。鍵は受け取らない。 |
| AI プラン | **実物**：同じ Qwen3-4B（CPU）。プラン利用者は優先キュー・最大回答長 2 倍。学習はしていない。 |
| VPS プラン | **実コンテナ**（静的 podman 6.1.4、alpine 3.20）。ただし **cgroup 無し**のため CPU/メモリ/プロセス数の上限は効かない。代わりに rlimit（data 256MB, nofile 256, fsize 64MB）、読み取り専用ルート、tmpfs 64MB、全 capability 削除、`--network none`、1コマンド 10 秒で強制終了。`ACCESS_VPS_BACKEND=mock` にすると「[MOCK]」と明示された模擬になる。 |
| 精算の重み | コーディネーターの heartbeat × 各提供者の rentalBps / aiBps（**実際にコンテナを動かしたホストではない**：今は全部 box 上）。 |

**構成**
- `access-service.mjs` — 127.0.0.1:8805（pm2 `zeronyth-access`, `ecosystem.access.config.cjs`）。`/plans` `/accounting` `/auth/challenge` `/auth/verify` `/me` `/ai/chat` `/vps/{start,exec,status,stop}`、`/` は日本語ページ。
- `vps-backend.mjs` — podman / mock。期限切れはリーパー（10 秒毎）が停止・削除。利用記録は `/workspace/zeronyth-access/usage.jsonl`（0600）。
- `podman/` — 使っている設定とラッパーの写し。box 上の実体は `/workspace/podman`。setuid の newuidmap が無いので、`ns-holder.sh`（pm2 `zeronyth-podman-ns`）が 1 つの非特権ユーザー名前空間を保持し、`podman-in-ns.sh` が `nsenter` でそこに入る。sudo・システム変更なし。
- `demo-plans.mjs` — テスト用ウォレットを test `deployer` ロールから入金（faucet は使わない）→ 両コントラクトで購入 → ログイン → AI/VPS → 期限切れ → 精算 → 会計。
- AI の優先は `ai-chat/chat-server.mjs` の `ZERONYTH_AI_TIER_KEY_FILE`（このサービスと共有する 0600 の鍵）。公開ゲートウェイはクライアントのヘッダを転送しないので偽装不可。

外部公開はしていない（loopback のみ）。公開・live 導入には承認が必要。
