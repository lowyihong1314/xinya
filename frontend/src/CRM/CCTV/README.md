# CCTV Module

Single-camera (`cam1`) live view + PTZ + playback for the CRM. Access is gated by the `cctv` permission.

## Files

- `CCTVPage.tsx`: the whole page — tabs 直播 (live) / 回放 (playback), PTZ d-pad/zoom, permission gate.
- `vendor/video-rtc.js`: vendored go2rtc `VideoRTC` web component (upstream, plain JS).
- `vendor/videoRtcElement.ts`: registers it as `<video-rtc-cctv>` + JSX types.

## Streaming architecture (infra lives on the prod box, not in git)

- **Live** = go2rtc restreamer → **MSE over WebSocket**, ~1s latency. Frontend forces `mode="mse"` and connects to `wss://<host>/cctv_go2rtc/api/ws?src=cam1` (nginx proxies to `127.0.0.1:1984`, service `go2rtc.service`, config `/etc/go2rtc.yaml`).
- **Playback** = saved mp4 segments. `GET /api/move_camera/recordings` lists completed clips; nginx serves `/cctv_rec/cam1/` (range-enabled). Recording by ffmpeg `cctv-cam1.service` → `/srv/cctv/rec/cam1/`, pruned to 16GB by `cctv-cleanup.timer`.
- **PTZ** = ONVIF. `POST /api/move_camera/ptz/move` `{x,y,z}` and `/ptz/stop`.

## Permission gate

- Frontend: `hasUserPermission(user, "cctv")` → otherwise 权限不足.
- API: `@permission_required("cctv")`.
- Video streams (go2rtc WS + rec mp4): nginx `auth_request /cctv_authz` → `/api/move_camera/authz` (session cookie).

## Notes

- Single hardcoded camera (`cam1`). More cameras would need a stream selector + per-stream go2rtc config.
