# Event Table React Module

React rewrite for the CRM event table workspace.

## Structure

Restyled to match the 报名表格 (`CRM/form/react`) ERP **workbench** pattern: listing table →
refresh-safe detail with a tab bar.

- `EventTablePage.tsx`: URL + permission shell. Reads `?event_id=` (selected event) and `?event_tab=`
  (detail tab, default `settings`) via `useSearchParams`; writers `selectEvent`/`backToList`/`selectTab`
  clone params. Passes `canEditEvent` + state/actions to the view.
- `EventTableView.tsx`: presentational ERP chrome. **List view** — toolbar (刷新 / 新建活动) + search +
  type filter + sticky-header table (`usePagedRows` + `shared/TablePagination`, 15/page), row-click sets
  `?event_id=`. **Detail view** — 返回列表 + header + 4-tab bar: 基本设置 (pen→save `EditableFact`s) ·
  海报与附件 · 组织者 · 关联报名表.
- `useEventTableController.ts`: centralized state and backend updates; selection is driven by
  `preferredEventId` (the URL). Keeps `query`/`selectedType`/`filteredEvents`; pagination lives in the view.
- `useEventTableRealtime.ts`: reserved hook for future socket updates.
- `api.ts`: event table HTTP helpers.
- `types.ts`: event and organizer types.

## Current scope

- Listing table + refresh-safe detail are URL-driven (`?event_id=` / `?event_tab=`).
- 基本设置 fields use pen→save (`EditableFact`); persistence is the debounced autosave under the hood.
- Organizer adding still reuses the shared `select_users_modal` selector.
- Poster / brochure / event-file management are React-driven.
- Event creation and deletion are React-driven.

## Backend endpoints

- `/api/event_data/get_all_event_sort`
- `/api/event_data/new_event`
- `/api/event_data/delete_event/:eventId`
- `/api/event_data/upload_brochure/:eventId`
- `/api/event_data/event_file/upload/:eventId`
- `/api/event_data/event_file/delete/:fileId`

## Shared state model

- `useEventTableController.ts` reads the base event list from `useEventData()`.
- Mutations refresh the shared provider instead of keeping a CRM-only event cache.
- Selected event poster preview is resolved through `smartImageURL()`.

## Realtime note

`useEventTableRealtime.ts` is currently only a reserved hook and debug channel placeholder. There is no real event-table live update stream yet.

## Theme rule

- All colors must come from `frontend/src/theme/designTokens.ts`.
- If a new tint, shadow, or border color is needed, add a token first and then consume the CSS variable here.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
