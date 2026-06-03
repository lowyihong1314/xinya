# APK Architecture

This document describes the current Android APK architecture for the `frontend/`
app. It reflects the native music implementation, Android Auto support, APK
caching, and the current build pipeline.

---

## Overview

The same React codebase is built into two different targets:

| Target | Command | Output | Runtime API base |
| --- | --- | --- | --- |
| Web / Flask | `npm run build` | `../static/vite/` | relative paths |
| Android APK | `npm run build:apk` | `apk_dist/` | `https://utbabuddha.com` |

The APK is a Capacitor Android app:

```text
React + Vite bundle
  -> Capacitor WebView
  -> Capacitor JS bridge
  -> Android native plugins
  -> Android services / storage / ExoPlayer
```

The normal CRM, album, info, lamp, profile, and most music UI screens still run
inside the WebView. Music playback in the APK is different: the UI is React, but
the playback engine and Android Auto catalog are native Android code.

---

## APK Mode Detection

`frontend/src/js/apiBase.ts` controls APK mode:

```ts
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string) ?? "";
export const IS_APK = Boolean(API_BASE);
```

APK builds load `frontend/.env.apk`, where `VITE_API_BASE` points to the
production server. Web builds leave `API_BASE` empty and use relative URLs.

`frontend/src/js/apiFetch.ts` prefixes relative API calls and, in Android/iOS
native runtime, attaches the saved mobile Bearer token:

```ts
export async function apiFetch(input: string | URL | Request, init?: RequestInit) {
  if (typeof input === "string" && input.startsWith("/")) {
    input = `${API_BASE}${input}`;
  }
  // Mobile native runtime also adds Authorization when NativeAuth has a token.
  return fetch(input, init);
}
```

For APK work, check `IS_APK` before assuming browser-only behavior. A page may
render in React, but its data or media may be served by a native plugin.

---

## App Bootstrap

Main entry:

```text
frontend/main.tsx
```

The entry does three important things:

1. Loads shared CSS.
2. Installs `installApkFetchCache()`.
3. Mounts `<App />`.

`frontend/src/app/App.tsx` intentionally behaves differently in APK mode:

```tsx
{IS_APK ? (
  <RouterProvider router={appRouter} />
) : (
  <MusicPlaybackProvider>
    <RouterProvider router={appRouter} />
  </MusicPlaybackProvider>
)}
```

For web, `MusicPlaybackProvider` owns the web playback state. For APK, native
Android owns playback state, so the React provider is not mounted.

---

## Routing

App routing is hash-based and starts in:

```text
frontend/src/router/appRouter.tsx
```

Music routes live in:

```text
frontend/src/music/router/routes.tsx
```

Current music route split:

```tsx
{ path: "music_player/*", element: IS_APK ? <MusicPageApk /> : <MusicPage /> }
```

Important APK navbar behavior is in:

```text
frontend/src/router/AppLayout.tsx
```

The music icon is allowed to show before user data is loaded:

```tsx
(!item.auth || user || (IS_APK && item.key === "music"))
```

This is why the APK can open the music player without waiting for login state.

---

## Native Music Architecture

APK music is not WebView `<audio>` anymore. The current architecture is:

```text
MusicPageApk.tsx
  -> nativeMusicClient.ts
  -> NativeMusicPlugin.java
  -> MusicService.java
  -> ExoPlayer + MediaSession + foreground notification
```

Main files:

| File | Role |
| --- | --- |
| `frontend/src/music/music_player/apk/MusicPageApk.tsx` | APK-only React music UI |
| `frontend/src/music/music_player/apk/nativeMusicClient.ts` | TypeScript wrapper for the `NativeMusic` Capacitor plugin |
| `frontend/android/app/src/main/java/com/xinya/app/NativeMusicPlugin.java` | Native bridge and APK music state owner |
| `frontend/android/app/src/main/java/com/xinya/app/NativeMusicRepository.java` | Native HTTP/data mapper for music API payloads |
| `frontend/android/app/src/main/java/com/xinya/app/MusicService.java` | Foreground playback service, ExoPlayer, MediaSession, Android Auto browser |

React controls the UI. Android controls playback, queue, progress, notification,
lock-screen controls, media buttons, and Android Auto visibility.

---

## NativeMusicPlugin

`NativeMusicPlugin.java` is the main bridge between React and Android. It owns:

- `albums`
- `musics`
- `musicById`
- `queueIds`
- `cachedTrackUrls`
- `storedCurrentMusicId`
- `repeatMode`
- `shuffleEnabled`
- listening summary state

Main plugin methods used by React:

- `bootstrap({ baseUrl, includeListening })`
- `refreshLibrary({ includeListening })`
- `getSnapshot()`
- `setCachedTrackSources({ items })`
- `playMusic({ musicId, queueIds })`
- `togglePlayback()`
- `appendToQueue({ musicId })`
- `removeFromQueue({ musicId })`
- `clearQueue()`
- `playFromQueue({ musicId })`
- `playRelative({ step })`
- `toggleShuffle()`
- `cycleRepeat()`
- `seekTo({ positionMs })`

It binds to `MusicService`, pushes catalog data to the service, and emits these
events back to React:

- `trackChanged`
- `trackEnded`
- `playStateChanged`

---

## MusicService

`MusicService.java` is a `MediaBrowserServiceCompat` foreground service.

It handles:

- ExoPlayer playlist playback.
- Android foreground media notification.
- Lock-screen and Bluetooth media controls.
- Media button receiver actions.
- MediaSession metadata, including title, album, duration, and artwork.
- Android Auto browse tree.
- Once-per-minute listening metric reporting.

The service is declared in `AndroidManifest.xml`:

```xml
<service
    android:name=".MusicService"
    android:exported="true"
    android:foregroundServiceType="mediaPlayback">
    <intent-filter>
        <action android:name="android.media.browse.MediaBrowserService" />
    </intent-filter>
</service>
```

Required permissions:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

---

## Android Auto

Android Auto is enabled by:

```xml
<meta-data
    android:name="com.google.android.gms.car.application"
    android:resource="@xml/automotive_app_desc" />
```

`frontend/android/app/src/main/res/xml/automotive_app_desc.xml` declares:

```xml
<automotiveApp>
    <uses name="media" />
</automotiveApp>
```

Android Auto does not read the React UI. It reads the media browser tree from
`MusicService.onGetRoot()` and `MusicService.onLoadChildren()`.

Current browse tree:

```text
root
  -> 全部歌曲
      -> playable tracks
  -> 专辑
      -> album folders
          -> playable tracks
```

`全部歌曲` uses the same list order as the React music page: tracks are sorted
by `play_minutes` descending, with the backend catalog order preserved for ties.
Album folders keep the backend catalog order for their tracks.

The catalog is loaded natively from the backend and cached in:

```text
music_catalog.json
```

inside the Android app files directory. The service keeps this catalog for
Android Auto and refreshes it when needed. This allows Android Auto to show the
player and library even if the React music page is not currently open.

---

## Album Art

Android Auto and media notifications need artwork that Android can read outside
the WebView. That is handled by:

```text
frontend/android/app/src/main/java/com/xinya/app/AlbumArtProvider.java
```

It exposes registered cover URLs as:

```text
content://com.xinya.app.albumart/art/<hash>
```

The provider downloads the remote image with the WebView cookie when available,
caches it under the Android cache directory, and serves the cached file to the
system UI or Android Auto.

React-side cover caching is handled by:

```text
frontend/src/components/CachedMedia.tsx
frontend/src/js/nativeMediaCache.ts
frontend/src/music/music_player/ui/shared/MusicCoverImage.tsx
```

In APK mode, `MusicCoverImage` uses stale-while-revalidate behavior so old
cached covers can show immediately while the APK refreshes them in the
background.

---

## Native Media Cache

APK media caching has two native plugins.

### NativeMediaCache

Files:

```text
frontend/src/js/nativeMediaCache.ts
frontend/android/app/src/main/java/com/xinya/app/NativeMediaCachePlugin.java
```

Used for remote media assets such as music covers and prewarmed audio files.
It stores files in the Android app cache directory:

```text
native-media-cache/
```

Event images and videos resolved through `smartImageURL()` / `smartMediaAsset()`
also use this cache. The default media cache limit is 10 GB, and the mobile
account settings page can persist a 1-50 GB limit. When the cache exceeds the
limit, native code removes the least-recently-used entries first.

`NativeApkMusic.syncCachedTrackSources()` prewarms selected music download URLs
and passes local `file://` URIs back to `NativeMusicPlugin`. If a track is cached,
`MusicService` can play the local file instead of streaming it again.

### NativeResponseCache

Files:

```text
frontend/src/js/apkFetchCache.ts
frontend/src/js/nativeResponseCache.ts
frontend/android/app/src/main/java/com/xinya/app/NativeResponseCachePlugin.java
```

`installApkFetchCache()` wraps global `fetch` in APK mode. It:

- rewrites local `/api`, `/media`, and `/media_file` URLs to `API_BASE`;
- caches safe `GET /api/*` text/json responses up to 4 MB;
- skips mutation-like routes;
- returns a cached response when the network request fails.

This is an offline fallback, not a replacement for server data consistency.

---

## Backend Endpoints Used By Native Music

`NativeMusicRepository.java` calls backend endpoints directly:

- `GET /api/music/albums`
- `GET /api/music/list?per_page=200&page=N`
- `GET /api/music/download/<music_id>`
- `GET /api/music/queue`
- `POST /api/music/queue`
- `GET /api/music/last_played`
- `POST /api/music/add_one_minute/<music_id>`
- `GET /api/music/minute_logs?per_page=240`

APK Listening Activity uses `apiFetch()` from the React APK page to load
`minute_logs` independently of the native catalog bootstrap, then groups raw
minute logs into sessions in the shared chart utilities. Both React and native
parsers accept backend `isoformat()` timestamps with fractional seconds.

Auth behavior:

- Albums, list, download, and cover can work without login.
- Queue, last-played, `add_one_minute`, and listening logs require login, but not
  `music_edit`.
- If the user is not logged in, playback still works, but queue restore and user
  listening history / minute tracking are unavailable.

Cookies come from Android WebView `CookieManager`, so cross-origin session cookie
settings still matter.

---

## Build Pipeline

Mobile config:

```text
frontend/capacitor.config.ts
frontend/vite.config.js
frontend/android/app/build.gradle
frontend/ios/App/App.xcodeproj
frontend/build_apk.sh
```

Capacitor config:

```ts
{
  appId: "com.xinya.app",
  appName: "UTBA",
  webDir: "apk_dist",
  server: {
    cleartext: false,
    androidScheme: "https",
  },
}
```

Production build:

```bash
cd /home/yukang/flaskapp/xinya/frontend
VERSION_CODE=12 VERSION_NAME=1.2.3 ./build_apk.sh
```

The script does:

1. `npm run build:apk`
2. Generates launcher icons and splash logo from the site logo.
3. `npx cap sync android`
4. `./gradlew assembleRelease bundleRelease`
5. Copies outputs to:

```text
frontend/apk/UTBA_BETA_YYYYMMDD_HHMM.apk
frontend/aab/UTBA_BETA_YYYYMMDD_HHMM.aab
```

For release versioning:

```bash
VERSION_CODE=12 VERSION_NAME=1.2.3 ./build_apk.sh
```

`build_apk.sh` requires both `VERSION_CODE` and `VERSION_NAME` for release
builds. This avoids accidentally publishing another APK with the default
`versionCode=1` / `versionName=1.0`.

Release signing is not hardcoded in `android/app/build.gradle`. Configure it via
the ignored local file:

```text
frontend/android/signing.properties
```

or via environment variables:

```text
XINYA_RELEASE_STORE_FILE
XINYA_RELEASE_STORE_PASSWORD
XINYA_RELEASE_KEY_ALIAS
XINYA_RELEASE_KEY_PASSWORD
```

Use `frontend/android/signing.properties.example` as the template for new
environments.

---

## Emulator Build

For local Android emulator testing against the local Flask server:

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run apk:prepare:emulator
```

This uses:

```text
VITE_API_BASE=http://10.0.2.2:5102
CAP_ANDROID_SCHEME=http
CAP_CLEARTEXT=true
```

Do not use this configuration for production builds.

---

## iOS Project

iOS is generated under:

```text
frontend/ios/
```

The project uses Swift Package Manager:

```text
frontend/ios/App/CapApp-SPM/Package.swift
```

Prepare and sync the iOS bundle:

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run ios:prepare
```

This runs:

1. `npm run build:mobile`
2. `npm run ios:assets`
3. `npm run cap:sync:ios`

`ios:assets` generates the iOS app icon and splash assets from
`static/images/logo/log222o.png`.

The iOS bundle id and display name are currently:

```text
PRODUCT_BUNDLE_IDENTIFIER = com.xinya.app
CFBundleDisplayName = UTBA
```

Background audio has been enabled in `ios/App/App/Info.plist`:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
```

Building and archiving iOS still requires macOS, Xcode, an Apple Developer team,
and provisioning profiles. Open the project on macOS with:

```bash
npm run cap:open:ios
```

---

## File Map

```text
frontend/
├── .env.apk
├── capacitor.config.ts
├── vite.config.js
├── build_apk.sh
├── Update_apk.md
├── Apk.md
├── apk/                         built APK output, ignored
├── aab/                         built AAB output, ignored
├── apk_dist/                    Vite APK build output, ignored
├── main.tsx                     React entry, installs APK fetch cache
├── scripts/
│   ├── generate_ios_assets.mjs  iOS app icon and splash generation
│   └── with_node22.sh           Node 22 wrapper for Capacitor commands
├── android/
│   └── app/
│       ├── build.gradle
│       ├── signing.properties.example
│       └── src/main/
│           ├── AndroidManifest.xml
│           ├── java/com/xinya/app/
│           │   ├── MainActivity.java
│           │   ├── NativeMusicPlugin.java
│           │   ├── NativeMusicRepository.java
│           │   ├── MusicService.java
│           │   ├── AlbumArtProvider.java
│           │   ├── NativeMediaCachePlugin.java
│           │   └── NativeResponseCachePlugin.java
│           └── res/xml/
│               ├── automotive_app_desc.xml
│               └── file_paths.xml
├── ios/
│   ├── .gitignore
│   └── App/
│       ├── App.xcodeproj
│       ├── App/
│       │   ├── AppDelegate.swift
│       │   ├── Info.plist
│       │   └── Assets.xcassets/
│       └── CapApp-SPM/
│           └── Package.swift
└── src/
    ├── app/App.tsx
    ├── js/apiBase.ts
    ├── js/apiFetch.ts
    ├── js/apkFetchCache.ts
    ├── js/nativeMediaCache.ts
    ├── js/nativeResponseCache.ts
    ├── mobile/native/
    │   ├── capacitor.ts
    │   └── musicPlugin.ts
    ├── router/AppLayout.tsx
    ├── router/appRouter.tsx
    └── music/
        ├── router/routes.tsx
        └── music_player/
            ├── apk/
            │   ├── MusicPageApk.tsx
            │   ├── nativeMusicClient.ts
            │   └── types.ts
            ├── logic/
            └── ui/
```

---

## Maintenance Notes

- `frontend/.gitignore` uses root-scoped `/apk/`, `/aab/`, and `/apk_dist/`
  patterns so APK source folders are not accidentally ignored.
- `frontend/.env.apk` should not contain secrets. Keep production secrets outside
  committed frontend env files.
- Release signing secrets must stay in `frontend/android/signing.properties`,
  Gradle properties, or environment variables. Do not put signing passwords back
  into `frontend/android/app/build.gradle`.
- `MusicPageApk.tsx` should remain UI/controller code. Queue ownership, playback,
  Android Auto catalog, and media session behavior belong in native Android code.
- Android Auto reads `MusicService`, not React. If Android Auto does not show the
  app, inspect `AndroidManifest.xml`, `automotive_app_desc.xml`, and
  `MusicService.onLoadChildren()` first.
- If covers do not show in Android Auto, inspect `AlbumArtProvider` and the cover
  URLs stored in the native catalog.
- If playback works in the APK but not in Android Auto, check that the native
  catalog has tracks and that media IDs parse correctly in `playFromBrowserMediaId`.
