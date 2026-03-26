# user_control

CRM user, department, permission, and membership-renewal management module.

## Scope

This module is the main admin surface for organization people data. It manages both account-level data and department/permission structure.

## Structure

- `react/`: page, view, controller, APIs, and types

## Responsibilities

- browse departments and department members
- search all users
- create and delete users
- edit profile-like user fields from CRM
- reset user passwords
- create and delete membership renewal records
- manage department permissions
- attach and detach users from departments

## Shared impact

- Public `/info` imports `UserCard` from this module.
- User data contracts here are closely related to the profile page under `frontend/src/profile/react`.

## Upgrade notes

- Changes to user shapes here can ripple into profile, info, and auth-dependent experiences outside CRM.
