# Permanent Registration React Module

React shell for CRM long-lived registration workflows.

## Files

- `PermanentRegistrationPage.tsx`: section switcher that hosts membership and youth-class registration pages.
- `FeeOptionEditor.tsx`: reusable editor for age-based fee rules.

## Page behavior

- Reads the active section from the `registration` query parameter.
- Keeps `crm=permanent_registration` in the URL while switching sections.
- Embeds:
  - `MembershipRegistrationPage`
  - `YouthClassRegistrationPage`

## FeeOptionEditor

The fee editor is a reusable helper for registration forms that need age-aware pricing:

- supports multiple fee rows
- stores age range, amount, and description
- includes normalization helpers for raw backend values
- includes a summary formatter for each fee row

## Upgrade notes

- This folder does not own the actual membership or youth-class workflows; it orchestrates and documents how they are grouped inside CRM.
- If the registration URL model changes, update both `CRM/react/CRMPage.tsx` and `PermanentRegistrationPage.tsx`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
