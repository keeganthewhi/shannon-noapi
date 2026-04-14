#!/bin/bash
set -euo pipefail

TARGET_UID="${SHANNON_HOST_UID:-}"
TARGET_GID="${SHANNON_HOST_GID:-}"
CURRENT_UID=$(id -u pentest 2>/dev/null || echo "")

# Validate UID/GID format — prevent injection via crafted env vars.
# Only digits, range 1-65534 (0=root, 65535=nobody — both forbidden).
validate_id() {
  local val="$1" label="$2"
  if ! echo "$val" | grep -qE '^[0-9]+$'; then
    echo "ERROR: Invalid $label: '$val' (must be numeric)" >&2
    exit 1
  fi
  if [ "$val" -lt 1 ] || [ "$val" -gt 65534 ]; then
    echo "ERROR: $label $val out of safe range 1-65534" >&2
    exit 1
  fi
}

if [ -n "$TARGET_UID" ] && [ "$TARGET_UID" != "$CURRENT_UID" ]; then
  validate_id "$TARGET_UID" "SHANNON_HOST_UID"
  validate_id "${TARGET_GID:-$TARGET_UID}" "SHANNON_HOST_GID"

  deluser pentest 2>/dev/null || true
  delgroup pentest 2>/dev/null || true

  addgroup -g "${TARGET_GID:-$TARGET_UID}" pentest
  adduser -u "$TARGET_UID" -G pentest -s /bin/bash -D pentest

  # /tmp/.claude is a read-only host bind mount — chown would fail. Adapters
  # copy required files into /tmp/.claude-parent (writable) at spawn time.
  chown -R pentest:pentest /app/sessions /app/workspaces /opt/shannon 2>/dev/null || true
fi

# Try su for UID-remapped environments; fall back to direct exec when
# --cap-drop=ALL / --security-opt=no-new-privileges blocks setuid.
if su -m pentest -c "true" 2>/dev/null; then
  exec su -m pentest -c "exec $*"
else
  exec "$@"
fi
