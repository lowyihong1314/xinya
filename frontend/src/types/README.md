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
