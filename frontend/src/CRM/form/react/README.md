# Form React Module

## Entry points

- `FormWorkspacePage.tsx` is the mounted CRM page for the `register` module.
- `FormWorkspaceView.tsx` renders the full admin workspace once `useFormWorkspace()` has prepared data and actions.

## UI structure (workbench listing→detail)

The register page mirrors the membership/youth workbench
(`long_open_registration_form/react/RegistrationWorkbench.tsx`):

- **List view**: a sticky-header ERP table of forms (标题 · 截止日期 · 报名人数 · 关联活动 · 报名费 ·
  创建时间). Clicking a row opens the detail. Toolbar has 新建表格 (form_edit) + 刷新.
- **Detail view** (refresh-safe via `?form_id=` + `?form_tab=`): a tab bar — 报名成员 · 报名费 ·
  表格内容 · 关联活动 · 基本设置 · 公开报名页.
  - 报名成员: an ERP table of members (付款状态 chip) + search + 下载 Excel; row click opens the
    existing `showRegisterDetail` modal; 家长同意书 / 移除 actions in the row.
  - 报名费: `<FeePanel>`; 表格内容: `<ExtraFieldEditor>`; 关联活动: linked-event cards + `showEventPicker`.
  - 基本设置: **pen→save** editable 标题/截止日期/详情 (via the hook's debounced `patchSelectedForm`)
    + field-switch toggles + 删除表格.
  - 公开报名页: phone-mockup `PhoneFrame` previews of the public registration
    (`/api/form/index/{id}`) and payment (`/api/form/pay_register/{id}`) pages at the public origin
    (`utbabuddha.com`) + copy-URL buttons.

## Main pieces

- `useFormWorkspace.ts`: loads the forms list, opens detail on the URL `preferredFormId`, and owns all
  create/edit/delete actions. Selection is URL-driven — the list loads once, `openForm` reacts to
  `?form_id=`, and clearing it returns to the list.
- `FormWorkspaceView.tsx`: the workbench UI (forms table, tabbed detail, members table, pen→save
  settings, phone previews, create modal). Reuses `FeePanel`, `ExtraFieldEditor`, `showRegisterDetail`.
- `FeePanel.tsx`, `ExtraFieldEditor.tsx`, `showRegisterDetail.tsx`, `api.ts`, `types.ts`: unchanged.

## Permission behavior

- The page now has three practical states: no access, read-only form access, and full edit access.
- `form_read` can read form structure and settings but cannot mutate them.
- `member_detail` unlocks the Members section and sensitive member detail modal.
- `form_edit` unlocks all form configuration changes and member mutations.
- When the backend withholds member data, the UI shows member counts and a permission hint instead of trying to open empty detail views.

## Shared dependencies

- `FeePanel.tsx` is reused by the long-open registration workspace under `frontend/src/CRM/long_open_registration_form/react`.
- `useFormWorkspace.ts` still calls the legacy `open_parental_form` helper from `static/js/form/parental/modal.js`.
- `useFormRealtime.ts` is a reserved hook for future live-refresh support and currently keeps the integration point isolated.

## Upgrade notes

- `normalizeFieldSwitches()` in `useFormWorkspace.ts` keeps older boolean fields and the newer `field_switches` object in sync; changing this shape has wide impact.
- Finance pages read `FormRecord` and `FormPayment` directly, so type changes here ripple into `frontend/src/CRM/Account/react`.
- If you add new extra-field types, update both `ExtraFieldEditor.tsx` and any consumer that formats member field values.

## React Router Migration Track

- The admin page is React-driven, but this folder still depends on imperative helpers such as `open_parental_form()` and body-mounted modal roots like `showRegisterDetail()` and `showEventPicker()`.
- The target design is one shared React portal/modal layer plus route-aware screens for public form registration, payment, parental consent, and any large detail flows.
- Do not add new UI imports from `static/js/form/*`; existing ones should be migrated into React components, hooks, and router-driven pages over time.
