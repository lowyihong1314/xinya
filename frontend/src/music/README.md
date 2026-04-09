# music

Music library, playback queue, and admin workspace feature.

## Route

- `/music`

## Structure

- `music_player/logic`: shared music domain state, requests, queue logic, and helpers
- `music_player/ui/web`: web-only route composition and workspace shell
- `music_player/ui/mobile`: mobile-specific web UI
- `music_player/ui/desktop`: desktop-specific web UI
- `music_player/ui/shared`: shared player and listening panels
- `music_player/apk`: APK-only React UI and native bridge adapter
- `portal/app`, `portal/layout`, `portal/router`: dedicated music portal app shell, layout, and router

## Scope

This feature covers:

- album list and album detail loading
- track list search and selection
- queue management and playback state
- album creation, album editing, and album cover upload
- track upload, edit, delete, and file replacement
- in-page web playback workspace with a secondary nav for 找歌 / 播放器 / 列队 / 听歌记录

## Shared runtime role

The music feature still keeps its playback provider above the router in `src/app/App.tsx` for web, and web playback UI now stays inside the `/music/music_player` page through an in-page secondary nav. APK playback remains separate and native-driven under `frontend/android/app/src/main/java/com/xinya/app/`.

## Upgrade notes

- The UI for music management and the web player now live together under the music route.
- Web UI is split by platform under `ui/mobile` and `ui/desktop`; keep new UI work in those folders instead of adding more `isMobile` branching to route files.
- Any web playback change should still be reviewed with `logic/MusicPlaybackContext.tsx`; any APK playback or queue change should be reviewed with `NativeMusicPlugin.java` and `MusicService.java`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
