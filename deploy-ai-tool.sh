#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$ROOT_DIR/docker_run}"

POSITIONAL_DEPLOY_PROFILE="${1:-}"
DEPLOY_PROFILE="${DEPLOY_PROFILE:-}"
SOURCE_DEPLOY_PROFILE=""

REMOTE_USER="${REMOTE_USER:-}"
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-}"

WEB_HOST_PORT="${WEB_HOST_PORT:-}"
WEB_PUBLIC_PATH="${WEB_PUBLIC_PATH:-/}"
ADMIN_PUBLIC_PATH="${ADMIN_PUBLIC_PATH:-/admin/}"

select_deploy_profile() {
  local choice="${DEPLOY_PROFILE:-$POSITIONAL_DEPLOY_PROFILE}"
  local default_choice="${SOURCE_DEPLOY_PROFILE:-1}"

  echo "==> 选择部署配置"
  echo "    1) default（旧服务器）"
  echo "    2) mengmao（101.96.221.207）"
  if [ -z "$choice" ] && [ -t 0 ]; then
    read -r -p "请选择部署配置 [${default_choice}]: " choice
  fi

  case "${choice:-$default_choice}" in
    1|default)
      DEPLOY_PROFILE="default"
      ;;
    2|mengmao)
      DEPLOY_PROFILE="mengmao"
      ;;
    *)
      echo "未知部署配置：$choice" >&2
      echo "可用配置：default、mengmao" >&2
      exit 1
      ;;
  esac
}

configure_deploy_profile() {
  case "${DEPLOY_PROFILE:-default}" in
    default)
      PROFILE_REMOTE_USER="root"
      PROFILE_REMOTE_HOST="119.45.92.250"
      PROFILE_REMOTE_DIR="/root/ai-tool"
      ;;
    mengmao)
      PROFILE_REMOTE_USER="root"
      PROFILE_REMOTE_HOST="101.96.221.207"
      PROFILE_REMOTE_DIR="/root/ai-tool"
      ;;
    *)
      echo "未知部署配置：$DEPLOY_PROFILE" >&2
      echo "可用配置：default、mengmao" >&2
      exit 1
      ;;
  esac

  REMOTE_USER="${REMOTE_USER:-$PROFILE_REMOTE_USER}"
  REMOTE_HOST="${REMOTE_HOST:-$PROFILE_REMOTE_HOST}"
  REMOTE_DIR="${REMOTE_DIR:-$PROFILE_REMOTE_DIR}"
  SSH_TARGET="$REMOTE_USER@$REMOTE_HOST"
}

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

if [ -z "$DEPLOY_PROFILE" ] && [ -f "$SOURCE_DIR/.env" ]; then
  SOURCE_DEPLOY_PROFILE="$(sed -n 's/^DEPLOY_PROFILE=//p' "$SOURCE_DIR/.env" | tail -n 1)"
fi
select_deploy_profile
configure_deploy_profile

if [ -z "$WEB_HOST_PORT" ] && [ -f "$SOURCE_DIR/.env" ]; then
  WEB_HOST_PORT="$(sed -n 's/^WEB_HOST_PORT=//p' "$SOURCE_DIR/.env" | tail -n 1)"
fi

if [ -f "$SOURCE_DIR/.env" ]; then
  WEB_ROUTER_BASENAME_FROM_ENV="$(sed -n 's/^WEB_ROUTER_BASENAME=//p' "$SOURCE_DIR/.env" | tail -n 1)"
  ADMIN_ROUTER_BASENAME_FROM_ENV="$(sed -n 's/^ADMIN_ROUTER_BASENAME=//p' "$SOURCE_DIR/.env" | tail -n 1)"
  if [ -n "$WEB_ROUTER_BASENAME_FROM_ENV" ]; then
    WEB_PUBLIC_PATH="$WEB_ROUTER_BASENAME_FROM_ENV/"
  fi
  if [ -n "$ADMIN_ROUTER_BASENAME_FROM_ENV" ]; then
    ADMIN_PUBLIC_PATH="$ADMIN_ROUTER_BASENAME_FROM_ENV/"
  fi
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
echo "web 访问地址：http://$REMOTE_HOST:$WEB_HOST_PORT$WEB_PUBLIC_PATH"
echo "admin 访问地址：http://$REMOTE_HOST:$WEB_HOST_PORT$ADMIN_PUBLIC_PATH"
echo "容器直连地址：http://$REMOTE_HOST:$WEB_HOST_PORT"
