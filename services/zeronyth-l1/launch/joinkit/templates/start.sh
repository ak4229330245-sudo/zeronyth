#!/bin/bash
# ZERONYTH 参加アプリ (macOS / Linux). Uses the system Node.js if present, otherwise fetches the official Node 22 LTS into ./runtime
# (checksum-verified, nothing installed system-wide).
cd "$(dirname "$0")" || exit 1
NODE=$(command -v node || true)
if [ -z "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  NODE="$PWD/runtime/bin/node"
  if [ ! -x "$NODE" ]; then
    echo "Node.js を準備しています（初回だけ・約40MB）..."
    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64) P=darwin-arm64;; Darwin-x86_64) P=darwin-x64;; Linux-x86_64) P=linux-x64;; Linux-aarch64) P=linux-arm64;;
      *) echo "このPCの種類には未対応です: $(uname -sm)"; read -r -p "Enterで閉じる"; exit 1;;
    esac
    BASE=https://nodejs.org/dist/latest-v22.x
    LINE=$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -E "node-v[0-9.]+-$P\.tar\.gz$" | head -1) || { echo "ダウンロードに失敗しました"; exit 1; }
    SUM=${LINE%% *}; FILE=${LINE##* }; TMP=$(mktemp -d)
    curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE" || { echo "ダウンロードに失敗しました"; exit 1; }
    GOT=$( (shasum -a 256 "$TMP/$FILE" 2>/dev/null || sha256sum "$TMP/$FILE") | cut -d' ' -f1)
    [ "$GOT" = "$SUM" ] || { echo "チェックサム不一致。中止します。"; rm -rf "$TMP"; exit 1; }
    mkdir -p runtime && tar xzf "$TMP/$FILE" -C runtime --strip-components=1 && rm -rf "$TMP"
  fi
fi
echo "ZERONYTH 参加アプリを起動します。ブラウザに状態ページが開きます。このウィンドウを閉じると停止します。"
exec nice -n 19 "$NODE" app/zeronyth-participant.mjs
