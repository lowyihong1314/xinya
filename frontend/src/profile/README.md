# profile

Current-user profile, footprint, and membership self-service feature.

## Route

- `/profile`

## Structure

- `react/`: main React implementation, API helpers, and local types

## Scope

This feature lets an authenticated user:

- view high-level account and activity summary
- update profile fields
- upload a profile image
- review registration and youth-class footprints
- start or renew membership actions
- log out from the current session

## Shared dependencies

- `useUserState()` for auth and current user data
- `designTokens` for page styling
- backend user-control APIs for profile, images, footprints, and membership renewal

## Upgrade notes

- The route is visible through the main router, but the page itself still contains its own guest-state gate.
- Domain-specific profile types in `react/types.ts` are effectively a frontend contract for the user-control API responses.
