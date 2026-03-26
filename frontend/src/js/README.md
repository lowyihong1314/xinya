# Frontend Utility Layer

Shared browser-side utility helpers used by both legacy DOM modules and React modules.

## Files

- `get_img.ts`: media URL and media asset resolver with localStorage-backed media info cache, HEIC conversion, and cache invalidation helpers.
- `get_phone_on_localhost.tsx`: React-hosted Malaysia phone verification flow backed by Twilio OTP APIs.
- `get_Max_zindex.ts`: scan helper used by older DOM overlays.
- `reset_style.ts`: clears the legacy `app` host before remounting a new experience.
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

- `reset_style.ts` still matters for old mount paths that reuse the same `#app` node.
- `get_img.ts` caches media metadata aggressively; if media freshness bugs appear, inspect both in-memory maps and localStorage keys.
- `show_alert.tsx` and `attachment_preview.tsx` create React roots directly on `document.body`, so cleanup must stay reliable.

## React Router Migration Track

- This folder currently mixes healthy shared utilities with migration debt helpers. `reset_style.ts` exists only for legacy mount flows and should disappear once `window.app` and `Legacy*` mount helpers are removed.
- UI helpers that create ad-hoc roots on `document.body` should be moved into a shared React portal/modal system owned by the app shell, not left as one-off factories.
- End-state for `src/js` is pure reusable browser utilities and hook-friendly helpers. It should no longer be the place where feature UI or navigation bridges live.
