# Frontend Utility Layer

Shared browser-side utility helpers used by both legacy DOM modules and React modules.

## Rules

- Prefer TypeScript for all utilities in this directory.
- Keep cross-module helpers here, not inside feature folders.
- If a utility starts becoming feature-specific, move it into that feature's `react/` folder.

## Current files

- `get_img.ts`: media URL resolution with fallback and HEIC conversion cache.
- `get_phone_on_localhost.tsx`: React-hosted Twilio OTP bootstrap flow.
- `get_Max_zindex.ts`: highest z-index scan helper for legacy overlays.
- `reset_style.ts`: clears legacy `app` host styles before remount.
- `show_alert.tsx`: React-hosted alert modal helper.
- `attachment_preview.tsx`: React-hosted attachment preview overlay for claim attachments.
