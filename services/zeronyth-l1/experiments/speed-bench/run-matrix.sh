#!/bin/bash
# Runs the bench matrix one config at a time; stops on RAM abort (exit 2).
cd "$(dirname "$0")"
for c in "$@"; do
  node bench.mjs "$c"; rc=$?
  if [ $rc -eq 2 ]; then echo "ABORT (RAM) at $c"; exit 2; fi
  sleep 5
done
echo MATRIX_DONE
