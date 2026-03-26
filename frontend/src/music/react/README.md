# Music React Module

React migration target for the music player workspace.

## Files

- `MusicPage.tsx`: thin route component that binds `useMusicWorkspace()` to the workspace panel UI.
- `useMusicWorkspace.ts`: main state machine for albums, tracks, editors, uploads, search, and toasts.
- `MusicWorkspacePanel.tsx`: presentational workspace UI for albums, tracks, and editor screens.
- `MusicPlaybackContext.tsx`: global queue and playback state with localStorage persistence.
- `MusicPlayerController.ts`: imperative floating player mounted to `document.body`.
- `MusicPlayerPanel.tsx`: reusable in-page player panel UI.
- `api.ts`: music and album backend requests.
- `types.ts`: album and music records.
- `workspaceTypes.ts`: editor mode, drafts, screen enums, and toast types.

## Scope

- album list and pagination
- track list and search
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

- `MusicPlaybackContext.tsx` persists queue ids and current music id in localStorage.
- `AppLayout.tsx` syncs context state into `musicPlayerController`.
- The floating controller owns its own DOM tree and media element outside the React route subtree.
- `useMusicWorkspace()` populates the playback library so queue ids can resolve into full track records.

## Auth and permissions

- `canManage` is currently derived from `Boolean(user?.username)`.
- Read-only browsing and playback can still work without admin actions.

## Notes

- Playback uses native `<audio>` for now instead of the old WaveSurfer-based visual player.
- New colors must come from `frontend/src/theme/designTokens.ts`.
- `MusicPage.tsx` now stays as a thin composition layer.
- `useMusicWorkspace.ts` owns workspace state, API orchestration, and screen navigation.
- `workspaceTypes.ts` holds shared workspace drafts and screen/editor enums.
- `types.ts` now includes a `PlaylistRecord` model stub so personal playlists can be added without reworking the music domain types again.
- Local storage keys include the queue, current track id, floating player position, and progress restore data.
