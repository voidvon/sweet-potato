#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${PROJECT_ROOT}/plugins/remotion-video"
OUTPUT_FILE="${PROJECT_ROOT}/backend/internal/pluginruntime/remotion-plugin-source.tar.gz"

tar -czf "${OUTPUT_FILE}" \
  -C "${PROJECT_ROOT}/plugins" \
  --exclude='remotion-video/node_modules' \
  --exclude='remotion-video/renders' \
  --exclude='remotion-video/.git' \
  remotion-video/package.json \
  remotion-video/bun.lock \
  remotion-video/remotion.config.ts \
  remotion-video/tsconfig.json \
  remotion-video/server \
  remotion-video/src

echo "Embedded Remotion plugin source prepared at ${OUTPUT_FILE}"
