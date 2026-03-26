# Youth Class

## Purpose

- This directory contains the admin flow for the always-open youth-class registration program.
- Like membership, it is rendered inside `frontend/src/CRM/permanent_registration/react/PermanentRegistrationPage.tsx`.

## Current scope

- Review youth-class registration entries and payment status.
- Maintain public fee settings for the program.
- Generate and display the public registration link and QR code.
- Copy applicant payment links for follow-up.

## Main files

- `react/YouthClassRegistrationPage.tsx`: the complete React page for settings, QR share, and entry review.

## Routing and aliases

- `crmModules.ts` maps the old alias `youth_class_registration` to `permanent_registration`.
- Inside the permanent-registration workspace, this page is selected with `registration=youth_class`.

## Key dependencies

- Reuses `FeePanel`, `normalizeFeeDrafts`, and `summarizeFee` from `frontend/src/CRM/form/react/FeePanel.tsx`.
- Uses program-specific endpoints under `/api/form/youth-class-registration/*`.

## Upgrade notes

- The QR code and public URL are part of the admin page itself, so public-entry changes should be checked here as well as in the template page.
- Because this page shares fee-editing components with other modules, be careful not to introduce youth-specific assumptions into `FeePanel.tsx`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
