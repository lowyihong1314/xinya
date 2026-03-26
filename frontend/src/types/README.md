# types

Global browser type declarations shared by the frontend shell.

## Files

- `global.d.ts`: extends `Window` and includes `vite/client` types.

## Declared globals

The current declarations cover hybrid runtime bridges such as:

- `window.app`
- `window.base_navbar`
- `window.__xinyaNavigate`
- `window.__xinyaFetchUserAuth`
- `window.__xinyaOpenLogin`

## Why this folder matters

The React app still interoperates with older modules that expect browser globals instead of React context. Keeping those globals typed here prevents ad-hoc `any` usage across the codebase.

## Upgrade notes

- When adding or removing a bridge on `window`, update this file in the same change.
- If legacy mount code starts using new globals without typing them here, TypeScript coverage in React modules will drift from runtime reality.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
