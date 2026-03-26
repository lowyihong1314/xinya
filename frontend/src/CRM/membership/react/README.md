# Membership React Module

## Entry point

- `MembershipRegistrationPage.tsx` is the only page in this directory and is embedded by the permanent-registration workspace.

## Current behavior

- Loads membership entries and fee settings in parallel on page load.
- Uses `FeePanel` to edit age-banded or category-based membership fees.
- Shows summary stats for upgrades, renewals, approved entries, and processing entries.
- Lets admins copy the applicant payment URL when one exists.
- Lets admins update payment status through `/api/user_control/membership/payment/:paymentId/status`.

## Public link and APIs

- The public application URL exposed by the page is `${window.location.origin}/template/membership-application`.
- Entry list comes from `/api/user_control/membership/entries`.
- Fee settings are loaded and saved through `/api/user_control/membership/settings`.

## Shared patterns

- Fee data is normalized through `normalizeFeeDrafts()` so the page can consume either `fees` or `fee_options`.
- The component uses the same fee summary helpers as the generic CRM form workspace, which keeps fee editing behavior consistent.

## Upgrade notes

- This module is under `user_control` APIs rather than `form` APIs, so do not blindly copy youth-class changes here without checking endpoint differences.
- The page refreshes all data after payment updates; if the dataset grows large, this reload strategy may become the first place to optimize.
