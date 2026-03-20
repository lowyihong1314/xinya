# CCTV Module

Shared CCTV functionality lives here.

## Files

- `CCTVPage.tsx`: CRM CCTV workspace page.
- `showCCTVModal.tsx`: shared React-hosted CCTV player modal launcher.

## Usage

- CRM should use `CCTVPage` directly from React routing/modules.
- Other pages should import `showCCTVModal()` from this directory instead of keeping private copies.
