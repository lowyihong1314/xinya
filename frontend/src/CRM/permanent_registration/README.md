# permanent_registration

CRM workspace for long-lived registration programs.

## Scope

This module groups registration flows that stay open continuously rather than being tied to a single event.

Current sections:

- membership upgrade / renewal
- youth and youth-class registration

## Structure

- `react/`: section switcher and shared fee-option editor

## Routing behavior

- CRM module key: `permanent_registration`
- section is selected through the `registration` query parameter
- legacy aliases such as `membership_registration` and `youth_class_registration` normalize into this module

## Upgrade notes

- This folder is mostly a shell over `membership/react` and `youth_class/react`, so changes in those downstream modules affect this workspace immediately.
