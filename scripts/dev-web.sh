#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

PYTHON_WORKER_DIR="$ROOT_DIR/backend/ai-worker"
NODE_BACKEND_DIR="$ROOT_DIR/backend/base"
FRONTEND_DIR="$ROOT_DIR/frontend"
FRONTEND_WEB_DIR="$ROOT_DIR/frontend/web"
FRONTEND_ADMIN_DIR="$ROOT_DIR/frontend/admin"

PIDS=()
CLEANED_UP=0
OPEN_BROWSER="${OPEN_BROWSER:-1}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

browser_open_cmd() {
  if command -v open >/dev/null 2>&1; then
    echo "open"
    return
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    echo "xdg-open"
    return
  fi

  return 1
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
  local bin="${2:-}"

  if [ ! -d "$dir/node_modules" ] || { [ -n "$bin" ] && [ ! -x "$dir/node_modules/.bin/$bin" ]; }; then
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

open_browser_when_ready() {
  local url="$1"
  local open_cmd="$2"

  (
    for _ in $(seq 1 60); do
      if curl -fsS "$url" >/dev/null 2>&1; then
        echo "Opening browser: $url"
        "$open_cmd" "$url" >/dev/null 2>&1 || true
        exit 0
      fi
      sleep 1
    done

    echo "Frontend did not become ready in time. Open it manually: $url" >&2
  ) &
}

trap cleanup INT TERM EXIT

require_cmd pnpm
require_cmd uv
require_cmd lsof

if [ "$OPEN_BROWSER" = "1" ]; then
  require_cmd curl
  BROWSER_OPEN_CMD="$(browser_open_cmd)" || {
    echo "Missing browser opener. Install 'open' or 'xdg-open'." >&2
    exit 1
  }
fi
install_node_deps_if_needed "$NODE_BACKEND_DIR" tsx
install_node_deps_if_needed "$FRONTEND_DIR" vite
install_node_deps_if_needed "$FRONTEND_ADMIN_DIR" vite

ensure_port_free "${PYTHON_AI_WORKER_PORT:-7073}"
ensure_port_free "${BACKEND_PORT:-7072}"
ensure_port_free "${FRONTEND_PORT:-9527}"
ensure_port_free "${FRONTEND_ADMIN_PORT:-9528}"

export PYTHON_AI_WORKER_PORT="${PYTHON_AI_WORKER_PORT:-7073}"
export PYTHON_AI_WORKER_URL="${PYTHON_AI_WORKER_URL:-http://127.0.0.1:${PYTHON_AI_WORKER_PORT}}"
start_service "Python AI worker" "$PYTHON_WORKER_DIR" \
  uv run --no-project --with-requirements requirements.txt python dev_reload.py

start_service "Node backend" "$NODE_BACKEND_DIR" \
  pnpm run dev

start_service "Frontend/Web" "$FRONTEND_WEB_DIR" \
  "$FRONTEND_DIR/node_modules/.bin/vite" --host 0.0.0.0 --port "${FRONTEND_PORT:-9527}"

start_service "Frontend admin" "$FRONTEND_ADMIN_DIR" \
  "$FRONTEND_DIR/node_modules/.bin/vite" --host 0.0.0.0 --port "${FRONTEND_ADMIN_PORT:-9528}"

if [ "$OPEN_BROWSER" = "1" ]; then
  open_browser_when_ready "http://localhost:${FRONTEND_PORT:-9527}/" "$BROWSER_OPEN_CMD"
fi

cat <<INFO

Web dev services are starting:
  Python AI worker: http://127.0.0.1:${PYTHON_AI_WORKER_PORT:-7073}
  Node backend:     http://localhost:${BACKEND_PORT:-7072}
  Frontend:         http://localhost:${FRONTEND_PORT:-9527}/
  Automation entry: http://localhost:${FRONTEND_PORT:-9527}/app/automation
  Admin:            http://localhost:${FRONTEND_PORT:-9527}/admin/

Press Ctrl+C to stop all services started by this script.
INFO

wait
