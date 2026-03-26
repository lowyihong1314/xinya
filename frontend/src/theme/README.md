# theme

Shared design token source for the React frontend.

## Files

- `designTokens.ts`: token object plus `ensureDesignTokens()`.

## How it works

- Tokens are authored as a plain object with color, radius, and font groups.
- `ensureDesignTokens()` injects a single `<style>` tag with CSS custom properties.
- The style tag is guarded by the `xinya-design-tokens` element id, so repeated calls are safe.

## Current token categories

- ink and muted text colors
- panel, canvas, and glass backgrounds
- accent, warning, danger, success, and info colors
- navbar gradient colors
- radii for small, medium, and large surfaces
- shared sans and mono font stacks

## Usage pattern

- Many pages call `ensureDesignTokens()` at render time so they stay safe even when mounted from older code paths.
- Components then consume CSS variables such as `--x-color-ink`, `--x-color-accent`, and `--x-radius-lg`.

## Upgrade notes

- Add new reusable colors here before hardcoding them inside feature components.
- If a variable name changes, audit all feature folders because styles are mostly inline and will not fail at compile time.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
