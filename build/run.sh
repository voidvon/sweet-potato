#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

WEB_PORT="${WEB_PORT:-5689}"
BASE_PORT="${PORT:-7072}"
AI_WORKER_PORT="${PYTHON_AI_WORKER_PORT:-7073}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "请先安装 $1" >&2
    exit 1
  fi
}

load_env_file() {
  [ -f "$1" ] || return 0

  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="$(printf '%s' "$raw_line" | sed 's/\r$//')"
    case "$line" in
      ''|'#'*)
        continue
        ;;
      *=*)
        key="$(printf '%s' "${line%%=*}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        value="$(printf '%s' "${line#*=}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        value="$(printf '%s' "$value" | sed "s/^['\"]//; s/['\"]$//")"
        case "$key" in
          ''|*[!A-Za-z0-9_]*|[0-9]*)
            continue
            ;;
        esac
        export "$key=$value"
        ;;
    esac
  done < "$1"
}

pnpm_cmd() {
  COREPACK_ENABLE_PROJECT_SPEC=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true pnpm "$@"
}

check_port() {
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $1 已被占用，请先关闭占用该端口的进程后再运行 sh run.sh" >&2
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >&2 || true
    exit 1
  fi
}

need_cmd node
need_cmd pnpm

PYTHON_BIN="${PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
        PYTHON_BIN="$candidate"
        break
      fi
    fi
  done
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "请先安装 Python 3.10 或更高版本" >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/data" "$ROOT_DIR/logs" "$ROOT_DIR/videodata"

if [ -d "$ROOT_DIR/base/node_modules" ] && ! find "$ROOT_DIR/base/node_modules/.pnpm" -path '*/better-sqlite3*/build/Release/better_sqlite3.node' -print -quit 2>/dev/null | grep -q .; then
  rm -rf "$ROOT_DIR/base/node_modules"
fi

if [ ! -d "$ROOT_DIR/base/node_modules" ]; then
  (cd "$ROOT_DIR/base" && pnpm_cmd install --prod --no-frozen-lockfile)
fi
(cd "$ROOT_DIR/base" && pnpm_cmd rebuild better-sqlite3)

if [ -x "$ROOT_DIR/ai-worker/.venv/bin/python" ]; then
  if ! "$ROOT_DIR/ai-worker/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
    rm -rf "$ROOT_DIR/ai-worker/.venv"
  fi
fi

if [ ! -x "$ROOT_DIR/ai-worker/.venv/bin/python" ]; then
  (
    cd "$ROOT_DIR/ai-worker"
    "$PYTHON_BIN" -m venv .venv
    .venv/bin/pip install --upgrade pip
    .venv/bin/pip install -r requirements.txt
  )
fi

load_env_file "$ROOT_DIR/base/.env"
load_env_file "$ROOT_DIR/ai-worker/.env"

export PORT="$BASE_PORT"
export WEB_PORT="$WEB_PORT"
export PYTHON_AI_WORKER_HOST="${PYTHON_AI_WORKER_HOST:-0.0.0.0}"
export PYTHON_AI_WORKER_PORT="$AI_WORKER_PORT"
export PYTHON_AI_WORKER_URL="${PYTHON_AI_WORKER_URL:-http://127.0.0.1:$AI_WORKER_PORT}"
export AI_WORKER_VIDEODATA_DIR="${AI_WORKER_VIDEODATA_DIR:-$ROOT_DIR/videodata}"
export AI_WORKER_LOG_DIR="${AI_WORKER_LOG_DIR:-$ROOT_DIR/logs}"
export ENV_FILE="${ENV_FILE:-$ROOT_DIR/base/.env}"

check_port "$AI_WORKER_PORT"
check_port "$BASE_PORT"
check_port "$WEB_PORT"

cat > "$ROOT_DIR/.web-server.mjs" <<'EOF'
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(root, 'web', 'dist');
const webPort = Number(process.env.WEB_PORT || 5689);
const basePort = Number(process.env.PORT || 7072);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function proxy(req, res) {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: basePort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${basePort}` },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  });
  req.pipe(upstream);
}

function send(res, file) {
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${webPort}`);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) {
    proxy(req, res);
    return;
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(webRoot, safePath === '/' ? 'index.html' : safePath);
  send(res, fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(webRoot, 'index.html'));
}).listen(webPort, '0.0.0.0', () => {
  console.log(`web listening on http://localhost:${webPort}`);
});
EOF

cleanup() {
  kill "$AI_WORKER_PID" "$BASE_PID" "$WEB_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

(cd "$ROOT_DIR/ai-worker" && .venv/bin/python worker.py) &
AI_WORKER_PID=$!

(cd "$ROOT_DIR/base" && node dist/index.js) &
BASE_PID=$!

node "$ROOT_DIR/.web-server.mjs" &
WEB_PID=$!

echo "已启动 ai-worker、base、web"
echo "访问：http://localhost:$WEB_PORT"
echo "按 Ctrl+C 停止"

wait
