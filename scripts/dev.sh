#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

case "${1:-}" in
  ""|--web)
    cd "${ROOT_DIR}/frontend"
    exec pnpm run dev
    ;;
  --electron)
    cd "${ROOT_DIR}/frontend"
    exec pnpm run dev:electron
    ;;
  *)
    echo "Usage: scripts/dev.sh [--web|--electron]" >&2
    exit 2
    ;;
esac
