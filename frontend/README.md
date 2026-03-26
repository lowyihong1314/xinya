# frontend

Top-level Vite frontend for the React migration of the Xinya site.

## Stack

- Vite 8 for local dev and bundling.
- React 19 and React DOM 19.
- React Router 7 with `createHashRouter`.
- TypeScript for the new app shell and most React modules.
- Font Awesome CSS loaded once from `main.tsx`.

## Runtime entry

- `main.tsx` is the browser entrypoint.
- It mounts the app into `#root` or `#app`.
- It detects mobile layout with `matchMedia("(max-width: 900px)")`.
- It injects Font Awesome CSS only once before rendering React.

## App shell

- `src/app/App.tsx` wires global providers and the router.
- Provider order is:
  - `UserStateProvider`
  - `EventDataProvider`
  - `MusicPlaybackProvider`
  - `RouterProvider`
- `src/router/appRouter.tsx` defines the hash routes and a few standalone routes.

## Main routes

- `/` -> album home page
- `/info` -> organization intro and history
- `/crm` -> CRM workspace
- `/profile` -> current user profile and membership actions
- `/music` -> music library and playback workspace
- `/changyou` -> changyou list and detail pages
- `/lamp-registration` -> lamp registration and payment flow
- `/event/:eventId` -> event detail page
- `/image/:imageId` -> album image detail page
- `/changyou-room` and `/changyou-room/:roomId` -> standalone room experience
- `/payment-voucher-sign/:token` -> standalone payment signature page

## Directory map

- `src/app`: app composition and auth state shell.
- `src/router`: route config, layout shell, and legacy query bridge.
- `src/theme`: design token source and CSS variable injection.
- `src/types`: browser global declarations used by the hybrid app.
- `src/components`: reusable React UI helpers.
- `src/js`: shared browser utilities used by both legacy and React code.
- `src/event`: shared event domain state and APIs.
- `src/album`, `src/info`, `src/lamp`, `src/music`, `src/profile`, `src/changyou`: feature modules.
- `src/CRM`: CRM-side React migration and shared domain logic.

## Legacy compatibility

- The shell still exposes browser globals such as `window.__xinyaNavigate`, `window.__xinyaFetchUserAuth`, and `window.__xinyaOpenLogin`.
- `AppLayout` also converts legacy `?page=...` URLs into router paths.
- Some modules still ship compatibility render functions for legacy callers, especially under `src/lamp`.

## Android APK

See **[Apk.md](./Apk.md)** for the complete APK implementation guide, including:

- Dual-build setup (web vs APK mode, `IS_APK`, `API_BASE`)
- One-command build script (`build_apk.sh`) and signing
- Cross-origin cookie fix for Capacitor WebView
- Music player split — how Web and APK share state but use different UIs
- `MusicPlayerController` hidden mode and public audio control API
- App download endpoint and profile page integration

## Upgrade notes

- Routing is hash-based, so links and redirects should use router navigation, not hardcoded server paths.
- Global styling tokens are injected at runtime by `ensureDesignTokens()`. New shared colors should be added there first.
- Music playback is global and outlives the visible `/music` page because the playback provider sits above the router.
- Shared event data is also global; React event-related pages should reuse `useEventData()` instead of fetching their own sorted event list.

## React Router Migration Track

- Current audit result: the app shell is on React Router, but frontend is not yet fully route-driven because CRM modules still switch through `?crm=`, permanent registration still switches through `?registration=`, finance still switches through `?account_router=`, and the shell still carries `?page=` plus `window.__xinyaNavigate` compatibility.
- The full migration plan now lives in `frontend/Agent_todo.md` and should be treated as the source of truth for path design and legacy removal sequencing.
- End-state for this repo is path-based React Router navigation, React portals for overlay UI, and zero runtime dependence on `window.app`, `reset_style()`, `Legacy*` mount helpers, `render_*_init.js`, `static/js/form/*`, or `static/js/sign_tools.js`.
