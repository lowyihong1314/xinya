# Event

This package owns event listing, event editing, event flow APIs, and event check-in APIs.

## Files
- `routes.py`: Flask routes for `/event_data/*`.
- `services.py`: query and write logic for events, `EventFlowData`, and `EventCheckIn`.

## Notes
- The external URL prefix remains `/event_data` for compatibility.
- This replaces the old single-file `app/event_data.py` layout.

## Check-in APIs

- `POST /event_data/check_in/save`
- `POST /event_data/check_in/delete/<check_in_id>`
- `DELETE /event_data/check_in/delete/<check_in_id>`

## Event payload

- `EventData.to_dict_full()` now includes `check_ins`
- frontend can read check-in data directly from event detail/list payloads without calling a separate check-in list API
