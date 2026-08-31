#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${REMOTION_PLUGIN_SOURCE:-$(cd "${PROJECT_ROOT}/.." && pwd)/remotion-video}"
TARGET_DIR="${PROJECT_ROOT}/backend/bin/plugins/remotion-video"
BUN_SOURCE="${REMOTION_BUN_PATH:-$(command -v bun || true)}"

if [[ ! -f "${SOURCE_DIR}/package.json" || ! -d "${SOURCE_DIR}/server" || ! -d "${SOURCE_DIR}/src" ]]; then
  echo "Remotion plugin source is incomplete: ${SOURCE_DIR}" >&2
  exit 1
fi
if [[ ! -d "${SOURCE_DIR}/node_modules" ]]; then
  echo "Remotion dependencies are not installed. Run 'bun install --frozen-lockfile' in ${SOURCE_DIR}." >&2
  exit 1
fi
if [[ ! -d "${SOURCE_DIR}/node_modules/.remotion/chrome-headless-shell" ]]; then
  echo "Remotion Chromium is not prepared. Start the render server once during the build stage." >&2
  exit 1
fi
if [[ -z "${BUN_SOURCE}" || ! -x "${BUN_SOURCE}" ]]; then
  echo "Bun runtime was not found. Set REMOTION_BUN_PATH to the Bun executable." >&2
  exit 1
fi

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}/bin"
cp "${SOURCE_DIR}/package.json" "${SOURCE_DIR}/bun.lock" "${SOURCE_DIR}/remotion.config.ts" "${TARGET_DIR}/"
cp -R "${SOURCE_DIR}/server" "${SOURCE_DIR}/src" "${SOURCE_DIR}/node_modules" "${TARGET_DIR}/"
cp "${BUN_SOURCE}" "${TARGET_DIR}/bin/bun"
chmod 0755 "${TARGET_DIR}/bin/bun"

echo "Packaged managed Remotion plugin at ${TARGET_DIR}"
