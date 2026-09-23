# User Control Module

Handles authentication, current-user profile actions, user CRUD, department membership, and profile images.

## Files

- `routes.py`: auth/user/department HTTP endpoints.
- `membership.py`: self-service member upgrade / renewal / payment flow.
- `utils.py`: profile image helpers and DNS/local-IP utilities.

## Main Routes

- `POST /api/user_control/login`
- `GET /api/user_control/logout`
- `GET /api/user_control/get_user_data`
- `GET /api/user_control/get_all_user_data`
- `GET /api/user_control/get_user_detail/<user_id>`
- `POST /api/user_control/edit_user_data`
- `POST /api/user_control/register`
- `POST /api/user_control/change_password`
- `GET /api/user_control/membership/context`
- `GET /api/user_control/membership/entries`
- `POST /api/user_control/membership/upgrade`
- `POST /api/user_control/membership/renew`
- `GET /api/user_control/membership/payment/<token>`
- `POST /api/user_control/membership/payment/<token>/submit`
- `POST /api/user_control/membership/payment/<payment_id>/status`
- `GET /api/user_control/membership/payment/proof_image/<payment_id>`
- `GET|PUT /api/user_control/membership/settings`
- `GET /api/user_control/reset_password/<user_id>`
- `GET|POST /api/user_control/departments`
- `DELETE /api/user_control/departments/<dept_id>`
- `POST /api/user_control/departments/<dept_id>/add_user`
- `POST /api/user_control/departments/<dept_id>/remove_user`
- `DELETE /api/user_control/delete_user/<user_id>`
- `POST /api/user_control/upload_profile_image`
- `GET /api/user_control/get_profile_image/<username>`
- `POST /api/user_control/update_user/<user_id>`

## Permission Model

- Public:
  - `POST /login`
  - `GET /get_profile_image/<username>`
  - `GET /get_all_user_data` only returns `display=true` users with basic fields when not logged in
- Login only:
  - current-user profile/session routes such as `get_user_data`, `my_footprints`, `change_password`, `upload_profile_image`
  - self-service membership routes such as `membership/context`, `membership/upgrade`, `membership/renew`, `membership/payment/<token>`, `membership/payment/<token>/submit`
- `member` / `member_edit`:
  - full user-data reads (`get_all_user_data` full mode, `get_user_detail` full mode)
- `member_edit`:
  - user write operations such as `edit_user_data`, `register`, `reset_password`, `delete_user`
- `department` / `department_edit` / `permission` / `permission_edit`:
  - full department metadata reads; `departments/<dept_id>/users` requires one of these read-capable permissions
- `department_edit`:
  - department create / rename / delete and add/remove user operations
- `member` / `member_edit` / `account_edit`:
  - membership-admin read routes such as `membership/settings` (GET), `membership/entries`, `member_renewal/<user_id>`
- `member_edit` / `account_edit`:
  - membership-admin write routes such as `membership/settings` (PUT), `membership/payment/<payment_id>/status`, `member_renewal/*`

## Response Scopes

- `get_all_user_data` now has three scopes:
  - public callers get only visible users with basic fields
  - logged-in callers without member-read permissions get all users but only basic fields
  - callers with `member` or `member_edit` get full user payloads
- `get_user_detail` returns:
  - full payload for the user themself
  - full payload for callers with `member` or `member_edit`
  - basic payload for other logged-in callers
- `departments` returns:
  - full department objects for department/member/permission readers
  - basic `{id, name}` objects for other logged-in callers

## Important Note

The old `function/user_control.py` currently contains extra local worktree changes and previously had login-version enforcement logic. That global session version guard is not yet reintroduced in `app/user_control`.
