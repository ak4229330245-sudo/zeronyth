#!/bin/sh
# ZERONYTH nightly LoRA pipeline (pm2 zeronyth-ai-finetune, cron 03:30 JST, autorestart off).
# prepare -> LoRA train (nice 19, ionice idle, timeout, memory watchdog) -> merge -> GGUF -> Ollama candidate -> A/B -> promote?
# Skips when the box is short on memory, the chat is busy, or the training data did not change. Never touches Besu.
#   nightly.sh [--force] [--steps N]
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); AI=$(dirname "$HERE"); TRAIN=${ZERONYTH_AI_TRAIN:-/workspace/ai-train}
BASE=${ZERONYTH_FT_BASE:-$TRAIN/base/Qwen2.5-0.5B-Instruct}; PY=$TRAIN/venv/bin/python; OLLAMA=/workspace/ollama/dist/bin/ollama
STEPS=${ZERONYTH_FT_STEPS:-60}; FORCE=0; MIN_AVAIL=${ZERONYTH_FT_MIN_AVAIL_MB:-3500}
while [ $# -gt 0 ]; do case "$1" in --force) FORCE=1;; --steps) STEPS=$2; shift;; esac; shift; done
export ZERONYTH_AI_DATA=${ZERONYTH_AI_DATA:-$AI/data}
# pm2 also starts cron apps once at `pm2 start`; only train inside the night window (03:00-05:59 JST) unless --force.
H=$(TZ=Asia/Tokyo date +%H); if [ "$FORCE" = 0 ] && { [ "$H" -lt 3 ] || [ "$H" -gt 5 ]; }; then echo "skip: outside the 03:00-05:59 JST window"; exit 0; fi
mkdir -p "$TRAIN/runs"; exec 9>"$TRAIN/runs/.lock"; flock -n 9 || { echo "another fine-tune is running"; exit 0; }
status() { node -e "const f=process.argv[1];const fs=require('fs');let s={};try{s=JSON.parse(fs.readFileSync(f))}catch{};s.fineTune={...(s.fineTune||{}),at:new Date().toISOString(),result:process.argv[2]};fs.writeFileSync(f+'.t',JSON.stringify(s,null,1),{mode:0o644});fs.renameSync(f+'.t',f)" "$ZERONYTH_AI_DATA/learned/status.json" "$1"; }
avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
if [ "$avail" -lt "$MIN_AVAIL" ]; then echo "skip: MemAvailable ${avail}MB < ${MIN_AVAIL}MB (Besu has priority)"; status "見送り（メモリ不足）"; exit 0; fi
if curl -s --max-time 3 127.0.0.1:9803/status | grep -q '"busy":true'; then echo "skip: chat busy"; status "見送り（チャット使用中）"; exit 0; fi
TS=$(date +%Y%m%d-%H%M); RUN=$TRAIN/runs/$TS; mkdir -p "$RUN"
node "$HERE/prepare.mjs" "$RUN/sft.jsonl" 2> "$RUN/prepare.json"; cat "$RUN/prepare.json"
HASH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUN/prepare.json')).hash)")
if [ "$FORCE" = 0 ] && [ -f "$TRAIN/runs/last-hash" ] && [ "$(cat "$TRAIN/runs/last-hash")" = "$HASH" ]; then echo "skip: training data unchanged"; rm -rf "$RUN"; status "見送り（新しい学習データなし）"; exit 0; fi
echo "train: $STEPS steps on $(basename "$BASE")"
if ! nice -n 19 ionice -c3 timeout 45m "$PY" "$HERE/train_lora.py" --base "$BASE" --data "$RUN/sft.jsonl" --out "$RUN" --max-steps "$STEPS" --max-minutes 30 --threads 2 --mem-floor-mb 1200 --rss-max-mb 3200; then
  echo "train failed/aborted"; status "中止（学習が上限で停止）"; rm -rf "$RUN/merged"; exit 0; fi
nice -n 19 "$PY" -c "import sys,runpy;sys.path[:0]=['$TRAIN/conv/lc','$TRAIN/conv/lc/gguf-py'];sys.argv=['c','$RUN/merged','--outtype','q8_0','--outfile','$RUN/cand.gguf'];runpy.run_path('$TRAIN/conv/lc/convert_hf_to_gguf.py',run_name='__main__')" > "$RUN/convert.log" 2>&1
rm -rf "$RUN/merged"
CAND="znyt-cand-$TS"; printf 'FROM %s\n' "$RUN/cand.gguf" > "$RUN/Modelfile"
OLLAMA_HOST=127.0.0.1:11434 HOME=/workspace/ollama nice -n 19 "$OLLAMA" create "$CAND" -f "$RUN/Modelfile" > /dev/null 2>&1
rm -f "$RUN/cand.gguf"   # Ollama keeps its own copy of the weights
nice -n 19 node "$HERE/ab.mjs" "$CAND" "$(basename "$BASE") + ZERONYTH LoRA $TS (Q8_0)" "$RUN"
echo "$HASH" > "$TRAIN/runs/last-hash"
ls -1d "$TRAIN"/runs/2* 2>/dev/null | head -n -5 | xargs -r rm -rf   # keep the last 5 run reports
