#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/docker_run"

source "$ROOT_DIR/scripts/release-version.sh"
trap rollback_release_version EXIT

FRONTEND_DIR="$ROOT_DIR/frontend"
WEB_DIR="$ROOT_DIR/frontend/web"
ADMIN_DIR="$ROOT_DIR/frontend/admin"
BASE_DIR="$ROOT_DIR/backend/base"
AI_WORKER_DIR="$ROOT_DIR/backend/ai-worker"
BUILD_DIR="$ROOT_DIR/build"
README_RUN_TEMPLATE="$BUILD_DIR/README.md"
LOCAL_RUN_SCRIPT="$BUILD_DIR/run.sh"

POSITIONAL_PACKAGE_ENV="${1:-}"
POSITIONAL_DEPLOY_PROFILE="${2:-}"
DEPLOY_PROFILE="${DEPLOY_PROFILE:-}"

resolve_git_commit() {
  if command -v git >/dev/null 2>&1; then
    git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown"
  else
    echo "unknown"
  fi
}

configure_runtime_ports() {
  case "$PACKAGE_ENV" in
    production)
      WEB_HOST_PORT="${WEB_HOST_PORT:-5689}"
      BASE_HOST_PORT="${BASE_HOST_PORT:-5672}"
      AI_WORKER_HOST_PORT="${AI_WORKER_HOST_PORT:-5673}"
      ;;
    test)
      WEB_HOST_PORT="${WEB_HOST_PORT:-5690}"
      BASE_HOST_PORT="${BASE_HOST_PORT:-5772}"
      AI_WORKER_HOST_PORT="${AI_WORKER_HOST_PORT:-5773}"
      ;;
    *)
      echo "Unsupported package environment for ports: $PACKAGE_ENV" >&2
      exit 1
      ;;
  esac
}

select_deploy_profile() {
  local choice="${DEPLOY_PROFILE:-${POSITIONAL_DEPLOY_PROFILE:-mengmao}}"
  if [ "$choice" != "mengmao" ]; then
    echo "Unsupported deploy profile: $choice; only mengmao (8.148.148.181) is supported." >&2
    exit 1
  fi
  DEPLOY_PROFILE="mengmao"
  echo "==> Deploy profile: mengmao (8.148.148.181)"
}

configure_deploy_profile() {
  DEPLOY_REMOTE_USER="root"
  DEPLOY_REMOTE_HOST="8.148.148.181"
  DEPLOY_REMOTE_DIR="/root/ai-tool"

  echo "==> Deploy profile: $DEPLOY_PROFILE ($DEPLOY_REMOTE_USER@$DEPLOY_REMOTE_HOST:$DEPLOY_REMOTE_DIR)"
}

select_mirror_profile() {
  local choice="${DOCKER_MIRROR_PROFILE:-}"

  echo "==> Select Docker mirror profile"
  echo "    1) Tencent Cloud (default)"
  echo "    2) Docker Hub"
  echo "    3) Alibaba Cloud"
  echo "    4) Tsinghua TUNA"
  echo "    5) USTC"
  echo "    6) Shanghai Jiao Tong University"
  if [ -z "$choice" ] && [ -t 0 ]; then
    read -r -p "Choose mirror profile [1]: " choice
  fi

  case "${choice:-1}" in
    1)
      MIRROR_PROFILE_NAME="Tencent Cloud + Debian official APT"
      APT_MIRROR="deb.debian.org"
      AI_WORKER_APT_MIRROR="deb.debian.org"
      PIP_INDEX_URL="https://mirrors.cloud.tencent.com/pypi/simple"
      PYTHON_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      NODE_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      NGINX_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      ;;
    2)
      MIRROR_PROFILE_NAME="Docker Hub"
      APT_MIRROR="deb.debian.org"
      AI_WORKER_APT_MIRROR="deb.debian.org"
      PIP_INDEX_URL="https://pypi.org/simple"
      PYTHON_IMAGE_REGISTRY="docker.io/library"
      NODE_IMAGE_REGISTRY="docker.io/library"
      NGINX_IMAGE_REGISTRY="docker.io/library"
      ;;
    3)
      MIRROR_PROFILE_NAME="Alibaba Cloud"
      APT_MIRROR="mirrors.aliyun.com"
      AI_WORKER_APT_MIRROR="mirrors.aliyun.com"
      PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple"
      PYTHON_IMAGE_REGISTRY="registry.cn-hangzhou.aliyuncs.com/library"
      NODE_IMAGE_REGISTRY="registry.cn-hangzhou.aliyuncs.com/library"
      NGINX_IMAGE_REGISTRY="registry.cn-hangzhou.aliyuncs.com/library"
      ;;
    4)
      MIRROR_PROFILE_NAME="Tsinghua TUNA + DaoCloud images"
      APT_MIRROR="mirrors.tuna.tsinghua.edu.cn"
      AI_WORKER_APT_MIRROR="mirrors.tuna.tsinghua.edu.cn"
      PIP_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
      PYTHON_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      NODE_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      NGINX_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      ;;
    5)
      MIRROR_PROFILE_NAME="USTC + DaoCloud images"
      APT_MIRROR="mirrors.ustc.edu.cn"
      AI_WORKER_APT_MIRROR="mirrors.ustc.edu.cn"
      PIP_INDEX_URL="https://mirrors.ustc.edu.cn/pypi/simple"
      PYTHON_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      NODE_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      NGINX_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      ;;
    6)
      MIRROR_PROFILE_NAME="Shanghai Jiao Tong University + DaoCloud images"
      APT_MIRROR="mirror.sjtu.edu.cn"
      AI_WORKER_APT_MIRROR="mirror.sjtu.edu.cn"
      PIP_INDEX_URL="https://mirror.sjtu.edu.cn/pypi/web/simple/"
      PYTHON_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      NODE_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      NGINX_IMAGE_REGISTRY="docker.m.daocloud.io/library"
      ;;
    *)
      echo "Unknown mirror profile: $choice" >&2
      echo "Use a mirror profile from 1 to 6." >&2
      exit 1
      ;;
  esac

  echo "==> Using mirror profile: $MIRROR_PROFILE_NAME"
}

select_package_environment() {
  local choice="${DOCKER_PACKAGE_ENV:-${POSITIONAL_PACKAGE_ENV:-}}"

  echo "==> Select package environment"
  echo "    1) production (default)"
  echo "    2) test"
  if [ -z "$choice" ] && [ -t 0 ]; then
    read -r -p "Choose package environment [1]: " choice
  fi

  case "${choice:-1}" in
    1|production|prod)
      PACKAGE_ENV="production"
      VITE_API_BASE_URL=""
      WEB_ASSET_BASE="/"
      WEB_ROUTER_BASENAME=""
      ADMIN_ASSET_BASE="/admin/"
      ADMIN_ROUTER_BASENAME="/admin"
      BASE_WORKER_URL="http://ai-worker:7073"
      BASE_EXTRA_HOSTS=""
      BASE_PUBLIC_ENV=""
      ;;
    2|test)
      PACKAGE_ENV="test"
      VITE_API_BASE_URL=""
      WEB_ASSET_BASE="/"
      WEB_ROUTER_BASENAME=""
      ADMIN_ASSET_BASE="/admin/"
      ADMIN_ROUTER_BASENAME="/admin"
      BASE_WORKER_URL="http://ai-worker:7073"
      BASE_EXTRA_HOSTS=""
      CONTENT_PUBLIC_BASE_URL="${CONTENT_PUBLIC_BASE_URL:-https://ai.0122.vip}"
      BASE_PUBLIC_ENV="      CONTENT_PUBLIC_BASE_URL: $CONTENT_PUBLIC_BASE_URL"
      ;;
    *)
      echo "Unknown package environment: $choice" >&2
      echo "Use 1 for production or 2 for test." >&2
      exit 1
      ;;
  esac

  echo "==> Using package environment: $PACKAGE_ENV"
  configure_runtime_ports
  echo "==> Runtime ports: web=$WEB_HOST_PORT, base=$BASE_HOST_PORT, ai-worker=$AI_WORKER_HOST_PORT"
}

pnpm_cmd() {
  COREPACK_ENABLE_PROJECT_SPEC=0 \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true \
  npm_config_user_agent="${npm_config_user_agent:-pnpm/codex}" \
  pnpm "$@"
}

select_mirror_profile
select_deploy_profile
configure_deploy_profile
select_package_environment
begin_release_version "$ROOT_DIR"

echo "==> Cleaning docker_run"
rm -rf "$RUN_DIR"
mkdir -p "$RUN_DIR/web" "$RUN_DIR/base" "$RUN_DIR/ai-worker" "$RUN_DIR/data" "$RUN_DIR/logs" "$RUN_DIR/videodata"

echo "==> Installing frontend workspace dependencies"
(
  cd "$FRONTEND_DIR"
  pnpm_cmd install --frozen-lockfile
)

echo "==> Building web"
(
  cd "$FRONTEND_DIR"
  VITE_API_BASE_URL="$VITE_API_BASE_URL" VITE_ASSET_BASE="$WEB_ASSET_BASE" VITE_ROUTER_BASENAME="$WEB_ROUTER_BASENAME" pnpm_cmd --dir web run build
)
cp -R "$WEB_DIR/dist" "$RUN_DIR/web/dist"

echo "==> Building admin"
(
  cd "$FRONTEND_DIR"
  VITE_API_BASE_URL="$VITE_API_BASE_URL" VITE_ADMIN_ASSET_BASE="$ADMIN_ASSET_BASE" VITE_ADMIN_ROUTER_BASENAME="$ADMIN_ROUTER_BASENAME" pnpm_cmd --dir admin run build
)
rm -rf "$RUN_DIR/web/dist/admin"
mkdir -p "$RUN_DIR/web/dist/admin"
cp -R "$ADMIN_DIR/dist/." "$RUN_DIR/web/dist/admin/"

echo "==> Building base"
(
  cd "$BASE_DIR"
  pnpm_cmd install --no-frozen-lockfile
  pnpm_cmd run build
)
cp -R "$BASE_DIR/dist" "$RUN_DIR/base/dist"
cp "$BASE_DIR/package.json" "$BASE_DIR/pnpm-lock.yaml" "$RUN_DIR/base/"
if [ -f "$BASE_DIR/.env" ]; then
  cp "$BASE_DIR/.env" "$RUN_DIR/base/.env"
else
  touch "$RUN_DIR/base/.env"
fi

echo "==> Packaging ai-worker"
cp "$AI_WORKER_DIR/requirements.txt" "$AI_WORKER_DIR/worker.py" "$RUN_DIR/ai-worker/"
rsync -a --delete \
  --exclude '.DS_Store' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  "$AI_WORKER_DIR/ai_worker/" "$RUN_DIR/ai-worker/ai_worker/"
if [ -f "$AI_WORKER_DIR/.env" ]; then
  cp "$AI_WORKER_DIR/.env" "$RUN_DIR/ai-worker/.env"
else
  touch "$RUN_DIR/ai-worker/.env"
fi

echo "==> Creating empty runtime data directories"

echo "==> Writing docker runtime files"
cat > "$RUN_DIR/.env" <<EOF
PACKAGE_ENV=$PACKAGE_ENV
DEPLOY_PROFILE=$DEPLOY_PROFILE
APP_VERSION=$APP_VERSION
VITE_API_BASE_URL=$VITE_API_BASE_URL
WEB_ASSET_BASE=$WEB_ASSET_BASE
WEB_ROUTER_BASENAME=$WEB_ROUTER_BASENAME
ADMIN_ASSET_BASE=$ADMIN_ASSET_BASE
ADMIN_ROUTER_BASENAME=$ADMIN_ROUTER_BASENAME
BASE_WORKER_URL=$BASE_WORKER_URL
CONTENT_PUBLIC_BASE_URL=${CONTENT_PUBLIC_BASE_URL:-}
WEB_HOST_PORT=$WEB_HOST_PORT
BASE_HOST_PORT=$BASE_HOST_PORT
AI_WORKER_HOST_PORT=$AI_WORKER_HOST_PORT

MIRROR_PROFILE_NAME=$MIRROR_PROFILE_NAME
APT_MIRROR=$APT_MIRROR
AI_WORKER_APT_MIRROR=$AI_WORKER_APT_MIRROR
PIP_INDEX_URL=$PIP_INDEX_URL

PYTHON_IMAGE_REGISTRY=$PYTHON_IMAGE_REGISTRY
NODE_IMAGE_REGISTRY=$NODE_IMAGE_REGISTRY
NGINX_IMAGE_REGISTRY=$NGINX_IMAGE_REGISTRY
EOF

BUILD_TIME="$(date '+%Y-%m-%d %H:%M:%S %z')"
GIT_COMMIT="$(resolve_git_commit)"

cat > "$RUN_DIR/.build-info" <<EOF
BUILD_TIME=$BUILD_TIME
APP_VERSION=$APP_VERSION
PACKAGE_ENV=$PACKAGE_ENV
DEPLOY_PROFILE=$DEPLOY_PROFILE
GIT_COMMIT=$GIT_COMMIT
WEB_HOST_PORT=$WEB_HOST_PORT
BASE_HOST_PORT=$BASE_HOST_PORT
AI_WORKER_HOST_PORT=$AI_WORKER_HOST_PORT
EOF

cat > "$RUN_DIR/docker-compose.yml" <<EOF
services:
  web:
    build:
      context: ./web
      args:
        NGINX_IMAGE_REGISTRY: \${NGINX_IMAGE_REGISTRY:-docker.m.daocloud.io/library}
    image: ai-marketing-web:run
    ports:
      - "${WEB_HOST_PORT}:80"
    depends_on:
      base:
        condition: service_healthy
    restart: unless-stopped

  base:
    build:
      context: ./base
      args:
        NODE_IMAGE_REGISTRY: \${NODE_IMAGE_REGISTRY:-docker.m.daocloud.io/library}
        APT_MIRROR: \${APT_MIRROR:-deb.debian.org}
    image: ai-marketing-base:run
    ports:
      - "127.0.0.1:${BASE_HOST_PORT}:7072"
$BASE_EXTRA_HOSTS
    env_file:
      - ./base/.env
    environment:
      NODE_ENV: production
      APP_VERSION: "$APP_VERSION"
      PORT: "7072"
      DATA_DIR: /app/data
      PYTHON_AI_WORKER_URL: $BASE_WORKER_URL
      CONTENT_UPLOAD_LIMIT_MB: "200"
      VOD_UPLOAD_LIMIT_MB: "1000"
$BASE_PUBLIC_ENV
    volumes:
      - ./data:/app/data
      - app-logs:/app/logs
      - app-videodata:/app/videodata
    depends_on:
      ai-worker:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:7072/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 10s
    restart: unless-stopped

  ai-worker:
    build:
      context: ./ai-worker
      args:
        PYTHON_IMAGE_REGISTRY: \${PYTHON_IMAGE_REGISTRY:-docker.m.daocloud.io/library}
        AI_WORKER_APT_MIRROR: \${AI_WORKER_APT_MIRROR:-deb.debian.org}
        PIP_INDEX_URL: \${PIP_INDEX_URL:-https://mirrors.cloud.tencent.com/pypi/simple}
    image: ai-marketing-ai-worker:run
    ports:
      - "127.0.0.1:${AI_WORKER_HOST_PORT}:7073"
    env_file:
      - ./ai-worker/.env
    environment:
      APP_VERSION: "$APP_VERSION"
      PYTHON_AI_WORKER_HOST: 0.0.0.0
      PYTHON_AI_WORKER_PORT: "7073"
      AI_WORKER_VIDEODATA_DIR: /app/videodata
      AI_WORKER_LOG_DIR: /app/logs
    volumes:
      - ./data:/app/data
      - app-logs:/app/logs
      - app-videodata:/app/videodata
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7073/health', timeout=5).read()"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 10s
    restart: unless-stopped

volumes:
  app-logs:
  app-videodata:
EOF

cat > "$RUN_DIR/web/Dockerfile" <<'EOF'
ARG NGINX_IMAGE_REGISTRY=docker.m.daocloud.io/library
FROM ${NGINX_IMAGE_REGISTRY}/nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html

EXPOSE 80
EOF

cat > "$RUN_DIR/web/nginx.conf" <<'EOF'
server {
  listen 80;
  server_name _;
  absolute_redirect off;

  root /usr/share/nginx/html;
  index index.html;

  client_max_body_size 1000m;

  location /api/ {
    proxy_pass http://base:7072/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
  }

  location /files/ {
    proxy_pass http://base:7072/files/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
  }

  location = /admin {
    return 301 /admin/;
  }

  location = /version.js {
    add_header Cache-Control "no-store";
  }

  location = /admin/version.js {
    add_header Cache-Control "no-store";
  }

  location /admin/ {
    try_files $uri $uri/ /admin/index.html;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
EOF

cat > "$RUN_DIR/base/Dockerfile" <<'EOF'
ARG NODE_IMAGE_REGISTRY=docker.m.daocloud.io/library
FROM ${NODE_IMAGE_REGISTRY}/node:22-bookworm-slim
ARG APT_MIRROR=deb.debian.org

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7072
ENV ENV_FILE=/app/.env

RUN sed -i "s#deb.debian.org#${APT_MIRROR}#g; s#security.debian.org#${APT_MIRROR}#g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update -o Acquire::Retries=5 \
  && apt-get install -y --no-install-recommends --fix-missing ca-certificates ffmpeg python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry https://registry.npmmirror.com \
  && PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true pnpm install --prod --no-frozen-lockfile

COPY .env ./.env
COPY dist ./dist
RUN mkdir -p /app/data /app/logs /app/videodata

EXPOSE 7072
CMD ["node", "dist/index.js"]
EOF

cat > "$RUN_DIR/ai-worker/Dockerfile" <<'EOF'
ARG PYTHON_IMAGE_REGISTRY=docker.m.daocloud.io/library
FROM ${PYTHON_IMAGE_REGISTRY}/python:3.12-slim
ARG AI_WORKER_APT_MIRROR=deb.debian.org
ARG PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHON_AI_WORKER_HOST=0.0.0.0
ENV PYTHON_AI_WORKER_PORT=7073

RUN if [ "${AI_WORKER_APT_MIRROR}" != "deb.debian.org" ]; then \
      sed -i "s#deb.debian.org#${AI_WORKER_APT_MIRROR}#g; s#security.debian.org#${AI_WORKER_APT_MIRROR}#g" /etc/apt/sources.list.d/debian.sources; \
    fi \
  && apt-get update -o Acquire::Retries=3 -o Acquire::ForceIPv4=true \
  && apt-get install -y --no-install-recommends --fix-missing ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --retries 5 --timeout 120 -i "${PIP_INDEX_URL}" -r requirements.txt

COPY worker.py ./
COPY ai_worker ./ai_worker

RUN mkdir -p /app/data /app/logs /app/videodata

EXPOSE 7073
CMD ["python", "worker.py"]
EOF

echo "==> Copying runtime helper files"
cp "$README_RUN_TEMPLATE" "$RUN_DIR/README.md"
cp "$LOCAL_RUN_SCRIPT" "$RUN_DIR/run.sh"
chmod +x "$RUN_DIR/run.sh"

echo "==> Done"
echo "App version: $APP_VERSION"
echo "Package environment: $PACKAGE_ENV"
echo "Web API base URL: ${VITE_API_BASE_URL:-same-origin}"
echo "Web asset base: $WEB_ASSET_BASE"
echo "Web router basename: ${WEB_ROUTER_BASENAME:-root}"
echo "Admin asset base: $ADMIN_ASSET_BASE"
echo "Admin router basename: ${ADMIN_ROUTER_BASENAME:-root}"
echo "Base worker URL: $BASE_WORKER_URL"
echo "Host ports: web=$WEB_HOST_PORT, base=$BASE_HOST_PORT, ai-worker=$AI_WORKER_HOST_PORT"
if [ -n "${CONTENT_PUBLIC_BASE_URL:-}" ]; then
  echo "Content public base URL: $CONTENT_PUBLIC_BASE_URL"
fi
echo "Runtime package: $RUN_DIR"
echo "Run with:"
echo "  cd docker_run && ./run.sh"

complete_release_version
