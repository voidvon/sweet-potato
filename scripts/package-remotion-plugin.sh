#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${REMOTION_PLUGIN_SOURCE:-${PROJECT_ROOT}/plugins/remotion-video}"
TARGET_DIR="${REMOTION_PLUGIN_TARGET_DIR:-${PROJECT_ROOT}/backend/bin/plugins/remotion-video}"
BUN_SOURCE="${REMOTION_BUN_PATH:-$(command -v bun || true)}"

if [[ ! -f "${SOURCE_DIR}/package.json" || ! -d "${SOURCE_DIR}/server" || ! -d "${SOURCE_DIR}/src" ]]; then
  echo "Remotion plugin source is incomplete: ${SOURCE_DIR}" >&2
  exit 1
fi
if [[ -z "${BUN_SOURCE}" || ! -x "${BUN_SOURCE}" ]]; then
  echo "Bun runtime was not found. Set REMOTION_BUN_PATH to the Bun executable." >&2
  exit 1
fi

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}/bin"
cp "${SOURCE_DIR}/package.json" "${SOURCE_DIR}/bun.lock" "${SOURCE_DIR}/remotion.config.ts" "${SOURCE_DIR}/tsconfig.json" "${TARGET_DIR}/"
cp -R "${SOURCE_DIR}/server" "${SOURCE_DIR}/src" "${TARGET_DIR}/"
cp "${BUN_SOURCE}" "${TARGET_DIR}/bin/bun"
chmod 0755 "${TARGET_DIR}/bin/bun"

cd "${TARGET_DIR}"
"${TARGET_DIR}/bin/bun" install --production --frozen-lockfile
SOURCE_BROWSER_DIR="${SOURCE_DIR}/node_modules/.remotion/chrome-headless-shell"
TARGET_BROWSER_ROOT="${TARGET_DIR}/node_modules/.remotion"
if [[ -d "${SOURCE_BROWSER_DIR}" ]]; then
  mkdir -p "${TARGET_BROWSER_ROOT}"
  cp -R "${SOURCE_BROWSER_DIR}" "${TARGET_BROWSER_ROOT}/"
else
  "${TARGET_DIR}/bin/bun" run browser:ensure
fi

echo "Packaged managed Remotion plugin at ${TARGET_DIR}"
