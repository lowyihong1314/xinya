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

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
