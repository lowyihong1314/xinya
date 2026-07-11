# Long Open Registration Form React Module

## Entry points

- `LongOpenRegistrationFormPage.tsx` is the CRM workspace shell for long-open forms.
- `RegistrationWorkbench.tsx` is the **shared, config-driven** workbench (tabs, ERP table, detail
  page, two-gate approval, editable fields, phone previews). Both flows render this component.
- `workbenchConfig.ts` holds the shared types, the `makeEndpoints(base)` factory, and the
  `WorkbenchConfig` interface (endpoints, list columns, detail fields, socket, permissions).
- `MembershipRegistrationPage.tsx` / `YouthClassRegistrationPage.tsx` are **thin wrappers** that
  pass their scope config to `RegistrationWorkbench`.
- `FeeOptionEditor.tsx` is a reusable fee editor helper stored with the same workspace.

## Current behavior

- Membership and youth-class share one workbench UI + logic; only the config differs (endpoints,
  descriptive fields, labels, youth realtime socket, youth read/edit permission gating).
- Council threshold is NOT hardcoded in the frontend — it comes from `entry.council`
  (membership requires 5, youth requires 1).
- Switches between the two workflows via `?registration_section=` in the shell.

## Notes

- Membership uses `/api/user_control/membership/*`; youth uses `/api/form/youth-class-registration/*`.
  Both share the same URL shape (`/entries`, `/settings`, `/payment/<id>/status`,
  `/<id>/council-sign`, `PUT /<id>`), so `makeEndpoints(base)` builds both.
- Both flows have two independent approval gates, both required before a registration becomes
  生效 (activated):
  - 财政审核 (finance): passes once any payment record is `checked`.
  - 理事会审核 (council): collect signatures from users holding `council_approve`
    (membership ≥5, youth ≥1). Signatures are **irreversible** and each stores a snapshot of the
    signer's `user_data` + JSON strokes in `signature.data`.
  - Signing: 复制签名 URL copies a **permanent** login-gated link
    (`/template/council-sign?t=…`, token embeds `{scope, registration_id}`). The signer logs in
    (Flask session), and if they hold `council_approve` they hand-sign via `sign_tools.js`.
    Shared endpoints: `GET/POST /api/user_control/council-sign/mobile`.
  - Editing: while not activated (`status != paid`), editors inline-edit whitelisted fields via
    `PUT /<id>` (pen → input → save icon).
- The scope-agnostic council flow lives in `app/common/council_sign.py` (per-scope registry);
  membership and youth register their scope + activation callback there.
- The workbench opens a per-entry detail page via `?entry_id=` (refresh-safe); finance/council
  status show in both the list table and the detail page.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
