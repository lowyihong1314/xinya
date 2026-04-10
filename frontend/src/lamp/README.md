# lamp

Lamp registration and payment feature.

## Route and compatibility entrypoints

- Router path: `/lamp-registration`
- Compatibility entrypoints:
  - `render_lamp_init.js`
  - `render_payment_init.js`

## Structure

- `react/`: primary React implementation for registration and payment
- `render_lamp_init.js`: asks the shared router bridge to open the lamp route
- `render_payment_init.js`: stores the selected drafts and routes into the same lamp page flow

## Runtime flow

1. verify or restore the phone number with `get_phone_on_localhost()`
2. restore local draft registrations from `localStorage`
3. refresh those draft ids from the backend when possible
4. submit new lamp registrations
5. open payment flow for selected drafts

## Local persistence

- local storage key: `lamp_drafts`

## Upgrade notes

- This module still supports both direct router rendering and older callers that enter through compatibility functions.
- Payment now stays inside the routed React flow; compatibility code only bridges navigation and selected draft state.

## Next cleanup target

- The next useful refinement is a nested payment route such as `/lamp-registration/payment`, so the current in-page payment state can move fully into React Router.
- Once all callers use the routed entry directly, the compatibility shims can become thin aliases or disappear entirely.
