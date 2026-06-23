#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

PYTHON_WORKER_DIR="$ROOT_DIR/backend/ai-worker"
NODE_BACKEND_DIR="$ROOT_DIR/backend/base"
FRONTEND_DIR="$ROOT_DIR/frontend"
FRONTEND_WEB_DIR="$ROOT_DIR/frontend/web"

PIDS=()
CLEANED_UP=0

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

terminate_tree() {
  local pid="$1"
  local signal="${2:-TERM}"
  local child

  while IFS= read -r child; do
    if [ -n "$child" ]; then
      terminate_tree "$child" "$signal"
    fi
  done < <(pgrep -P "$pid" 2>/dev/null || true)

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "-$signal" "$pid" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  if [ "$CLEANED_UP" -eq 1 ]; then
    return
  fi
  CLEANED_UP=1
  trap - INT TERM EXIT

  if [ "${#PIDS[@]}" -gt 0 ]; then
    echo
    echo "Stopping dev services..."
    for pid in "${PIDS[@]}"; do
      terminate_tree "$pid" TERM
    done

    sleep 1

    for pid in "${PIDS[@]}"; do
      terminate_tree "$pid" KILL
    done

    for pid in "${PIDS[@]}"; do
      wait "$pid" >/dev/null 2>&1 || true
    done
  fi
}

install_node_deps_if_needed() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing node dependencies in $dir"
    (cd "$dir" && pnpm install)
  fi
}

ensure_port_free() {
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the existing process first." >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    exit 1
  fi
}

start_service() {
  local name="$1"
  local dir="$2"
  shift 2

  echo "Starting $name..."
  (
    cd "$dir"
    "$@"
  ) &
  PIDS+=("$!")
}

trap cleanup INT TERM EXIT

require_cmd pnpm
require_cmd uv
require_cmd lsof

install_node_deps_if_needed "$NODE_BACKEND_DIR"
install_node_deps_if_needed "$FRONTEND_DIR"
install_node_deps_if_needed "$FRONTEND_WEB_DIR"

ensure_port_free "${PYTHON_AI_WORKER_PORT:-7073}"
ensure_port_free "${BACKEND_PORT:-7072}"
ensure_port_free "${FRONTEND_PORT:-9527}"

export PYTHON_AI_WORKER_PORT="${PYTHON_AI_WORKER_PORT:-7073}"
export PYTHON_AI_WORKER_URL="${PYTHON_AI_WORKER_URL:-http://127.0.0.1:${PYTHON_AI_WORKER_PORT}}"

start_service "Python AI worker" "$PYTHON_WORKER_DIR" \
  uv run --no-project --with-requirements requirements.txt python dev_reload.py

start_service "Node backend" "$NODE_BACKEND_DIR" \
  pnpm run dev

start_service "Frontend/Electron" "$FRONTEND_DIR" \
  pnpm run dev

cat <<INFO

Dev services are starting:
  Python AI worker: http://127.0.0.1:${PYTHON_AI_WORKER_PORT:-7073}
  Node backend:     http://localhost:${BACKEND_PORT:-7072}
  Frontend:         http://localhost:${FRONTEND_PORT:-9527}/
  Automation entry: http://localhost:${FRONTEND_PORT:-9527}/app/automation

Press Ctrl+C to stop all services started by this script.
INFO

wait
