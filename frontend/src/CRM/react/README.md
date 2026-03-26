# CRM React Shell

This directory contains the React shell for the CRM page.

## Goal

Move CRM routing and module switching into React first, while keeping existing CRM business panels alive during the migration.

## Structure

- `CRMPage.tsx`: top-level CRM page, tab state, URL sync, access gate.
- `LegacyCRMPanel.tsx`: mounts one legacy CRM module into a React-managed container.
- `crmModules.ts`: shared CRM module registry and key helpers.

## Current registry status

The current `CRM_MODULES` registry is already React-first:

- user control
- event table
- dharma event
- finance
- register
- permanent registration
- CCTV
- songbook
- embedded file system

`LegacyCRMPanel.tsx` is still useful as a migration utility, but the active module list is no longer relying on legacy renderers today.

## URL state

- Active module is stored in `?crm=<module_key>`.
- The legacy `?CRM=` query is normalized to `?crm=` automatically.
- Alias sections such as `membership_registration` and `youth_class_registration` are normalized to `permanent_registration` plus a `registration` section query.

## Migration rule

- New CRM modules should be implemented as React pages when practical.
- Existing modules can stay in the registry as legacy renderers until they are rewritten.
- All new colors must come from `frontend/src/theme/designTokens.ts`. If a needed tone does not exist, add a token there first instead of hardcoding colors inside CRM components.

## React Router Migration Track

- `CRMPage.tsx` is still acting as both layout and a query-string router. The end-state should turn it into a CRM layout route with `<Outlet />` and path-based children instead of `useSearchParams()`-driven panel switching.
- `crmModules.ts` should gradually evolve from a panel registry into route metadata used by nested router definitions and CRM nav rendering.
- `LegacyCRMPanel.tsx` should be treated as removal debt. Do not route new work through it.
