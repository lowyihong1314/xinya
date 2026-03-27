# CRM React Shell

This directory contains the React shell for the CRM page.

## Goal

Move CRM routing and module switching into React Router, while keeping CRM business panels path-based and React-first.

## Structure

- `CRMPage.tsx`: CRM layout shell, module nav, access gate, and `<Outlet />`.
- `CRMHomePage.tsx`: compact mobile-first CRM landing page.
- `crmModules.ts`: shared CRM module registry plus path helpers.
- `routes.tsx`: nested CRM route definitions and legacy query redirects.

## Current registry status

The current `CRM_MODULES` registry is fully React:

- user control
- event table
- dharma event
- finance
- register
- permanent registration
- CCTV
- songbook
- embedded file system

## URL state

- Active module is stored on path routes such as `/crm/user_control` and `/crm/finance`.
- Mobile UI exposes an extra `/crm/home` entry as a cleaner CRM landing page.
- Legacy `?crm=` and `?CRM=` links are redirected automatically into the matching CRM child route.
- Alias sections such as `membership_registration` and `youth_class_registration` are normalized to `/crm/permanent_registration` plus a `registration` section query.

## Migration rule

- New CRM modules should be implemented as React pages when practical.
- All new colors must come from `frontend/src/theme/designTokens.ts`. If a needed tone does not exist, add a token there first instead of hardcoding colors inside CRM components.

## React Router Migration Track

- CRM module switching now runs on nested React Router child routes.
- A remaining broader migration target is converting finance and permanent-registration sub-sections from query-param tabs into deeper nested paths.
