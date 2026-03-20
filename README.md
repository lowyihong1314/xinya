# Runtime Entry Points

This project currently has two main Python entry points at the repository root.

## `run.py`

Used for the normal Flask HTTP application.

### What it does

- imports `create_app()` from `function`
- creates the Flask app
- starts the HTTP server on `0.0.0.0:5015` when run directly

### Run it

```bash
python3 run.py
```

After startup, the backend HTTP API is available on:

```text
http://localhost:5015
```

Examples:

- `http://localhost:5015/api/account/get_all_claim`
- `http://localhost:5015/api/files/tree`

## `socket_server.py`

Used for the Socket.IO server.

### Run it

```bash
python3 socket_server.py
```

It starts Socket.IO on:

```text
http://localhost:8000
```

## Production Notes

- `run.py` is the HTTP app entry.
- `socket_server.py` is the realtime/socket entry.
- `app.create_app()` is the primary Flask application entry.
- If frontend assets were changed, rebuild them from `frontend/`:

```bash
npm run build
```

## Recommended Development Flow

1. Start `run.py` for normal API work.
2. Start `socket_server.py` only if the feature needs websocket events.
3. Rebuild `frontend/` when frontend source files change and the app serves `static/vite/init.js`.
