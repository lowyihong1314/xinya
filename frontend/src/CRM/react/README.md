# CRM React Shell

This directory contains the React shell for the CRM page.

## Goal

Move CRM routing and module switching into React first, while keeping existing CRM business panels alive during the migration.

## Structure

- `CRMPage.tsx`: top-level CRM page, tab state, URL sync, access gate.
- `LegacyCRMPanel.tsx`: mounts one legacy CRM module into a React-managed container.
- `crmModules.ts`: shared CRM module registry and key helpers.

## URL state

- Active module is stored in `?crm=<module_key>`.
- The legacy `?CRM=` query is normalized to `?crm=` automatically.

## Migration rule

- New CRM modules should be implemented as React pages when practical.
- Existing modules can stay in the registry as legacy renderers until they are rewritten.
- All new colors must come from `frontend/src/theme/designTokens.ts`. If a needed tone does not exist, add a token there first instead of hardcoding colors inside CRM components.
