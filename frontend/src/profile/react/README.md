# Profile React Module

This directory holds the React rewrite of the profile page.

## Files

- `ProfilePage.tsx`: page component, section navigation, form rendering, avatar upload, footprints, membership actions, app download, and logout.
- `MembershipActionCard.tsx`: membership upgrade / renewal CTA card.
- `api.ts`: profile update, avatar upload, footprint fetch, membership renewal, and app release listing.
- `types.ts`: local profile user, footprint, payment, form, and app release types.

## State model

- Authentication and current user data come from `useUserState()`.
- The page does not fetch login state independently.
- After profile save or avatar upload, the page calls `refreshUser()` so any subscriber updates immediately.

## Screen structure

`ProfilePage.tsx` is organized around five sections:

- `overview` — identity summary, latest footprint, profile completeness checklist
- `profile` — editable form for identity, contact, and health fields
- `journey` — footprint timeline (registration forms + youth class entries)
- `account` — session info, membership actions, app download, logout
- `bank-note` — personal transfer info (`bank_account`, `tng_number`) and reference notes

## Backend endpoints

- `GET /api/user_control/get_user_data`
- `POST /api/user_control/update_user/:userId`
- `POST /api/user_control/upload_profile_image`
- `GET /api/user_control/my_footprints`
- `POST /api/user_control/membership/renew`
- `GET /api/app/releases` — list all APK files in `frontend/apk/`
- `GET /api/app/download/<filename>` — download a specific APK

## App download

The `AppDownloadCard` component in the `account` section fetches `/api/app/releases` on first render of that section. It lists every `.apk` file found in `frontend/apk/`, newest first, with filename, size, and a direct download link. No login is required to download.

See `frontend/Update_apk.md` for the full APK build and release workflow.

## Footprint model

The footprint view combines two backend domains into one timeline-style summary:

- registration forms and their linked event / payment records
- youth class registrations and their payment state

## Membership behavior

- If the user is already a member, the action card starts a renewal flow.
- If the user is not a member, the card guides them into an upgrade flow.
- Missing NRIC data blocks part of the upgrade path, so profile completeness directly affects the membership UX.

## Routing

- `/profile` redirects to `/profile/overview`.
- `/profile/:section` renders `ProfilePage`, and section switching is driven by React Router.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
