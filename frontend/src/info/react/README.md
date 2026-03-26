# Info React

React version of the `info` page.

## Files

- `InfoPage.tsx`: page component and editor modal.
- `api.ts`: data loading and mutation helpers.
- `types.ts`: shared types.

## What the page does

- renders a rotating hero with `PageHero`
- loads about entries, history entries, and member cards in parallel
- prioritizes members from department id `8` before locale sorting names
- paginates the member card section four items at a time
- opens a shared editor modal for both About and History content

## Backend endpoints

- `/api/info/get_about_us_text`
- `/api/info/get_our_history`
- `/api/info/about_us_text`
- `/api/info/add_our_history`
- CRM member list via `fetchAllUsers()` from `CRM/user_control/react/api`

## Auth behavior

- Guest users can browse all content.
- Authenticated users get Add, Edit, and Delete actions for About and History sections.
- Auth state comes from `useUserState()`, not from a page-local login fetch.

## Notes

- `History` entries support image upload, replacement, and removal.
- `UserCard` is imported from the CRM user-control React module, so visual or data-shape changes there affect this page.
- This page is a good example of a public route that still depends on private CRM code for a subset of its UI.
