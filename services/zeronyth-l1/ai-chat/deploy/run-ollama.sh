#!/bin/sh
# ZERONYTH chat AI backend: Ollama (CPU-only), loopback only, lowest CPU/IO priority, chat model + tiny embedding model (znyt-embed, ~150 MB), 1 request at a time.
export OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=/workspace/ollama/models OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=2 \
  OLLAMA_KEEP_ALIVE=30m OLLAMA_MAX_QUEUE=8 OLLAMA_CONTEXT_LENGTH=4096 OLLAMA_NOPRUNE=1 HOME=/workspace/ollama
exec nice -n 19 ionice -c3 /workspace/ollama/dist/bin/ollama serve
