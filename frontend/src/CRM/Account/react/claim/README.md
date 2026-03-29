# Claim Workspace

## Purpose

- This directory contains the full React claim workflow for the CRM finance module.
- It covers internal claim management and the separate public payment-voucher signing page.

## Main files

- `ClaimWorkspace.tsx`: main state machine for list, create, and detail views.
- `ClaimCreateForm.tsx`: applicant info, amount, department, accounting allocation text, linked event, attachments, and signature capture.
- `ClaimList.tsx`: searchable and paginated claim list with approver badges and attachment/event summaries.
- `ClaimDetail.tsx`: approval history, attachments, claim metadata, approve/reject actions, and payment-voucher entry.
- `PaymentVoucherModal.tsx`: share link, copy/open actions, and voucher download entry for finance users.
- `PaymentVoucherSignPage.tsx`: public signing page mounted at `/payment-voucher-sign/:token`.
- `api.ts`: `/api/account/*` client helpers.
- `types.ts`: claim, approver, attachment, and voucher payload types.
- `claimStyles.ts`: shared styles used across the claim workspace.

## Data flow

- `ClaimWorkspace.tsx` loads claims with `fetchClaims()` and keeps local list/create/detail state in React.
- New claims are submitted as `FormData` through `submitClaim()`, including attachments and serialized signature data.
- Claim approval goes through `decideClaim()` and can require signature/comment data.
- Claim deletion goes through `deleteClaim()` and is limited to edit-capable finance users.
- Voucher sharing uses `/api/account/print_payment_voucher/share_payment_voucher/:requestId`.
- Public voucher signing uses `/api/account/print_payment_voucher/public/:token` and `/sign`.

## Business rules in code

- Creating a claim requires applicant name, request date, amount, department, purpose, and a handwritten signature.
- Claims can optionally link a CRM event through `showEventPicker`.
- Claim actions are split by department permissions: `account_submit` can create, `account_read` can view all claims, and `account_edit` can approve/reject/delete.
- Payment voucher actions are only exposed when the current user is eligible through approval state or finance permission.

## Upgrade notes

- `ClaimWorkspace.tsx` uses its own view-state machine instead of route segments, so adding a new subflow usually means touching the central component.
- The public voucher page is part of the app router, not the CRM page, so regression checks must include direct-link access.
- If backend status names or approver payloads change, verify `ClaimList.tsx` and `ClaimDetail.tsx` together because both render status-dependent UI.

## React Router Migration Track

- This flow should move from local view-state switching to real child routes under finance, especially for list, create, and detail states.
- The signature workflow still depends on `static/js/sign_tools.js`; the target design is a React signature component plus React portal/modal presentation.
- Payment-voucher signing can stay as a dedicated route, but it should share the same React signature primitives instead of importing DOM-built modal utilities.
