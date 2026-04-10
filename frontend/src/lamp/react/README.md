# Lamp React Module

React migration entry for the lamp registration flow.

## Files

- `LampPage.tsx`: registration form, local draft list, draft refresh, admin list, and payment entry.
- `LampPaymentPage.tsx`: payment summary, QR code rendering, proof upload, and payment submission.
- `api.ts`: registration, draft lookup, deletion, payment posting, and admin list fetches.

## Current scope

- draft list restored from `localStorage`
- new lamp registration form
- refresh draft state from backend using saved ids
- delete registration draft
- payment flow for one or more selected records
- simple admin registration list for authenticated users

## Backend endpoints

- `/api/lampRegistration_API/registrations`
- `/api/lampRegistration_API/registrations/query`
- `/api/lampRegistration_API/registrations/:id`
- `/api/lampRegistration_API/payments`

Legacy aliases such as `/api/lampRegistration_API/register` and `/api/lampRegistration_API/make_payment` are still preserved for backward compatibility.

## Important behaviors

- `LampPage` uses `get_phone_on_localhost()` so the flow can continue with a verified phone number.
- Drafts are merged with fresh backend rows on load to avoid acting on deleted or changed records.
- `LampPaymentPage` calculates remaining amount from existing payment records before allowing a new payment.
- QR code payment uses a fixed DuitNow-style payload rendered client-side with `qrcode`.
- Non-cash methods require an uploaded proof file.

## Notes

- `render_lamp_init.js` remains as a compatibility router shim for older callers.
- Colors in `LampPage.tsx` and `LampPaymentPage.tsx` come from `frontend/src/theme/designTokens.ts` via `useEnsureDesignTokens()`.
- `render_payment_init.js` only stashes the selected drafts and routes into the same lamp page flow.
- The admin list currently lives inside the same page component rather than a separate route or module.

## Route direction

- The remaining route-level improvement here is a dedicated payment child route instead of keeping payment mode in page-local state.
- Do not reintroduce host-node swapping, ad-hoc roots, or direct browser-location navigation when touching this feature.
