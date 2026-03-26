# CCTV Module

Shared CCTV functionality lives here.

## Files

- `CCTVPage.tsx`: CRM CCTV workspace page.
- `showCCTVModal.tsx`: shared React-hosted CCTV player modal launcher.

## What it does

- exposes a simple CRM entry page with a default HLS stream
- opens a modal player backed by `hls.js`
- sends PTZ move and stop commands directly from modal controls

## Backend and stream integrations

- default HLS source: `/cctv_rdsp_converd/cam1/live.m3u8`
- PTZ move: `/api/move_camera/ptz/move`
- PTZ stop: `/api/move_camera/ptz/stop`

## Usage

- CRM should use `CCTVPage` directly from React routing/modules.
- Other pages should import `showCCTVModal()` from this directory instead of keeping private copies.

## Upgrade notes

- `showCCTVModal()` mounts directly to `document.body`, so cleanup must stay reliable.
- If more cameras are introduced, the page likely needs a stream selector instead of the current single hardcoded URL.
