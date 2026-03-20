# CRM User Control React Module

React migration target for the CRM user control workspace.

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

## State rule

- Keep data loading and mutations in `useUserControlController.ts`.
- UI components should stay in `UserControlView.tsx`.
- New colors must come from `frontend/src/theme/designTokens.ts`.
