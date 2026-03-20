# Permission Management Module

Manages department-level permission assignments.

## Files

- `routes.py`: permission listing and department assignment endpoints.

## Main Routes

- `GET /api/permission/get_all_permission`
- `POST /api/permission/add_permission_to_department`
- `POST /api/permission/remove_permission_from_department`

## Notes

- This is a small module. If rules become more complex, move DB mutation logic into `services.py`.
