# music

Music library, playback queue, and admin workspace feature.

## Route

- `/music`

## Structure

- `react/`: music workspace UI, playback context, controller, and API helpers

## Scope

This feature covers:

- album list and album detail loading
- track list search and selection
- queue management and playback state
- album creation, album editing, and album cover upload
- track upload, edit, delete, and file replacement
- floating player behavior shared with the wider app shell

## Shared runtime role

The music feature is special because its playback provider is mounted above the router in `src/app/App.tsx`, not only inside the `/music` page. That lets the floating player survive route changes.

## Upgrade notes

- The UI for music management lives under `react/`, but playback state affects `AppLayout` globally.
- Any change to queue persistence or playback state should be reviewed in both `MusicPlaybackContext.tsx` and `router/AppLayout.tsx`.
