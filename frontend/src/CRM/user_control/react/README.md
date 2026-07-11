# CRM User Control React Module

React migration target for the CRM user control workspace.

## Files

- `UserControlPage.tsx`: URL-driven dispatcher. Reads `?user_control_view=members|departments`
  (sidebar sub-nav) and renders the matching view. Also drives refresh-safe selection via
  `?user_id=` (open user editor) and `?dept_id=` (open a department detail), and hosts the shared
  toast, `NewUserModal`, and `PermissionModal`.
- `MembersView.tsx`: 用户管理 — a 名片 (business-card) grid of all users (`view/UserCard`) with search
  and `shared/TablePagination` (15/page); clicking a card opens the full user editor (`view/UserEditorPage`).
- `DepartmentsView.tsx`: 部门管理 — a department-card list → detail (改名 / 权限 / 删除 / 加入成员 /
  移出). 加入成员 reuses the shared `CRM/select_users_modal` picker.
- `view/`: split presentational pieces — the user editor, modals, `UserCard`, shared fields, and styles.
- `useUserControlController.ts`: data loading, mutation orchestration, and local workspace state.
- `api.ts`: department, user, permission, and renewal requests.
- `types.ts`: department, permission, user, and member-renewal types.

## Scope

- Two sidebar-switchable views: 用户管理 (member cards) and 部门管理 (department list → detail)
- Refresh-safe selection via query params (`user_control_view` / `user_id` / `dept_id`)
- Global member search + card-grid pagination
- Create / edit / delete user, reset password, membership renewal record CRUD
- Create / rename / delete department, department permission editing
- Add / remove department members (add uses the shared select-users picker)

## State rule

- Keep data loading and mutations in `useUserControlController.ts`.
- View composition lives in `MembersView.tsx` / `DepartmentsView.tsx`; reusable presentation pieces
  live under `view/`. Selection state is URL-driven in `UserControlPage.tsx`.
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
