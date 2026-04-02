# Long Open Registration Form React Module

## Entry points

- `LongOpenRegistrationFormPage.tsx` is the CRM workspace shell for long-open forms.
- `MembershipRegistrationPage.tsx` renders the membership admin flow inside that shell.
- `YouthClassRegistrationPage.tsx` renders the youth-class admin flow inside that shell.
- `FeeOptionEditor.tsx` is a reusable fee editor helper stored with the same workspace.

## Current behavior

- Keeps membership and youth-class tools under one React path instead of separate CRM folders.
- Switches between the two workflows inside the page itself instead of through URL query routing.
- Preserves old CRM aliases by redirecting them into `#/long_open_registration_form`.

## Notes

- Membership uses `/api/user_control/membership/*` endpoints.
- Youth class uses `/api/form/youth-class-registration/*` endpoints.
- Changes here should be tested from both the CRM sidebar entry and the legacy redirect paths.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
