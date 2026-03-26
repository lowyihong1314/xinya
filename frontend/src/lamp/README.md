# lamp

Lamp registration and payment feature.

## Route and compatibility entrypoints

- Router path: `/lamp-registration`
- Legacy compatibility mounts:
  - `render_lamp_init.js`
  - `render_payment_init.js`

## Structure

- `react/`: primary React implementation for registration and payment
- `render_lamp_init.js`: mounts `LampPage` into a legacy host node
- `render_payment_init.js`: mounts `LampPaymentPage` for old callers and returns to `LampPage` after completion

## Runtime flow

1. verify or restore the phone number with `get_phone_on_localhost()`
2. restore local draft registrations from `localStorage`
3. refresh those draft ids from the backend when possible
4. submit new lamp registrations
5. open payment flow for selected drafts

## Local persistence

- local storage key: `lamp_drafts`

## Upgrade notes

- This module still supports both direct router rendering and older imperative render functions.
- Payment is tightly coupled to the same host element because the legacy compatibility layer swaps between page components in place.
