# app

App composition layer for the React shell.

## Files

- `App.tsx`: wraps the router with global providers.
- `UserState.tsx`: current-user state, login modal, mobile detection, and auth bridge helpers.

## Provider order

`App.tsx` renders providers in this order:

1. `UserStateProvider`
2. `EventDataProvider`
3. `MusicPlaybackProvider`
4. `RouterProvider`

This means both event data and music playback are available to every routed page.

## User state responsibilities

`UserStateProvider` owns:

- fetching the current user from `/api/user_control/get_user_data`
- login via `/api/user_control/login`
- logout via `/api/user_control/logout`
- `loginOpen` modal state
- `isMobile` tracking based on window width
- refreshing auth state on initial mount and on window focus

## Global browser bridges

`UserState.tsx` also registers compatibility hooks on `window`:

- `__xinyaFetchUserAuth`
- `__xinyaOpenLogin`

These are still used by compatibility code outside the React tree.

## Upgrade notes

- The login modal is rendered inside the provider, not by the router.
- Pages should use `useUserState()` instead of refetching auth independently.
- If the auth response shape changes, update both the context types here and any feature modules that cast `user` to local domain types.
