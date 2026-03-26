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

## React Router / Legacy Removal Audit

Audit date: `2026-03-26`

Current conclusion:
- `frontend` already has a real React Router shell in `frontend/src/app/App.tsx` and `frontend/src/router/appRouter.tsx`, but it is not yet fully route-driven.
- CRM module switching still depends on `?crm=` in `frontend/src/CRM/react/CRMPage.tsx`.
- Permanent-registration switching still depends on `?registration=` in `frontend/src/CRM/permanent_registration/react/PermanentRegistrationPage.tsx`.
- Finance tab switching still depends on `?account_router=` in `frontend/src/CRM/Account/react/FinancePage.tsx`.
- The shell still carries legacy navigation and mount bridges such as `window.__xinyaNavigate`, `render_navbar.js`, `window.app`, `reset_style()`, `LegacyMount`, `LegacyCRMPanel`, `LegacyAccountPanel`, `render_lamp_init.js`, and `render_payment_init.js`.
- React code still imports DOM-built legacy UI from `static/js/form/parental/modal.js` and `static/js/sign_tools.js`.
- Multiple helpers still create temporary roots on `document.body`, including alert, attachment preview, event picker, member detail, brochure preview, CCTV modal, select-users modal, and OTP verification helpers.
- `static/js/form/*` remains a large non-React surface for form registration, parental consent, payment, brochure, poster, and NRIC flows.
- `frontend/src/music/react/MusicPlayerController.ts` is still an imperative DOM controller mounted outside the React tree.

Target end-state:
- Every navigable screen and sub-screen should be represented by React Router paths or nested routes, not query-string routers.
- UI flows should be React components, hooks, context, and React portals instead of DOM-built overlays and `document.body.appendChild(...)` factories.
- No runtime dependency should remain on `window.app`, `reset_style()`, `Legacy*` mount helpers, `change_parms`, or `window.__xinyaNavigate`.
- No feature UI should depend on `static/js/form/*` or `static/js/sign_tools.js`.

Recommended target route model:
- `/crm/:module`
- `/crm/finance/claims`
- `/crm/finance/claims/new`
- `/crm/finance/claims/:claimId`
- `/crm/finance/register-payments`
- `/crm/finance/income`
- `/crm/finance/expense-summary`
- `/crm/permanent-registration/membership`
- `/crm/permanent-registration/youth-class`
- `/lamp-registration`
- `/lamp-registration/payment`

## React Router Upgrade Plan

### Phase 1: Shell and path model
- Replace query-driven internal routers with path-driven nested routes.
- Move CRM from `?crm=` to `/crm/:module`.
- Move finance tabs from `?account_router=` to `/crm/finance/:tab`.
- Move permanent registration from `?registration=` to `/crm/permanent-registration/:section`.
- Replace remaining `window.location.hash` writes with `useNavigate()`, `<Link />`, or router actions.

### Phase 2: Compatibility bridge removal
- Delete `LegacyQueryRedirect`, `resolveLegacyPath()` fallback logic, and `render_navbar.js` compatibility shims after all callers use router paths.
- Delete `LegacyMount`, `LegacyCRMPanel`, `LegacyAccountPanel`, `reset_style()`, and `window.app` after the last legacy mount path is gone.
- Remove `render_lamp_init.js` and `render_payment_init.js` after lamp flows are fully route-based.

### Phase 3: Modal and overlay migration
- Create one shared modal/portal layer under the app shell.
- Migrate `show_alert.tsx`, `attachment_preview.tsx`, `showEventPicker.tsx`, `showRegisterDetail.tsx`, `showCCTVModal.tsx`, `select_users_modal.tsx`, `brochurePreview.tsx`, and OTP verification helpers to that shared layer.
- Remove ad-hoc `createRoot(document.body)` patterns from feature code.

### Phase 4: Static form and signature rewrite
- Rewrite `static/js/form/init.js`, `static/js/form/register/*`, `static/js/form/payment/*`, and `static/js/form/parental/*` into React routes/components.
- Replace `open_parental_form()` with a React dialog or route-driven screen.
- Replace `static/js/sign_tools.js` with a React signature canvas component and shared preview component.

### Phase 5: Feature-specific cleanup
- Refactor `MusicPlayerController.ts` into a React portal/component that lives under the provider tree.
- Remove any remaining `window.__xinyaNavigate` usage in profile or other feature modules.
- Remove direct hash-navigation writes in album and any other route-facing pages.

### Phase 6: Done criteria
- No `window.__xinyaNavigate` in `frontend/src`.
- No `window.app` in `frontend/src`.
- No `reset_style()` in active runtime code.
- No `LegacyMount`, `LegacyCRMPanel`, or `LegacyAccountPanel` in active runtime code.
- No `useSearchParams()` used only to emulate internal tabs/modules.
- No UI imports from `static/js/form/*` or `static/js/sign_tools.js`.
- No feature-level `createRoot(document.body)` helper used as a modal factory.

## Migration Checklist

- [ ] Replace `?crm=` with nested `/crm/:module` routes.
- [ ] Replace `?registration=` with nested `/crm/permanent-registration/:section` routes.
- [ ] Replace `?account_router=` with nested `/crm/finance/:tab` routes.
- [ ] Remove `window.__xinyaNavigate`, `change_parms`, and legacy `?page=` translation.
- [ ] Remove `LegacyMount`, `LegacyCRMPanel`, `LegacyAccountPanel`, `window.app`, and `reset_style()`.
- [ ] Remove `frontend/src/lamp/render_lamp_init.js` and `frontend/src/lamp/render_payment_init.js`.
- [ ] Rewrite `static/js/form/*` into React components/routes.
- [ ] Rewrite `static/js/sign_tools.js` into React components/hooks.
- [ ] Replace body-mounted modal roots with one shared React portal layer.
- [ ] Refactor `frontend/src/music/react/MusicPlayerController.ts` into React.
- [ ] Remove direct hash-navigation writes from route-facing pages.

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
