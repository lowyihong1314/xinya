# Frontend Utility Layer

Shared browser-side utility helpers used by routed React modules and compatibility shims.

## Files

- `get_img.ts`: media URL and media asset resolver with localStorage-backed media info cache, HEIC conversion, and cache invalidation helpers.
- `get_phone_on_localhost.tsx`: React-hosted Malaysia phone verification flow backed by Twilio OTP APIs.
- `get_Max_zindex.ts`: scan helper used by older DOM overlays.
- `dialogs.tsx`: shared React confirm/prompt dialogs rendered through the app overlay host.
- `browserActions.ts`: clipboard and download helpers for browser-only actions.
- `show_alert.tsx`: lightweight React alert/modal helper with auto-dismiss behavior.
- `attachment_preview.tsx`: file preview modal for images, video, audio, PDF, text, and unsupported attachments.

## Important integrations

- `get_img.ts` talks to `/media/get_event_image/:id/:variant` and `/media_file/...`.
- `get_phone_on_localhost.tsx` uses `/api/twilio/send_otp` and `/api/twilio/verify`.
- `attachment_preview.tsx` fetches files from `/media_file/...` and converts HEIC files client-side with `heic2any`.

## Why this folder exists

These helpers are shared across both the React migration and legacy compatibility code, so they live outside feature folders when the behavior is cross-cutting.

## Rules

- Prefer TypeScript for utilities here.
- Keep cross-feature helpers here, not inside a single page module.
- Move a helper into a feature folder once its API becomes feature-specific.

## Upgrade notes

- `get_img.ts` caches media metadata aggressively; if media freshness bugs appear, inspect both in-memory maps and localStorage keys.
- `show_alert.tsx`, `attachment_preview.tsx`, and `dialogs.tsx` now rely on the shared overlay provider instead of creating independent React roots.

## Current direction

- Keep this folder focused on reusable browser helpers and overlay-friendly utilities.
- Do not add new DOM-root factories or legacy remount helpers here.
