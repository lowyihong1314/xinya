# APK Build — Architecture & Implementation

This document explains how the Android APK is built from the React frontend, with focus on the dual-mode architecture and the music player split.

---

## Overview

The same React codebase produces two separate artifacts:

| Target | Command | Output | API base |
|--------|---------|--------|----------|
| Web (Flask) | `npm run build` | `../static/vite/init.js` | relative (`""`) |
| Android APK | `npm run build:apk` | `apk_dist/` | `https://utbabuddha.com` |

The APK is then packaged by Capacitor → Gradle into a signed release APK at `apk/UTBA_YYYYMMDD_HHMM.apk`.

---

## Detecting APK mode at runtime

**`src/js/apiBase.ts`**

```ts
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string) ?? "";
export const IS_APK = Boolean(API_BASE);
```

- `VITE_API_BASE` is set to `https://utbabuddha.com` in `.env.apk` (loaded by `vite build --mode apk`).
- In web mode it is empty, so all `fetch` calls use relative paths.
- `IS_APK` is a compile-time constant — Vite tree-shakes the unused branch.

**`src/js/apiFetch.ts`** wraps every `fetch()` call across the codebase:

```ts
export function apiFetch(input: string | URL | Request, init?: RequestInit) {
  if (typeof input === "string" && input.startsWith("/")) {
    input = `${API_BASE}${input}`;
  }
  return fetch(input, init);
}
```

All 16 API modules use `apiFetch`. Static asset URLs (`<img src>`, audio `src`, cover images) are prefixed with `${API_BASE}` directly at use sites.

---

## Build pipeline

### `vite.config.js`

```js
const isApk = mode === "apk";

base: isApk ? "./" : isBuild ? "/static/vite/" : "/",
build: isApk
  ? { outDir: "apk_dist", emptyOutDir: true }   // standard index.html output
  : { outDir: "../static/vite", rollupOptions: { input: "main.tsx", ... } }
```

The APK build produces a normal `apk_dist/index.html` + assets. The web build produces a single `init.js` entry file loaded by the Flask HTML template.

### `capacitor.config.ts`

```ts
{
  appId: "com.xinya.app",
  appName: "UTBA",
  webDir: "apk_dist",          // Capacitor reads from here
  server: {
    cleartext: false,
    androidScheme: "https",    // app origin = https://localhost
  },
}
```

`androidScheme: "https"` means the WebView's origin is `https://localhost`, so requests to `https://utbabuddha.com` are cross-origin. This is why the Flask session cookie must be `SameSite=None; Secure` (set in `app/settings.py`).

### One-command build: `build_apk.sh`

```
npm run build:apk          # Vite → apk_dist/
node icon-gen (sharp)      # logo.png → mipmap-*/ic_launcher.png
npx cap sync android       # copy apk_dist → Android assets
./gradlew assembleRelease  # Kotlin → signed APK
cp → apk/UTBA_YYYYMMDD_HHMM.apk
```

---

## APK-specific concerns

### Cross-origin session cookies

Capacitor WebView origin (`https://localhost`) differs from the API server (`https://utbabuddha.com`). Without the right cookie flags, the session is never stored after login.

Fix in `app/settings.py`:

```python
SESSION_COOKIE_SAMESITE = "None"
SESSION_COOKIE_SECURE = True
```

And `app/factory.py` configures CORS with `supports_credentials=True`.

### App icon

`build_apk.sh` generates `ic_launcher.png` and `ic_launcher_round.png` from `../static/images/logo/logo.png` using `sharp` into all mipmap density folders.

The adaptive icon XMLs (`mipmap-anydpi-v26/ic_launcher.xml`) were deleted so Android 8+ uses the PNG files directly instead of the default vector foreground.

### Signing

Keystore lives at `android/app/utba-release.keystore` (gitignored). Credentials are hardcoded in `android/app/build.gradle` under `signingConfigs.release`. Back up the keystore separately — losing it means you cannot update the app on the same package ID.

### Background audio permissions

`AndroidManifest.xml` declares:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

These allow the Media Session API (already wired in `MusicPlayerController`) to register a persistent notification with playback controls, reducing the chance of Android killing the audio.

---

## Music player — dual-mode split

This is the most complex APK-specific piece. **Web and APK share the same playback state context but use completely different UIs.**

### Shared layer: `MusicPlaybackContext`

`src/music/react/MusicPlaybackContext.tsx` is the single source of truth for:

- Current track (`currentMusicId`, `currentMusic`)
- Queue (`queue`, `queueIds`)
- Play state (`isPlaying`, `hasPlaybackSession`)
- Shuffle / repeat mode
- `autoplayKey` — incrementing integer that triggers autoplay after a track change

This context sits **above** the router in `App.tsx`, so playback state survives page navigation.

### Audio management: `MusicPlayerController`

`src/music/react/MusicPlayerController.ts` is a DOM controller (not a React component) that:

- Creates a `<audio>` element appended to `document.body`
- Drives it from `sync(options: SyncOptions)` called in `AppLayout`'s `useEffect`
- Sets up the **Web Media Session API** (Android notification bar controls, lock-screen controls)
- Persists playback position to `localStorage` per track

`AppLayout.tsx` calls `musicPlayerController.sync({...})` on every relevant state change.

#### APK mode: hidden flag

`SyncOptions` has a `hidden?: boolean` field. When `IS_APK` is true, `AppLayout` passes `hidden: true`:

```ts
musicPlayerController.sync({
  ...allPlaybackState,
  hidden: IS_APK,   // hides floating UI; audio + Media Session still work
});
```

Inside `render()`, when `hidden` is true, `this.root.style.display = "none"` and returns early — the floating draggable panel never appears. The `<audio>` element and Media Session continue working normally.

#### Public control methods (for APK UI)

Since the audio element is private to the controller, these methods were added for `MusicPageApk` to call:

```ts
musicPlayerController.togglePlay()        // play ↔ pause
musicPlayerController.seekTo(time)        // set audio.currentTime
musicPlayerController.getProgress()       // returns audio.currentTime
musicPlayerController.getDuration()       // returns audio.duration
```

### Web music page: `MusicPage`

`src/music/react/MusicPage.tsx` — the full CMS workspace with album management, track upload/edit, and search. Only shown in web mode. The floating draggable player appears globally (not inside this page).

### APK music page: `MusicPageApk`

`src/music/react/MusicPageApk.tsx` — read-only music browser + integrated player. Shown instead of `MusicPage` when `IS_APK` is true.

**Screen flow:**

```
albums screen  →  (tap album)  →  tracks screen
                                        ↓ (tap track)
                             mini player bar (bottom, always visible)
                                        ↓ (tap bar)
                             full-screen player overlay
```

**Mini player bar** — always visible at the bottom when `hasPlaybackSession` is true. Shows cover, title, Prev/Play/Next buttons. Controlled via `musicPlayerController.togglePlay()` and `playRelative()` from the context.

**Full-screen player** — covers the whole screen. Shows large cover, draggable progress bar (`<input type="range">`), transport controls, shuffle/repeat toggles. Progress is polled every 500 ms via `setInterval` calling `musicPlayerController.getProgress()` while playing.

**Route selection in `appRouter.tsx`:**

```tsx
{ path: "music", element: IS_APK ? <MusicPageApk /> : <MusicPage /> }
```

---

## Login page

`src/app/LoginPage.tsx` — full-page login that works in both APK and web. Replaces the old modal (`LoginModal` in `UserState.tsx` has been removed).

`openLogin(from?)` in `UserStateProvider` now navigates via `window.location.hash = '/login?from=...'` rather than opening an overlay. This works from outside the router context (e.g., from `window.__xinyaOpenLogin`).

After successful login, `LoginPage` navigates back to the `from` parameter.

---

## App download page

`app/app_release/routes.py` serves:

- `GET /api/app/releases` — lists all `.apk` files in `frontend/apk/`, sorted by mtime descending, with filename, size, and download URL
- `GET /api/app/download/<filename>` — streams the APK with path traversal protection

`src/profile/react/ProfilePage.tsx` shows the download list in the **Account** section under `AppDownloadCard`. Releases are fetched once on first open (guarded by a `useRef` flag to prevent re-fetch on error).

---

## File map — APK-related files

```
frontend/
├── .env.apk                          VITE_API_BASE for APK build
├── capacitor.config.ts               Capacitor config (webDir, androidScheme)
├── build_apk.sh                      One-command build script
├── Update_apk.md                     Step-by-step update guide
├── apk/                              Built APK output (gitignored)
├── apk_dist/                         Vite APK build output (gitignored)
├── android/
│   ├── app/build.gradle              Signing config (utba-release.keystore)
│   ├── app/src/main/AndroidManifest.xml  Background audio permissions
│   └── app/src/main/res/mipmap-*/   Logo icons (generated by build_apk.sh)
└── src/
    ├── js/apiBase.ts                 API_BASE + IS_APK constants
    ├── js/apiFetch.ts                fetch wrapper that prepends API_BASE
    ├── app/LoginPage.tsx             Full-page login (APK + web)
    ├── app/UserState.tsx             Auth context; openLogin() uses hash nav
    ├── router/appRouter.tsx          Switches MusicPage ↔ MusicPageApk
    ├── router/AppLayout.tsx          Passes hidden: IS_APK to controller
    └── music/react/
        ├── MusicPageApk.tsx          APK-only full-page player
        ├── MusicPlayerController.ts  Audio engine; hidden mode + public API
        ├── MusicPlaybackContext.tsx  Shared playback state (above router)
        └── MusicPage.tsx             Web-only CMS workspace
```
