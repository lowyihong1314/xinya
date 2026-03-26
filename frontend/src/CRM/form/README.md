# Form

## Purpose

- This directory holds the CRM registration-form admin module, mounted from `frontend/src/CRM/react/crmModules.ts` as `register`.
- The active implementation is in `react/` and covers form CRUD, field configuration, fee setup, event linking, and member management.

## Current scope

- Create, open, edit, and delete registration forms.
- Configure built-in field switches such as email, parental form, address, medical, and allergy fields.
- Manage fee tables and extra fields.
- Link forms to CRM events.
- Inspect members, open detail modals, edit member data, and export members to Excel.
- Share both the registration page and payment page for a form.

## Main files

- `react/FormWorkspacePage.tsx`: route entry for the module.
- `react/FormWorkspaceView.tsx`: main admin workspace UI.
- `react/useFormWorkspace.ts`: centralized data loading and mutation logic.
- `react/FeePanel.tsx`: reusable fee editor shared with membership and youth-class modules.
- `react/ExtraFieldEditor.tsx`: editor for dynamic field definitions.
- `react/showRegisterDetail.tsx`: member detail modal and editing entry.

## Key dependencies

- `frontend/src/CRM/shared/showEventPicker`: event binding for forms.
- `static/js/form/parental/modal.js`: legacy parental-form modal still opened from the React workspace.
- `xlsx`: lazy-loaded for member export.
- `heic2any`: normalizes HEIC/HEIF uploads in the shared fee editor.

## Upgrade notes

- This module is the source of shared form and payment types used again in finance and long-term registration flows.
- Keep fee-shape compatibility in mind when changing `FeePanel`, because membership and youth-class reuse it directly.
- If field-switch behavior changes, verify both the admin form editor and the public registration pages that consume those flags.
