# info

Organization introduction and history feature.

## Route

- `/info`

## Scope

This feature renders the public-facing "about us" experience and also supports authenticated inline editing for organization content.

## Structure

- `react/`: page implementation, API helpers, and local types

## Key dependencies

- `PageHero` from `src/components`
- `useUserState()` for auth-aware editing
- CRM user-control data for the member card section
- shared design tokens from `src/theme`

## Data shown on the page

- paged member cards
- about-us text entries
- organization history timeline entries

## Upgrade notes

- This module mixes public browsing and authenticated editing in the same page component.
- Member data is not owned locally; it is fetched from CRM user-control APIs, so changes in CRM user shapes can affect `/info`.
