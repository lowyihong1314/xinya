#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -d "$HOME/android-build/jdk/jdk-21.0.3+9" ]; then
  export JAVA_HOME="${JAVA_HOME:-$HOME/android-build/jdk/jdk-21.0.3+9}"
fi
if [ -d "$HOME/android-build/sdk" ]; then
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-build/sdk}"
fi

NODE_BIN_DIR=""
CURRENT_NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
if [ "$CURRENT_NODE_MAJOR" -lt 22 ] && [ -x /usr/bin/node ]; then
  SYSTEM_NODE_MAJOR=$(/usr/bin/node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
  if [ "$SYSTEM_NODE_MAJOR" -ge 22 ]; then
    NODE_BIN_DIR="/usr/bin"
  fi
fi

export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}${NODE_BIN_DIR:+$NODE_BIN_DIR:}$PATH"

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Capacitor 8 requires Node.js >= 22. Current node: $(node -v 2>/dev/null || echo missing)"
  exit 1
fi

if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "ERROR: JAVA_HOME is not set to a valid JDK."
  exit 1
fi

if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "ERROR: ANDROID_HOME is not set to a valid Android SDK."
  exit 1
fi

echo "==> TypeScript check"
npx tsc --noEmit

echo "==> Web production build"
npm run build

echo "==> APK bundle build"
npm run build:apk

echo "==> Android Capacitor sync"
npm run cap:sync:android

echo "==> Android debug compile"
(cd android && ./gradlew assembleDebug)

echo "==> iOS prepare / Capacitor sync"
npm run ios:prepare

echo "==> Whitespace check"
(cd .. && git diff --check)

echo "Mobile build verification passed."
