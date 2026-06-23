#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$ROOT_DIR/docker_run}"

REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-119.45.92.250}"
REMOTE_DIR="${REMOTE_DIR:-/root/ai-tool}"
SSH_TARGET="$REMOTE_USER@$REMOTE_HOST"

WEB_HOST_PORT="${WEB_HOST_PORT:-}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "请先安装 $1" >&2
    exit 1
  fi
}

need_source() {
  if [ ! -e "$SOURCE_DIR/$1" ]; then
    echo "缺少部署文件：$SOURCE_DIR/$1" >&2
    echo "请先运行：bash package-docker.sh" >&2
    exit 1
  fi
}

need_cmd ssh
need_cmd rsync

need_source ai-worker
need_source base
need_source web
need_source .build-info
need_source docker-compose.yml

if [ -z "$WEB_HOST_PORT" ] && [ -f "$SOURCE_DIR/.env" ]; then
  WEB_HOST_PORT="$(sed -n 's/^WEB_HOST_PORT=//p' "$SOURCE_DIR/.env" | tail -n 1)"
fi

WEB_HOST_PORT="${WEB_HOST_PORT:-5689}"

echo "==> 部署来源：$SOURCE_DIR"
echo "==> 远端目录：$SSH_TARGET:$REMOTE_DIR"
echo "==> 构建信息："
cat "$SOURCE_DIR/.build-info"

ssh "$SSH_TARGET" "mkdir -p '$REMOTE_DIR'"

echo "==> 同步 ai-worker/base/web/.build-info/docker-compose.yml"
rsync -az --delete \
  --exclude '.DS_Store' \
  "$SOURCE_DIR/ai-worker" \
  "$SOURCE_DIR/base" \
  "$SOURCE_DIR/web" \
  "$SOURCE_DIR/.build-info" \
  "$SOURCE_DIR/.env" \
  "$SOURCE_DIR/docker-compose.yml" \
  "$SSH_TARGET:$REMOTE_DIR/"

echo "==> 远端构建并启动 Docker 服务"
ssh "$SSH_TARGET" "
  set -eu
  cd '$REMOTE_DIR'
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD='docker compose'
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD='docker-compose'
  else
    echo '服务器未安装 docker compose 或 docker-compose' >&2
    exit 1
  fi
  \$COMPOSE_CMD stop ai-worker base web || true
  \$COMPOSE_CMD rm -f ai-worker base web || true
  \$COMPOSE_CMD up -d --build
  \$COMPOSE_CMD ps
"

echo "==> 部署完成"
echo "访问地址：http://$REMOTE_HOST:$WEB_HOST_PORT"
