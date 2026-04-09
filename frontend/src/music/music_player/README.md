# Music React Module

React migration target for the music player workspace.

## Directory layout

- `logic/`: playback context, API requests, search/workspace state, cover helpers, and shared domain types.
- `ui/web/`: web route composition layer and the shared web workspace shell.
- `ui/mobile/`: mobile-only web UI fragments.
- `ui/desktop/`: desktop-only web UI fragments.
- `ui/shared/`: shared player / chart panels used by both web and APK flows.
- `apk/`: APK-only React UI and native bridge adapter.

## Main entry points

- `ui/web/MusicPage.tsx`: thin route component that binds `useMusicWorkspace()` to the web workspace UI.
- `ui/web/MusicPlaybackWorkspace.tsx`: in-page secondary nav workspace for 找歌 / 播放器 / 列队 / 听歌记录.
- `logic/useMusicWorkspace.ts`: main state machine for albums, tracks, editors, uploads, search, and toasts.
- `logic/MusicPlaybackContext.tsx`: global queue and playback state with localStorage persistence.
- `ui/shared/MusicPlayerPanel.tsx`: reusable in-page player panel UI.
- `apk/MusicPageApk.tsx`: APK music screen.
- `frontend/android/app/src/main/java/com/xinya/app/NativeMusicPlugin.java`: APK music bridge and native source of truth for library / queue / playback.
- `frontend/android/app/src/main/java/com/xinya/app/MusicService.java`: Android foreground playback service and minute logging.

## Scope

- album list and pagination
- track list and search
- listening activity chart and summary
- audio playback and queue management
- previous / next / shuffle / repeat controls
- create, edit, and delete albums
- upload album cover
- upload, edit, replace, and delete music files

## Backend endpoints

- `/api/music/albums`
- `/api/music/albums/:albumId`
- `/api/music/albums/:albumId/upload_cover`
- `/api/music/list`
- `/api/music/detail/:musicId`
- `/api/music/album`
- `/api/music/album/:albumId`
- `/api/music/upload`
- `/api/music/delete/:musicId`
- `/api/music/edit/:musicId`
- `/api/music/replace/:musicId`

## Playback model

- `logic/MusicPlaybackContext.tsx` persists queue ids and current music id in localStorage.
- Web playback lives inside the music page itself and stays mounted while users switch between 找歌 / 播放器 / 列队 / 听歌记录.
- APK playback, queue persistence, library bootstrap, and minute logging live in Android native code under `frontend/android/app/src/main/java/com/xinya/app/`.
- `logic/useMusicWorkspace.ts` populates the playback library so queue ids can resolve into full track records.

## Auth and permissions

- `canManage` is currently derived from `Boolean(user?.username)`.
- Read-only browsing and playback can still work without admin actions.

## Notes

- Playback uses native `<audio>` on web and the native plugin on APK.
- New colors must come from `frontend/src/theme/designTokens.ts`.
- `ui/web/MusicPage.tsx` stays as a thin composition layer.
- `logic/` owns workspace state, API orchestration, and playback state.
- `ui/mobile/` and `ui/desktop/` hold form-factor-specific UI so responsive logic stops accumulating in one file.
- `apk/MusicPageApk.tsx` should stay UI-only; do not move APK queue or playback logic back into React.

## React Router Migration Track

- Route navigation and web playback now both live inside the React tree.
- Keep new playback UI route-local; do not reintroduce floating DOM-built overlays for web.
