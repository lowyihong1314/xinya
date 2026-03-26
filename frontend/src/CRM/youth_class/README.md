# Youth Class

## Purpose

- This directory contains the admin flow for the always-open youth-class registration program.
- Like membership, it is rendered inside `frontend/src/CRM/permanent_registration/react/PermanentRegistrationPage.tsx`.

## Current scope

- Review youth-class registration entries and payment status.
- Maintain public fee settings for the program.
- Generate and display the public registration link and QR code.
- Copy applicant payment links for follow-up.

## Main files

- `react/YouthClassRegistrationPage.tsx`: the complete React page for settings, QR share, and entry review.

## Routing and aliases

- `crmModules.ts` maps the old alias `youth_class_registration` to `permanent_registration`.
- Inside the permanent-registration workspace, this page is selected with `registration=youth_class`.

## Key dependencies

- Reuses `FeePanel`, `normalizeFeeDrafts`, and `summarizeFee` from `frontend/src/CRM/form/react/FeePanel.tsx`.
- Uses program-specific endpoints under `/api/form/youth-class-registration/*`.

## Upgrade notes

- The QR code and public URL are part of the admin page itself, so public-entry changes should be checked here as well as in the template page.
- Because this page shares fee-editing components with other modules, be careful not to introduce youth-specific assumptions into `FeePanel.tsx`.
