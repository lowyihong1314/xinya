#!/bin/bash
set -e

export JAVA_HOME=~/android-build/jdk/jdk-21.0.3+9
export ANDROID_HOME=~/android-build/sdk
export PATH=$JAVA_HOME/bin:$PATH

# 切到 frontend/ 目录（无论从哪里调用都能正确运行）
cd "$(dirname "$0")"

VERSION=$(date +%Y%m%d_%H%M)
OUTPUT="apk/UTBA_BETA_${VERSION}.apk"

echo "==> [1/4] Building React bundle (APK mode)..."
npm run build:apk

echo "==> [2/4] Generating app icons from logo..."
node -e "
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const SRC = '../static/images/logo/log222o.png';
const RES = 'android/app/src/main/res';
const densities = [
  { dir: 'mipmap-mdpi',    size: 48  },
  { dir: 'mipmap-hdpi',    size: 72  },
  { dir: 'mipmap-xhdpi',   size: 96  },
  { dir: 'mipmap-xxhdpi',  size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];
(async () => {
  for (const { dir, size } of densities) {
    const dest = path.join(RES, dir);
    fs.mkdirSync(dest, { recursive: true });
    const buf = await sharp(SRC).resize(size, size, { fit: 'contain' }).png().toBuffer();
    fs.writeFileSync(path.join(dest, 'ic_launcher.png'), buf);
    fs.writeFileSync(path.join(dest, 'ic_launcher_round.png'), buf);
  }
})();
"

echo "==> [3/4] Syncing to Android project..."
npx cap sync android

echo "==> [4/4] Building signed release APK..."
cd android
./gradlew assembleRelease
cd ..

echo "==> Copying APK..."
mkdir -p apk
cp android/app/build/outputs/apk/release/app-release.apk "$OUTPUT"

echo ""
echo "Done!  $(ls -lh "$OUTPUT" | awk '{print $5, $9}')"
echo "Files in apk/:"
ls -lht apk/*.apk 2>/dev/null | head -10
