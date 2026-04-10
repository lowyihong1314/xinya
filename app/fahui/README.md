# Fahui

This package owns FAHUI code grouped by subdomain.

## Structure
- `YLP/`: 盂兰盆法会 order, payment, board, and paiwei-print logic.
- `lamp/`: 点灯法会 registration and payment logic.
- `common/`: shared payment review, storage, and session helpers.

## Scope
- keep FAHUI code under one domain root
- separate YLP and lamp logic physically
- preserve old external blueprint URLs through in-blueprint legacy aliases

## Notes
- Root package only keeps domain-level exports; business logic lives under `YLP/`, `lamp/`, and `common/`.
- Lamp and YLP payments now share one FAHUI payment table, and use `type` to distinguish domain-specific records.
- Unified FAHUI payment review routes also live in `common/`, while `YLP/` only keeps order-specific payment endpoints.
- Route compatibility is tracked in [route_contracts.py](/home/yukang/flaskapp/xinya/app/fahui/route_contracts.py).
- Run `./venv/bin/python scripts/verify_fahui_routes.py` after refactors to verify canonical routes, legacy aliases, and a few key anonymous-access expectations.
