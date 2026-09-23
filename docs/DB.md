# Database / Alembic Guide

This project already has Flask CLI + Alembic wired up.

Current status:

- Flask CLI entry: `manage.py`
- Flask auto-discovery: `.flaskenv`
- Alembic migration directory: `migrations/`
- Current database revision: `ba36df83378f`
- Current check result: `No new upgrade operations detected.`

## 1. Run Alembic commands

Run all commands from the repository root:

```bash
cd /home/yukang/flaskapp/xinya
./venv/bin/flask db current
./venv/bin/flask db check
```

If you activate the virtualenv first, you can also use plain `flask`:

```bash
source venv/bin/activate
flask db current
flask db check
```

## 2. Daily workflow

When you change any SQLAlchemy model under `models/`, use this flow:

```bash
cd /home/yukang/flaskapp/xinya
./venv/bin/flask db check
./venv/bin/flask db migrate -m "describe your schema change"
./venv/bin/flask db upgrade
./venv/bin/flask db current
```

Recommended meaning of each command:

- `flask db check`
  Checks whether ORM and database schema are already aligned.
- `flask db migrate -m "..."`
  Generates a new migration file from model changes.
- `flask db upgrade`
  Applies pending revisions to the database.
- `flask db current`
  Shows which revision the current database is on.

## 3. What "healthy" looks like

These are the expected results when everything is aligned:

```bash
./venv/bin/flask db current
```

Expected:

```text
ba36df83378f (head)
```

```bash
./venv/bin/flask db check
```

Expected:

```text
No new upgrade operations detected.
```

## 4. Where Alembic files live

- Alembic config entry: `migrations/env.py`
- Revision files: `migrations/versions/`
- Current base revision: `migrations/versions/ba36df83378f_sync_orm_schema.py`

Important:

- Do not delete the revision file under `migrations/versions/`.
- If the database is stamped to a revision that does not exist on disk, `flask db current/check` will fail with:

```text
Can't locate revision identified by '...'
```

## 5. Before changing schema

Back up first if the change may be destructive.

Existing backup location on this machine:

- `/home/yukang/flaskapp/backup/all_database.sql`

Example backup command:

```bash
mysqldump -h 127.0.0.1 -u <user> -p --all-databases > /home/yukang/flaskapp/backup/all_database.sql
```

## 6. Notes for this project

- The project uses Flask-Migrate on top of Alembic.
- The Flask CLI is already configured, so you do not need to pass `--app`.
- The ORM loader is centralized in `models/__init__.py`, so Alembic sees all tracked model modules from there.
- `migrations/env.py` already ignores MySQL `fk_*` support indexes during comparison, so `db check` stays clean.

## 7. Safe commands to remember

```bash
./venv/bin/flask db current
./venv/bin/flask db check
./venv/bin/flask db history
./venv/bin/flask db migrate -m "your message"
./venv/bin/flask db upgrade
```

Use downgrade carefully:

```bash
./venv/bin/flask db downgrade -1
```

Only do that if you know exactly which revision you are rolling back.
