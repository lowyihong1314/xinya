# Register Payment Review

## Purpose

- This directory contains the finance-side review workspace for registration payments.
- It lets finance users inspect payment proofs, change payment status, replace proof images, and remove failed records.

## Main files

- `RegisterWorkspace.tsx`: loads all forms with payments, groups them by form, and provides status-filtered review.
- `PaymentDetailPanel.tsx`: focused detail panel for a selected payment, including proof replacement and record removal actions.
- `api.ts`: helpers for fetching forms and mutating payment records.
- `types.ts`: local payment status helpers and aliases.

## API usage

- `/api/form/get_all_form`: source of forms and embedded payment arrays.
- `/api/form/payment/update_status/:paymentId`: updates payment status.
- `/api/form/payment/proof_image/:paymentId/replace`: replaces proof image for a payment.
- `/api/form/payment/:paymentId`: deletes a payment record.

## Business rules in code

- The default filter is `process`, so the workspace opens on pending reviews first.
- Forms without payment records are filtered out before rendering.
- Proof replacement is intended for records still being processed.
- Record deletion is reserved for failed payments in the detail panel workflow.

## Upgrade notes

- This module assumes payment data is nested under each form returned by `/api/form/get_all_form`; if the backend normalizes payments into a separate endpoint, the workspace structure will need to change.
- `RegisterPaymentForm` is an alias of the shared `FormRecord` type, so schema changes here also affect the form admin workspace and income analytics.
- Keep status labels aligned with backend values `process`, `checked`, and `fail`.
