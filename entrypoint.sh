#!/bin/bash
set -euo pipefail

TARGET_UID="${SHANNON_HOST_UID:-}"
TARGET_GID="${SHANNON_HOST_GID:-}"
CURRENT_UID=$(id -u pentest 2>/dev/null || echo "")

if [ -n "$TARGET_UID" ] && [ "$TARGET_UID" != "$CURRENT_UID" ]; then
  deluser pentest 2>/dev/null || true
  delgroup pentest 2>/dev/null || true

  addgroup -g "$TARGET_GID" pentest
  adduser -u "$TARGET_UID" -G pentest -s /bin/bash -D pentest

  # /tmp/.claude is a read-only host bind mount — chown would fail. Adapters
  # copy required files into /tmp/.claude-parent (writable) at spawn time.
  chown -R pentest:pentest /app/sessions /app/workspaces /opt/shannon 2>/dev/null || true
fi

exec su -m pentest -c "exec $*"
