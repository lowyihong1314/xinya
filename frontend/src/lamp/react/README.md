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

- `/api/lampRegistration_API/register`
- `/api/lampRegistration_API/get_by_ids`
- `/api/lampRegistration_API/delete`
- `/api/lampRegistration_API/get_all_register`
- `/api/lampRegistration_API/make_payment`

## Important behaviors

- `LampPage` uses `get_phone_on_localhost()` so the flow can continue with a verified phone number.
- Drafts are merged with fresh backend rows on load to avoid acting on deleted or changed records.
- `LampPaymentPage` calculates remaining amount from existing payment records before allowing a new payment.
- QR code payment uses a fixed DuitNow-style payload rendered client-side with `qrcode`.
- Non-cash methods require an uploaded proof file.

## Notes

- `render_lamp_init.js` remains as a compatibility mount for legacy callers.
- Colors in `LampPage.tsx` should come from `frontend/src/theme/designTokens.ts`.
- `render_payment_init.js` now only acts as a compatibility mount for old callers.
- The admin list currently lives inside the same page component rather than a separate route or module.
