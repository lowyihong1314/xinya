# Info React

React version of the `info` page.

## Goals

- Replace the legacy DOM-building `init_info.js`.
- Use `designTokens` for shared color and typography decisions.
- Support two modes from user state:
  - guest browse mode
  - authenticated edit mode

## Files

- `InfoPage.tsx`: page component and editor modal.
- `api.ts`: data loading and mutation helpers.
- `types.ts`: shared types.

## Notes

- Authentication state comes from the shared user fetch bridge exposed by the React app shell.
- The page currently supports add/edit/delete for `About` and `History` content.
- `History` entries can now upload, replace, and remove images stored under `static/images/info`.
