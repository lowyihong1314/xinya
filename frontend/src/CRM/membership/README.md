# Membership

## Purpose

- This directory contains the long-running membership registration admin flow.
- It is rendered inside `frontend/src/CRM/permanent_registration/react/PermanentRegistrationPage.tsx` rather than appearing as a separate top-level CRM module.

## Current scope

- Review membership upgrade and renewal entries.
- Maintain membership fee settings.
- Copy applicant payment links and review the latest payment state.
- Update membership payment status from the admin side.

## Main files

- `react/MembershipRegistrationPage.tsx`: the complete React page for membership settings and entry review.

## Routing and aliases

- `crmModules.ts` maps the old alias `membership_registration` to `permanent_registration`.
- Inside the permanent-registration workspace, this page is selected with `registration=membership`.

## Key dependencies

- Reuses `FeePanel`, `normalizeFeeDrafts`, and `summarizeFee` from `frontend/src/CRM/form/react/FeePanel.tsx`.
- Uses membership-specific endpoints under `/api/user_control/membership/*`, not the generic `/api/form/*` register APIs.

## Upgrade notes

- The settings payload accepts both `fees` and `fee_options`, so normalization compatibility matters when backend fields shift.
- Because this page lives under the permanent-registration shell, changes should be tested both from direct alias links and from the section switcher.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
