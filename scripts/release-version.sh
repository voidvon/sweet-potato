#!/usr/bin/env bash

# This file is sourced by release scripts. ROOT_DIR must point at the repository root.

RELEASE_VERSION_ACTIVE=0
RELEASE_VERSION_LOCK_DIR=""
PREVIOUS_APP_VERSION=""
APP_VERSION=""

begin_release_version() {
  local root_dir="$1"

  RELEASE_VERSION_LOCK_DIR="$root_dir/.version-release.lock"
  if ! mkdir "$RELEASE_VERSION_LOCK_DIR" 2>/dev/null; then
    echo "Another release is already allocating a version." >&2
    echo "If no release is running, remove: $RELEASE_VERSION_LOCK_DIR" >&2
    return 1
  fi

  RELEASE_VERSION_ACTIVE=1
  if ! PREVIOUS_APP_VERSION="$(node "$root_dir/scripts/version.cjs" current)"; then
    rm -rf "$RELEASE_VERSION_LOCK_DIR"
    RELEASE_VERSION_ACTIVE=0
    return 1
  fi

  if ! APP_VERSION="$(node "$root_dir/scripts/version.cjs" bump)"; then
    node "$root_dir/scripts/version.cjs" set "$PREVIOUS_APP_VERSION" >/dev/null 2>&1 || true
    rm -rf "$RELEASE_VERSION_LOCK_DIR"
    RELEASE_VERSION_ACTIVE=0
    return 1
  fi

  export APP_VERSION
  echo "==> Release version: $APP_VERSION (previous: $PREVIOUS_APP_VERSION)"
}

complete_release_version() {
  if [ "$RELEASE_VERSION_ACTIVE" -eq 1 ]; then
    rm -rf "$RELEASE_VERSION_LOCK_DIR"
    RELEASE_VERSION_ACTIVE=0
  fi
}

rollback_release_version() {
  if [ "$RELEASE_VERSION_ACTIVE" -eq 1 ]; then
    echo "==> Release failed; restoring version $PREVIOUS_APP_VERSION" >&2
    node "$ROOT_DIR/scripts/version.cjs" set "$PREVIOUS_APP_VERSION" >/dev/null 2>&1 || true
    rm -rf "$RELEASE_VERSION_LOCK_DIR"
    RELEASE_VERSION_ACTIVE=0
  fi
}
