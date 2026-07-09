#!/bin/sh
set -eu

REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-119.45.92.250}"
SSH_TARGET="$REMOTE_USER@$REMOTE_HOST"

BASE_UPSTREAM="${BASE_UPSTREAM:-http://127.0.0.1:7072}"
WORKER_UPSTREAM="${WORKER_UPSTREAM:-http://127.0.0.1:7073}"
NGINX_CONF_NAME="${NGINX_CONF_NAME:-ai-tool-api.conf}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "请先安装 $1" >&2
    exit 1
  fi
}

need_cmd ssh

echo "==> 配置远端 Nginx：$SSH_TARGET"
echo "==> /            -> http://127.0.0.1:5689"
echo "==> /admin/       -> http://127.0.0.1:5689/admin/"
echo "==> /api/base/   -> $BASE_UPSTREAM"
echo "==> /api/worker/ -> $WORKER_UPSTREAM"

ssh "$SSH_TARGET" "
  set -eu

  if ! command -v nginx >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update
      apt-get install -y nginx
    elif command -v yum >/dev/null 2>&1; then
      yum install -y nginx
    else
      echo '服务器未安装 nginx，且未找到 apt-get/yum' >&2
      exit 1
    fi
  fi

  if [ -d /www/server/panel/vhost/nginx ]; then
    NGINX_CONF_DIR=/www/server/panel/vhost/nginx
  else
    NGINX_CONF_DIR=/etc/nginx/conf.d
  fi

  mkdir -p \"\$NGINX_CONF_DIR\"

  cat > \"\$NGINX_CONF_DIR/$NGINX_CONF_NAME\" <<'EOF'
server {
  listen 80;
  server_name $REMOTE_HOST;

  client_max_body_size 1000m;

  location /api/base/ {
    proxy_pass $BASE_UPSTREAM/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header Real-IP \$remote_addr;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }

  location /api/worker/ {
    proxy_pass $WORKER_UPSTREAM/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header Real-IP \$remote_addr;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }

  location = /web {
    return 301 /;
  }

  location /web/ {
    return 301 /;
  }

  location = /admin {
    return 301 /admin/;
  }

  location /admin/ {
    proxy_pass http://127.0.0.1:5689/admin/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header Real-IP \$remote_addr;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }

  location / {
    proxy_pass http://127.0.0.1:5689/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header Real-IP \$remote_addr;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }
}
EOF

  nginx -t

  nginx -s reload \
    || service nginx reload \
    || /etc/init.d/nginx reload \
    || systemctl reload nginx \
    || systemctl restart nginx
"

echo "==> Nginx 配置完成"
echo "web:    http://$REMOTE_HOST/"
echo "admin:  http://$REMOTE_HOST/admin/"
echo "base:   http://$REMOTE_HOST/api/base/"
echo "worker: http://$REMOTE_HOST/api/worker/"
