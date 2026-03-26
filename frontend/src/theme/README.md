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
