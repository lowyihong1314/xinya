# Long Open Registration Form

## Purpose

- This directory owns the CRM workspace for registration programs that stay open long term.
- The unified CRM route is `#/long_open_registration_form`.

## Current scope

- Membership upgrade and renewal review.
- Youth / youth-class registration review and payment follow-up.
- Shared shell UI that keeps both workflows in one workspace.

## Structure

- `react/LongOpenRegistrationFormPage.tsx`: workspace shell and section switcher.
- `react/MembershipRegistrationPage.tsx`: membership admin workflow.
- `react/YouthClassRegistrationPage.tsx`: youth-class admin workflow.
- `react/FeeOptionEditor.tsx`: shared fee editor helper kept here for related pricing flows.

## Routing notes

- CRM module key remains `permanent_registration` for compatibility.
- Legacy aliases such as `membership_registration` and `youth_class_registration` redirect into `#/long_open_registration_form`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
