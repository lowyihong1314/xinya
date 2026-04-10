# CRM

CRM workspace area for admin-only features.

## Route

- `/crm`

## Shell architecture

- `react/CRMPage.tsx` is the CRM route entry.
- Module selection is driven by the `crm` query parameter.
- `react/crmModules.ts` is the registry that maps module keys to React panels.
- `react/LegacyCRMPanel.tsx` remains available for hybrid migration cases, even though the current registry is already React-first.

## Current module registry

- `user_control`
- `event_table`
- `dharma_event`
- `finance`
- `register`
- `permanent_registration`
- `cctv`
- `songbook`
- `files`

## Directory map

- `react`: CRM shell, module registry, and legacy bridge mount
- `Account`: finance and payment-related CRM flows
- `CCTV`: monitoring modal and CRM CCTV page
- `event`: event table management
- `fahui`: dharma-event workspace with lamp-payment review and YLP order lookup
- `file_system`: embedded file manager
- `form`: registration-form workspace
- `permanent_registration`: long-lived registration dashboards
- `user_control`: user, department, and permission management
- `changyou`: songbook admin tools
- `shared`: reusable CRM pickers and helpers

## Conventions

- CRM access is gated by `useUserState()` and the shared login modal.
- Module switching should happen through the registry instead of ad-hoc routing logic.
- Query aliases such as `membership_registration` and `youth_class_registration` normalize to `permanent_registration`.

## Upgrade notes

- CRM URLs now store the active module in `?crm=<module_key>`, while old `?CRM=` links are normalized automatically.
- Some domain folders still carry compatibility structure from the migration, so check both a folder README and the module registry before moving files around.

## React Router Migration Track

- CRM is React-rendered, but it is not yet fully path-routed because module switching still lives in `?crm=` instead of nested routes.
- Recommended target route tree is `/crm/:module`, with deeper children such as `/crm/finance/:tab` and `/crm/permanent-registration/:section`.
- Once all modules are reachable by path, the alias/query normalization layer can be removed and `LegacyCRMPanel` should disappear completely.
