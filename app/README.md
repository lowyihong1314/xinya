# App Architecture

`app/` is the new Flask application package.

## Purpose

- Own the application factory and shared infrastructure.
- Hold domain modules that replace the old `function/*` implementation.
- Keep HTTP routing, business logic, serialization, and helpers separated.

## Core Files

- `factory.py`: Flask app factory.
- `blueprints.py`: central blueprint registration.
- `extensions.py`: shared Flask extension instances.
- `auth.py`: login manager hooks and permission helpers.
- `paths.py`: project/data/static path definitions.
- `settings.py`: default Flask configuration.
- `web.py`: non-API web routes such as `/` and `/favicon.ico`.

## Domain Modules

- `account/`: reimbursement and payment voucher flow.
- `public_api/`: general lightweight API endpoints.
- `permission_mgmt/`: department-permission management.
- `content/`: info/about/history content APIs.
- `event/`: event listing, editing, and event flow APIs.
- `form/`: registration forms, members, fee config, and PDF export.
- `music/`: music upload, album management, and audio download.
- `payment/`: payment gateway API entrypoints.
- `lamp_registration/`: lamp registration and payment approval APIs.
- `twilio/`: OTP send/verify and rate limiting.
- `user_control/`: auth, user profile, departments.
- `media/`: event media upload, preview, conversion.
- `filesystem/`: file manager APIs.

## Migration Status

These modules are already implemented under `app/`:

- `account`
- `public_api`
- `permission_mgmt`
- `content`
- `event`
- `form`
- `user_control`
- `media`
- `filesystem`

## Rule Of Thumb

- Add new backend modules under `app/`, not `function/`.
- Keep route handlers thin.
- Put business logic in `services.py`.
- Put formatting/output transforms in `serializers.py`.
- Put reusable policy checks in `permissions.py` or `auth.py`.
