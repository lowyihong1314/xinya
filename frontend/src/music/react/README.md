# Music React Module

React migration target for the music player workspace.

## Scope

- Album list
- Track list and search
- Audio playback
- Previous / next track controls
- Create album
- Delete album
- Upload album cover
- Upload music files
- Delete music

## Notes

- Playback uses native `<audio>` for now instead of the old WaveSurfer-based visual player.
- New colors must come from `frontend/src/theme/designTokens.ts`.
- `MusicPage.tsx` now stays as a thin composition layer.
- `useMusicWorkspace.ts` owns workspace state, API orchestration, and screen navigation.
- `workspaceTypes.ts` holds shared workspace drafts and screen/editor enums.
- `types.ts` now includes a `PlaylistRecord` model stub so personal playlists can be added without reworking the music domain types again.
