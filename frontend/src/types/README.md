# types

Global browser type declarations shared by the frontend shell.

## Files

- `global.d.ts`: includes `vite/client` types and any future ambient frontend declarations.

## Why this folder matters

This folder keeps ambient frontend types in one place so the app shell and feature modules do not need scattered triple-slash references or local `declare global` blocks.

## Upgrade notes

- `global.d.ts` is intentionally minimal right now because most runtime bridges were removed during the React Router cleanup.
- If a new ambient browser type is truly needed, add it here in the same change that introduces the runtime behavior.

## Current direction

- Prefer typed modules, React context, and router helpers over new `window` globals.
- Treat new ambient declarations here as a last resort, not a default extension point.
