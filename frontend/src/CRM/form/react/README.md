# Form React Module

## Entry points

- `FormWorkspacePage.tsx` is the mounted CRM page for the `register` module.
- `FormWorkspaceView.tsx` renders the full admin workspace once `useFormWorkspace()` has prepared data and actions.

## Main pieces

- `useFormWorkspace.ts`: loads forms, detail, fees, and extra fields; owns all create/edit/delete actions.
- `FormWorkspaceView.tsx`: list navigation, summary editor, field switches, event links, fees, extra fields, members, share actions, and Excel export.
- `FeePanel.tsx`: shared fee editor with HEIC image normalization and upload support.
- `ExtraFieldEditor.tsx`: CRUD editor for text, textarea, select, number, date, and checkbox extra fields.
- `showRegisterDetail.tsx`: member detail modal used for editing member data from the list.
- `api.ts`: `/api/form/*` helpers for forms, fees, events, members, and NRIC preview checks.
- `types.ts`: source of `FormRecord`, `FormMember`, `FormPayment`, fee, and extra-field shapes used by other CRM modules too.

## Important flows

- Opening a form triggers `fetchFormDetail()`, `listFees()`, and `listExtraFields()` together.
- Event binding is done through `showEventPicker()` and `/api/form/add_event` or `/remove_event`.
- Member detail editing and parental-form opening are coordinated from `useFormWorkspace.ts`.
- Member export is generated client-side with lazy-loaded `xlsx`.
- Share actions are exposed from the main workspace for both the registration page and payment page.

## Permission behavior

- The page now has three practical states: no access, read-only form access, and full edit access.
- `form_read` can read form structure and settings but cannot mutate them.
- `member_detail` unlocks the Members section and sensitive member detail modal.
- `form_edit` unlocks all form configuration changes and member mutations.
- When the backend withholds member data, the UI shows member counts and a permission hint instead of trying to open empty detail views.

## Shared dependencies

- `FeePanel.tsx` is reused by the long-open registration workspace under `frontend/src/CRM/long_open_registration_form/react`.
- `useFormWorkspace.ts` still calls the legacy `open_parental_form` helper from `static/js/form/parental/modal.js`.
- `useFormRealtime.ts` is a reserved hook for future live-refresh support and currently keeps the integration point isolated.

## Upgrade notes

- `normalizeFieldSwitches()` in `useFormWorkspace.ts` keeps older boolean fields and the newer `field_switches` object in sync; changing this shape has wide impact.
- Finance pages read `FormRecord` and `FormPayment` directly, so type changes here ripple into `frontend/src/CRM/Account/react`.
- If you add new extra-field types, update both `ExtraFieldEditor.tsx` and any consumer that formats member field values.

## React Router Migration Track

- The admin page is React-driven, but this folder still depends on imperative helpers such as `open_parental_form()` and body-mounted modal roots like `showRegisterDetail()` and `showEventPicker()`.
- The target design is one shared React portal/modal layer plus route-aware screens for public form registration, payment, parental consent, and any large detail flows.
- Do not add new UI imports from `static/js/form/*`; existing ones should be migrated into React components, hooks, and router-driven pages over time.
