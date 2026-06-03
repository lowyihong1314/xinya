#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

export JAVA_HOME="${JAVA_HOME:-$HOME/android-build/jdk/jdk-21.0.3+9}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-build/sdk}"

NODE_BIN_DIR=""
CURRENT_NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
if [ "$CURRENT_NODE_MAJOR" -lt 22 ] && [ -x /usr/bin/node ]; then
  SYSTEM_NODE_MAJOR=$(/usr/bin/node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
  if [ "$SYSTEM_NODE_MAJOR" -ge 22 ]; then
    NODE_BIN_DIR="/usr/bin"
  fi
fi

export PATH="$JAVA_HOME/bin${NODE_BIN_DIR:+:$NODE_BIN_DIR}:$PATH"

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Capacitor 8 requires Node.js >= 22. Current node: $(node -v 2>/dev/null || echo missing)"
  exit 1
fi

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "ERROR: JAVA_HOME is not set to a valid JDK: $JAVA_HOME"
  exit 1
fi

if [ ! -d "$ANDROID_HOME" ]; then
  echo "ERROR: ANDROID_HOME is not set to a valid Android SDK: $ANDROID_HOME"
  exit 1
fi

VERSION="$(date +%Y%m%d_%H%M)"
BUILD_NUMBER="${BUILD_NUMBER:-9}"
if ! [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "ERROR: BUILD_NUMBER must be a positive integer"
  exit 1
fi
ANDROID_BUILD_SUFFIX=$(printf "%02d" "$((10#$BUILD_NUMBER))")
VERSION_NAME="${VERSION_NAME:-1.5.0}"
VERSION_CODE="${VERSION_CODE:-$(date +%Y%m%d)${ANDROID_BUILD_SUFFIX}}"
IOS_BUILD_NUMBER="${IOS_BUILD_NUMBER:-$BUILD_NUMBER}"
VERSION_NAME_SAFE="$(printf '%s' "$VERSION_NAME" | tr -c 'A-Za-z0-9._-' '_')"
MOBILE_ARTIFACT_LABEL="v${VERSION_NAME_SAFE}_b${BUILD_NUMBER}_${VERSION}"
APK_OUTPUT="apk/UTBA_BETA_${MOBILE_ARTIFACT_LABEL}.apk"
AAB_OUTPUT="aab/UTBA_BETA_${MOBILE_ARTIFACT_LABEL}.aab"
IOS_ARCHIVE_OUTPUT="ios_archive/UTBA_${VERSION}.xcarchive"
IPA_OUTPUT_DIR="ipa/UTBA_${VERSION}"
GRADLE_ARGS=()

if ! [[ "$VERSION_CODE" =~ ^[0-9]+$ ]]; then
  echo "ERROR: VERSION_CODE must be a positive integer"
  exit 1
fi

if ! [[ "$IOS_BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "ERROR: IOS_BUILD_NUMBER must be a positive integer"
  exit 1
fi

GRADLE_ARGS+=("-PappVersionCode=$VERSION_CODE")
GRADLE_ARGS+=("-PappVersionName=$VERSION_NAME")
export VERSION_NAME VERSION_CODE IOS_BUILD_NUMBER

echo "==> Using mobile version settings..."
echo "    Android versionCode=$VERSION_CODE"
echo "    Android versionName=$VERSION_NAME"
echo "    iOS MARKETING_VERSION=$VERSION_NAME"
echo "    iOS CURRENT_PROJECT_VERSION=$IOS_BUILD_NUMBER"

echo "==> [1/7] Building React bundle (mobile/APK mode)..."
npm run build:apk

echo "==> [2/7] Generating Android launcher icons and splash logo from logo..."
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

echo "==> [3/7] Generating iOS assets and setting iOS version..."
npm run ios:assets
node <<'NODE'
const fs = require('fs');
const path = require('path');

const versionName = process.env.VERSION_NAME || '1.5.0';
const iosBuildNumber = process.env.IOS_BUILD_NUMBER || process.env.VERSION_CODE || '1';
const projectFile = path.resolve('ios/App/App.xcodeproj/project.pbxproj');

let content = fs.readFileSync(projectFile, 'utf8');
content = content
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${versionName};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${iosBuildNumber};`);
fs.writeFileSync(projectFile, content);
NODE

echo "==> [4/7] Syncing Capacitor projects..."
npx cap sync android
IOS_SYNCED=false
if npx cap sync ios; then
  IOS_SYNCED=true
else
  echo "WARN: Capacitor iOS sync failed on this machine. Android build will continue."
fi

echo "==> [5/7] Building signed Android release APK and AAB..."
cd android
./gradlew assembleRelease bundleRelease "${GRADLE_ARGS[@]}"
cd ..

echo "==> Copying Android release artifacts..."
mkdir -p apk
mkdir -p aab
cp android/app/build/outputs/apk/release/app-release.apk "$APK_OUTPUT"
cp android/app/build/outputs/bundle/release/app-release.aab "$AAB_OUTPUT"

echo "==> [6/7] Preparing iOS archive..."
if ! command -v xcodebuild >/dev/null 2>&1; then
  if [ "$IOS_SYNCED" = "true" ]; then
    echo "SKIP: xcodebuild is unavailable on this machine. iOS web assets were generated and synced."
  else
    echo "SKIP: xcodebuild is unavailable on this machine, and iOS sync did not complete here."
  fi
elif [ "$IOS_SYNCED" != "true" ]; then
  echo "SKIP: iOS archive requires a successful Capacitor iOS sync."
else
  mkdir -p ios_archive ipa
  xcodebuild \
    -project ios/App/App.xcodeproj \
    -scheme App \
    -configuration Release \
    -archivePath "$IOS_ARCHIVE_OUTPUT" \
    archive

  EXPORT_OPTIONS_PLIST="${IOS_EXPORT_OPTIONS_PLIST:-ios/App/ExportOptions.plist}"
  if [ -f "$EXPORT_OPTIONS_PLIST" ]; then
    xcodebuild \
      -exportArchive \
      -archivePath "$IOS_ARCHIVE_OUTPUT" \
      -exportPath "$IPA_OUTPUT_DIR" \
      -exportOptionsPlist "$EXPORT_OPTIONS_PLIST"
  else
    echo "SKIP: iOS IPA export needs $EXPORT_OPTIONS_PLIST."
    echo "      Copy ios/App/ExportOptions.plist.example to ios/App/ExportOptions.plist and configure signing."
  fi
fi

echo "==> [7/7] Build outputs..."
echo "APK: $(ls -lh "$APK_OUTPUT" | awk '{print $5, $9}')"
echo "AAB: $(ls -lh "$AAB_OUTPUT" | awk '{print $5, $9}')"
if [ -d "$IOS_ARCHIVE_OUTPUT" ]; then
  echo "iOS archive: $IOS_ARCHIVE_OUTPUT"
fi
if [ -d "$IPA_OUTPUT_DIR" ]; then
  echo "IPA export dir: $IPA_OUTPUT_DIR"
fi
echo "Files in apk/:"
ls -lht apk/*.apk 2>/dev/null | head -10
echo "Files in aab/:"
ls -lht aab/*.aab 2>/dev/null | head -10

echo ""
echo "Done."
echo "Example:"
echo "  VERSION_NAME=1.5.0 BUILD_NUMBER=9 ./frontend/build_apk_ios.sh"
