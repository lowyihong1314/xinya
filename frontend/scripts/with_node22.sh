#!/usr/bin/env bash
set -e

NODE_BIN_DIR=""
CURRENT_NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
if [ "$CURRENT_NODE_MAJOR" -lt 22 ] && [ -x /usr/bin/node ]; then
  SYSTEM_NODE_MAJOR=$(/usr/bin/node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
  if [ "$SYSTEM_NODE_MAJOR" -ge 22 ]; then
    NODE_BIN_DIR="/usr/bin"
  fi
fi

export PATH="${NODE_BIN_DIR:+$NODE_BIN_DIR:}$PATH"

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Capacitor 8 requires Node.js >= 22. Current node: $(node -v 2>/dev/null || echo missing)"
  exit 1
fi

exec "$@"
