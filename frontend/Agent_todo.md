# Frontend README Completion Checklist

This file is the handoff checklist for the next Agent working on frontend upgrades.

Mission:
- Read the real code before updating each `README.md`.
- Replace placeholder content with accurate documentation based on the current implementation.
- Make the README useful for the next Agent who needs to upgrade, refactor, or debug this area.

For every checklist item below:
1. Read the code in the same directory first.
2. Read related shared code, imports, routes, types, hooks, API calls, and parent modules when needed.
3. Update the target `README.md` with real content, not guesses.
4. After the README is actually complete, change `[ ]` to `[x]`.

Each completed README should explain:
- What this directory is for.
- Main files, entry points, routes, and exported modules.
- Key dependencies on shared components, APIs, stores, or utilities.
- Important business rules, data flow, and state flow.
- Upgrade risks, fragile areas, and things the next Agent should verify.

Important:
- Do not check the box until the README has been updated and reviewed against the code.
- If a README already has content, still verify it against the code before marking it done.
- The goal is to prevent duplicate work and make future upgrade tasks faster and safer.

## Checklist

### Root
- [x] `frontend/README.md`
- [x] `frontend/src/README.md`

### CRM
- [x] `frontend/src/CRM/README.md`
- [x] `frontend/src/CRM/Account/README.md`
- [x] `frontend/src/CRM/Account/react/README.md`
- [x] `frontend/src/CRM/Account/react/claim/README.md`
- [x] `frontend/src/CRM/Account/react/income/README.md`
- [x] `frontend/src/CRM/Account/react/register/README.md`
- [x] `frontend/src/CRM/Account/react/summarize_expense/README.md`
- [x] `frontend/src/CRM/CCTV/README.md`
- [x] `frontend/src/CRM/changyou/README.md`
- [x] `frontend/src/CRM/changyou/react/README.md`
- [x] `frontend/src/CRM/event/README.md`
- [x] `frontend/src/CRM/event/react/README.md`
- [x] `frontend/src/CRM/fahui/README.md`
- [x] `frontend/src/CRM/file_system/README.md`
- [x] `frontend/src/CRM/file_system/react/README.md`
- [x] `frontend/src/CRM/form/README.md`
- [x] `frontend/src/CRM/form/react/README.md`
- [x] `frontend/src/CRM/membership/README.md`
- [x] `frontend/src/CRM/membership/react/README.md`
- [x] `frontend/src/CRM/permanent_registration/README.md`
- [x] `frontend/src/CRM/permanent_registration/react/README.md`
- [x] `frontend/src/CRM/react/README.md`
- [x] `frontend/src/CRM/shared/README.md`
- [x] `frontend/src/CRM/user_control/README.md`
- [x] `frontend/src/CRM/user_control/react/README.md`
- [x] `frontend/src/CRM/youth_class/README.md`
- [x] `frontend/src/CRM/youth_class/react/README.md`

### Feature Modules
- [x] `frontend/src/album/README.md`
- [x] `frontend/src/album/react/README.md`
- [x] `frontend/src/app/README.md`
- [x] `frontend/src/changyou/README.md`
- [x] `frontend/src/changyou/react/README.md`
- [x] `frontend/src/changyou/react/room/README.md`
- [x] `frontend/src/components/README.md`
- [x] `frontend/src/event/README.md`
- [x] `frontend/src/event/shared/README.md`
- [x] `frontend/src/info/README.md`
- [x] `frontend/src/info/react/README.md`
- [x] `frontend/src/js/README.md`
- [x] `frontend/src/lamp/README.md`
- [x] `frontend/src/lamp/react/README.md`
- [x] `frontend/src/music/README.md`
- [x] `frontend/src/music/react/README.md`
- [x] `frontend/src/profile/README.md`
- [x] `frontend/src/profile/react/README.md`
- [x] `frontend/src/router/README.md`
- [x] `frontend/src/theme/README.md`
- [x] `frontend/src/types/README.md`
