#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$ROOT/../../generated-artifacts/runtime"
mkdir -p "$RUNTIME"
cd "$RUNTIME"

# Official, pinned releases. Never execute unverified downloads.
if [ ! -x besu-26.9.0/bin/besu ]; then
  curl --fail --location --retry 2 --max-time 180 \
    https://github.com/besu-eth/besu/releases/download/26.9.0/besu-26.9.0.tar.gz \
    -o besu-26.9.0.tar.gz
  printf '%s\n' '172b29069837f13436a20bd7c8234aeca67917d8a378e81e2bd4a205c57540ea  besu-26.9.0.tar.gz' | sha256sum -c -
  tar -xzf besu-26.9.0.tar.gz
fi
if [ ! -x jdk-25.0.5+8-jre/bin/java ]; then
  curl --fail --location --retry 2 --max-time 180 \
    'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz' \
    -o java25.tar.gz
  printf '%s\n' '6fac98f0c8202efc3135a9e9e42aa61963ec42d1c5cbb40caf231e7b14a24ef6  java25.tar.gz' | sha256sum -c -
  tar -xzf java25.tar.gz
fi
JAVA_HOME="$RUNTIME/jdk-25.0.5+8-jre" "$RUNTIME/besu-26.9.0/bin/besu" --version
