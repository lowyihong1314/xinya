# Profile React Module

This directory holds the React rewrite of the profile page.

## Files

- `ProfilePage.tsx`: page component, form rendering, avatar upload, CCTV action, and logout action.
- `api.ts`: profile update and avatar upload requests.
- `types.ts`: local profile user and form types.

## State model

- Authentication and current user data come from `useUserState()`.
- The page does not fetch login state independently.
- After profile save or avatar upload, the page calls `refreshUser()` so any subscriber updates immediately.

## Routing

- The `/profile` route should render `ProfilePage` directly from the React router.
