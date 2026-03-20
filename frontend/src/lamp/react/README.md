# Lamp React Module

React migration entry for the lamp registration flow.

## Current scope

- Draft list from `localStorage`
- New lamp registration form
- Refresh draft state from backend
- Delete registration draft
- Route entry is now direct React via `appRouter.tsx`
- Payment flow now renders through `LampPaymentPage.tsx`
- Simple admin registration list

## Notes

- `render_lamp_init.js` remains as a compatibility mount for legacy callers.
- Colors in `LampPage.tsx` should come from `frontend/src/theme/designTokens.ts`.
- `render_payment_init.js` now only acts as a compatibility mount for old callers.
