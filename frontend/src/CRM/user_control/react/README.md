# CRM User Control React Module

React migration target for the CRM user control workspace.

## Files

- `UserControlPage.tsx`: page entry that binds controller state to the view.
- `UserControlView.tsx`: presentational workspace, user editor, permission modal, and reusable `UserCard`.
- `useUserControlController.ts`: data loading, mutation orchestration, and local workspace state.
- `api.ts`: department, user, permission, and renewal requests.
- `types.ts`: department, permission, user, and member-renewal types.

## Scope

- Department list and selection
- Department members
- Global member search
- Create department
- Create user
- User detail editing
- Reset password
- Delete user
- Department permission editing
- Membership renewal record CRUD

## State rule

- Keep data loading and mutations in `useUserControlController.ts`.
- UI components should stay in `UserControlView.tsx`.
- New colors must come from `frontend/src/theme/designTokens.ts`.

## Backend endpoints

- `/api/user_control/departments`
- `/api/user_control/departments/:departmentId/users`
- `/api/user_control/get_all_user_data`
- `/api/user_control/get_user_detail/:userId`
- `/api/user_control/register`
- `/api/user_control/edit_user_data`
- `/api/user_control/delete_user/:userId`
- `/api/user_control/reset_password/:userId`
- `/api/user_control/member_renewal/:userId`
- `/api/user_control/member_renewal/:renewalId`
- `/api/permission/get_all_permission`
- `/api/permission/add_permission_to_department`
- `/api/permission/remove_permission_from_department`

## Important cross-module note

`UserCard` is reused outside CRM by the public `info` page. Visual or prop changes here can therefore affect both admin and public experiences.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
