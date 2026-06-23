#!/bin/sh
set -eu

REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-119.45.92.250}"
REMOTE_DIR="${REMOTE_DIR:-/root/ai-tool}"
SSH_TARGET="$REMOTE_USER@$REMOTE_HOST"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "请先安装 $1" >&2
    exit 1
  fi
}

need_cmd ssh

echo "==> 诊断远端 VOD 上传：$SSH_TARGET"

ssh "$SSH_TARGET" "
  set -u
  cd '$REMOTE_DIR' || exit 1

  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD='docker compose'
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD='docker-compose'
  else
    echo '服务器未安装 docker compose 或 docker-compose' >&2
    exit 1
  fi

  echo
  echo '==> compose 状态'
  \$COMPOSE_CMD ps

  echo
  echo '==> base 配置'
  \$COMPOSE_CMD exec -T base node -e \"console.log(JSON.stringify({workerUrl:process.env.PYTHON_AI_WORKER_URL, contentPublicBaseUrl:process.env.CONTENT_PUBLIC_BASE_URL, envFile:process.env.ENV_FILE}, null, 2))\" 2>&1 || true

  echo
  echo '==> ai-worker VOD 配置诊断'
  \$COMPOSE_CMD exec -T base node -e \"fetch('http://ai-worker:7073/vod/credentials').then(async r=>console.log(r.status, await r.text())).catch(e=>{console.error(e.message);process.exit(1)})\" 2>&1 || true

  echo
  echo '==> ai-worker 最小 /vod/upload JSON 响应测试'
  \$COMPOSE_CMD exec -T base node -e \"fetch('http://ai-worker:7073/vod/upload',{method:'POST',headers:{'Content-Type':'application/json','X-Trace-Id':'debug-vod-upload'},body:JSON.stringify({filePath:'/not-exist.mp4',fileName:'not-exist.mp4',title:'debug-upload',uploadId:'debug-vod-upload'})}).then(async r=>console.log(r.status, await r.text())).catch(e=>{console.error(e.message);process.exit(1)})\" 2>&1 || true

  echo
  echo '==> 共享目录检查'
  \$COMPOSE_CMD exec -T base sh -lc 'pwd; ls -ld /app/data /app/data/content-files /app/videodata 2>/dev/null || true; find /app/data/content-files -maxdepth 2 -type f 2>/dev/null | tail -20' 2>&1 || true
  echo
  \$COMPOSE_CMD exec -T ai-worker sh -lc 'pwd; ls -ld /app/data /app/data/content-files /app/videodata 2>/dev/null || true; find /app/data/content-files -maxdepth 2 -type f 2>/dev/null | tail -20' 2>&1 || true

  echo
  echo '==> base 最近 VOD 上传日志'
  \$COMPOSE_CMD logs --tail 240 base 2>&1 | grep -E 'vod upload|VOD 上传|workerUrl|filePath|无法解析|returned failure|connection failed' || true

  echo
  echo '==> ai-worker 最近 VOD 上传日志'
  \$COMPOSE_CMD logs --tail 240 ai-worker 2>&1 | grep -E 'vod upload|VOD|upload_media|crashed|failed|filePath|InvalidCredential|SignatureDoesNotMatch|AccessDenied' || true
"
