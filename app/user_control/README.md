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

## Important Note

The old `function/user_control.py` currently contains extra local worktree changes and previously had login-version enforcement logic. That global session version guard is not yet reintroduced in `app/user_control`.
