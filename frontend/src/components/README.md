# components

Reusable React UI pieces shared across multiple feature modules.

## Files

- `CacheMediaPlayer.tsx`: media renderer with smart image/video resolution, HEIC fallback, cache invalidation, and optional realtime progress listening.
- `PageHero.tsx`: large visual hero banner driven by shared event data and rendered media.

## CacheMediaPlayer

Key responsibilities:

- resolve media through `smartMediaAsset()` from `src/js/get_img.ts`
- render either `<img>` or `<video>` depending on the resolved asset kind
- retry video asset resolution while processing is still underway
- react to upload progress notifications from `album/react/mediaRealtime.ts`
- optionally connect to an event media socket room when `listenProgress` is enabled

This component is the shared media primitive for pages that display backend-managed event images or videos.

## PageHero

Key responsibilities:

- read the global event list from `useEventData()`
- pick up to ten events with `event_image`
- rotate hero media on a timer
- allow video slides to advance on `onEnded`
- adapt spacing and scale for mobile via `useUserState()`

## Upgrade notes

- `PageHero` currently assumes the shared event list is already sorted and populated by `EventDataProvider`.
- `CacheMediaPlayer` depends on both media lookup caching and realtime event media notifications, so changes in media API shape usually require touching more than one folder.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
