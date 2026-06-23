#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

BACKEND_DIR="$ROOT_DIR/backend/base"
FRONTEND_DIR="$ROOT_DIR/frontend"
FRONTEND_WEB_DIR="$ROOT_DIR/frontend/web"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

install_node_deps_if_needed() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing node dependencies in $dir"
    (
      cd "$dir"
      pnpm install
    )
  fi
}

detect_build_script() {
  local arch
  arch="$(uname -m)"

  case "$arch" in
    arm64|aarch64)
      echo "build-electron-m-arm64"
      ;;
    x86_64|amd64)
      echo "build-electron-m"
      ;;
    *)
      echo "Unsupported macOS architecture: $arch" >&2
      exit 1
      ;;
  esac
}

main() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This packaging command currently only supports macOS." >&2
    exit 1
  fi

  require_cmd pnpm

  install_node_deps_if_needed "$BACKEND_DIR"
  install_node_deps_if_needed "$FRONTEND_DIR"
  install_node_deps_if_needed "$FRONTEND_WEB_DIR"

  local build_script
  build_script="$(detect_build_script)"

  echo "Packaging desktop app for macOS ($(uname -m)) with pnpm run $build_script"
  (
    cd "$FRONTEND_DIR"
    pnpm run "$build_script"
  )

  echo "Packaging finished. Artifacts: $FRONTEND_DIR/out"
}

main "$@"
