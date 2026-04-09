#!/bin/bash
set -e

export JAVA_HOME=~/android-build/jdk/jdk-21.0.3+9
export ANDROID_HOME=~/android-build/sdk
export PATH=$JAVA_HOME/bin:$PATH

# 切到 frontend/ 目录（无论从哪里调用都能正确运行）
cd "$(dirname "$0")"

VERSION=$(date +%Y%m%d_%H%M)
APK_OUTPUT="apk/UTBA_BETA_${VERSION}.apk"
AAB_OUTPUT="aab/UTBA_BETA_${VERSION}.aab"
GRADLE_ARGS=()

if [ -n "${VERSION_CODE:-}" ]; then
  if ! [[ "$VERSION_CODE" =~ ^[0-9]+$ ]]; then
    echo "ERROR: VERSION_CODE must be a positive integer"
    exit 1
  fi
  GRADLE_ARGS+=("-PappVersionCode=$VERSION_CODE")
fi

if [ -n "${VERSION_NAME:-}" ]; then
  GRADLE_ARGS+=("-PappVersionName=$VERSION_NAME")
fi

if [ ${#GRADLE_ARGS[@]} -gt 0 ]; then
  echo "==> Using Android version settings..."
  [ -n "${VERSION_CODE:-}" ] && echo "    versionCode=$VERSION_CODE"
  [ -n "${VERSION_NAME:-}" ] && echo "    versionName=$VERSION_NAME"
fi

echo "==> [1/4] Building React bundle (APK mode)..."
npm run build:apk

echo "==> [2/4] Generating Android launcher icons and splash logo from logo..."
node <<'NODE'
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SRC = path.resolve('../static/images/logo/log222o.png');
const RES = path.resolve('android/app/src/main/res');
const SPLASH_DRAWABLE_DIR = path.join(RES, 'drawable-nodpi');
const LEGACY_DENSITIES = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];
const ADAPTIVE_DENSITIES = [
  { dir: 'mipmap-mdpi', size: 108 },
  { dir: 'mipmap-hdpi', size: 162 },
  { dir: 'mipmap-xhdpi', size: 216 },
  { dir: 'mipmap-xxhdpi', size: 324 },
  { dir: 'mipmap-xxxhdpi', size: 432 },
];
const ICON_BACKGROUND = '#FFFFFF';

async function renderContainedCanvas(size, innerRatio, background) {
  const innerSize = Math.round(size * innerRatio);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([
      {
        input: await sharp(SRC)
          .resize(innerSize, innerSize, { fit: 'contain' })
          .png()
          .toBuffer(),
        gravity: 'center',
      },
    ])
    .png()
    .toBuffer();
}

const adaptiveIconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;

(async () => {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Logo file not found: ${SRC}`);
  }

  const splashCanvasSize = 1024;
  const splashLogoSize = 560;
  fs.mkdirSync(SPLASH_DRAWABLE_DIR, { recursive: true });
  const splashLogo = await sharp({
    create: {
      width: splashCanvasSize,
      height: splashCanvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp(SRC)
          .resize(splashLogoSize, splashLogoSize, { fit: 'contain' })
          .png()
          .toBuffer(),
        gravity: 'center',
      },
    ])
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(SPLASH_DRAWABLE_DIR, 'splash_logo.png'), splashLogo);

  for (const { dir, size } of LEGACY_DENSITIES) {
    const dest = path.join(RES, dir);
    fs.mkdirSync(dest, { recursive: true });
    const buf = await renderContainedCanvas(size, 0.78, { r: 255, g: 255, b: 255, alpha: 1 });

    fs.writeFileSync(path.join(dest, 'ic_launcher.png'), buf);
    fs.writeFileSync(path.join(dest, 'ic_launcher_round.png'), buf);
  }

  for (const { dir, size } of ADAPTIVE_DENSITIES) {
    const dest = path.join(RES, dir);
    fs.mkdirSync(dest, { recursive: true });
    const buf = await renderContainedCanvas(size, 0.64, { r: 0, g: 0, b: 0, alpha: 0 });

    fs.writeFileSync(path.join(dest, 'ic_launcher_foreground.png'), buf);
  }

  const adaptiveDir = path.join(RES, 'mipmap-anydpi-v26');
  const valuesDir = path.join(RES, 'values');
  fs.mkdirSync(adaptiveDir, { recursive: true });
  fs.mkdirSync(valuesDir, { recursive: true });

  fs.writeFileSync(path.join(adaptiveDir, 'ic_launcher.xml'), adaptiveIconXml);
  fs.writeFileSync(path.join(adaptiveDir, 'ic_launcher_round.xml'), adaptiveIconXml);
  fs.writeFileSync(
    path.join(valuesDir, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${ICON_BACKGROUND}</color>
</resources>
`
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

echo "==> [3/4] Syncing to Android project..."
npx cap sync android

echo "==> [4/4] Building signed release APK and AAB..."
cd android
./gradlew assembleRelease bundleRelease "${GRADLE_ARGS[@]}"
cd ..

echo "==> Copying release artifacts..."
mkdir -p apk
mkdir -p aab
cp android/app/build/outputs/apk/release/app-release.apk "$APK_OUTPUT"
cp android/app/build/outputs/bundle/release/app-release.aab "$AAB_OUTPUT"

echo ""
echo "Done!"
echo "APK: $(ls -lh "$APK_OUTPUT" | awk '{print $5, $9}')"
echo "AAB: $(ls -lh "$AAB_OUTPUT" | awk '{print $5, $9}')"
echo "Files in apk/:"
ls -lht apk/*.apk 2>/dev/null | head -10
echo "Files in aab/:"
ls -lht aab/*.aab 2>/dev/null | head -10



# VERSION_CODE=12 VERSION_NAME=1.2.3 ./frontend/build_apk.sh
