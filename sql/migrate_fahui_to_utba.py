#!/home/yukang/flaskapp/xinya/venv/bin/python
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from typing import Any

import pymysql
from pymysql.cursors import DictCursor


TOKEN_PATH = Path("/srv/flaskapp/_token.py")
DEFAULT_SOURCE_DB = "FAHUI"
DEFAULT_TARGET_DB = "UTBA"
EXCLUDED_TABLES = {"user_data"}
CREATE_ORDER = [
    "versions",
    "orders",
    "board_header",
    "print_pdf",
    "order_items",
    "payment_data",
    "item_form_data",
    "pdf_page_data",
    "board_data",
]
COPY_ORDER = list(CREATE_ORDER)
USERLIKE_COLUMNS = {
    "user_id",
    "from_user_id",
    "owner_id",
    "created_by",
    "updated_by",
    "approved_by",
    "submitter_id",
    "valid_user_id",
}


@dataclass
class DbCredentials:
    host: str
    user: str
    password: str


@dataclass
class UserRecord:
    id: int
    username: str
    display_name: str | None
    email: str | None
    phone: str | None


@dataclass
class UserMatch:
    source: UserRecord
    target: UserRecord
    reasons: list[str] = field(default_factory=list)


def load_credentials() -> DbCredentials:
    spec = spec_from_file_location("shared_token", TOKEN_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load token file from {TOKEN_PATH}")

    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return DbCredentials(
        host=module.DB_HOST,
        user=module.DB_USER,
        password=module.DB_PASSWORD,
    )


def connect(credentials: DbCredentials, database: str | None = None):
    return pymysql.connect(
        host=credentials.host,
        user=credentials.user,
        password=credentials.password,
        database=database,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )


def normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text.lower() if text else None


def normalize_phone(value: str | None) -> str | None:
    if not value:
        return None
    digits = re.sub(r"\D+", "", value)
    if not digits or len(digits) < 8:
        return None
    if digits.startswith("60") and len(digits) > 2:
        return "0" + digits[2:]
    return digits


def fetchall(conn, sql: str, params: tuple[Any, ...] | None = None):
    with conn.cursor() as cursor:
        cursor.execute(sql, params or ())
        return cursor.fetchall()


def fetchone(conn, sql: str, params: tuple[Any, ...] | None = None):
    rows = fetchall(conn, sql, params)
    return rows[0] if rows else None


def get_source_tables(conn, schema: str) -> list[str]:
    rows = fetchall(
        conn,
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = %s
        ORDER BY table_name
        """,
        (schema,),
    )
    return [row["table_name"] for row in rows if row["table_name"] not in EXCLUDED_TABLES]


def get_table_row_counts(conn, schema: str, tables: list[str]) -> dict[str, int]:
    if not tables:
        return {}
    placeholders = ", ".join(["%s"] * len(tables))
    rows = fetchall(
        conn,
        f"""
        SELECT table_name, table_rows
        FROM information_schema.tables
        WHERE table_schema = %s
          AND table_name IN ({placeholders})
        ORDER BY table_name
        """,
        (schema, *tables),
    )
    return {row["table_name"]: int(row["table_rows"] or 0) for row in rows}


def get_create_table_sql(conn, schema: str, table: str) -> str:
    row = fetchone(conn, f"SHOW CREATE TABLE `{schema}`.`{table}`")
    if not row:
        raise RuntimeError(f"Unable to fetch CREATE TABLE for {schema}.{table}")
    return row["Create Table"]


def table_exists(conn, schema: str, table: str) -> bool:
    row = fetchone(
        conn,
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = %s AND table_name = %s
        """,
        (schema, table),
    )
    return row is not None


def get_columns(conn, schema: str, table: str) -> list[str]:
    rows = fetchall(conn, f"SHOW COLUMNS FROM `{schema}`.`{table}`")
    return [row["Field"] for row in rows]


def get_auto_increment_column(conn, schema: str, table: str) -> str | None:
    rows = fetchall(conn, f"SHOW COLUMNS FROM `{schema}`.`{table}`")
    for row in rows:
        if row["Extra"] == "auto_increment":
            return row["Field"]
    return None


def fetch_rows(conn, schema: str, table: str, columns: list[str]) -> list[dict[str, Any]]:
    column_sql = ", ".join(f"`{column}`" for column in columns)
    return fetchall(conn, f"SELECT {column_sql} FROM `{schema}`.`{table}`")


def fetch_users(conn, schema: str) -> list[UserRecord]:
    if not table_exists(conn, schema, "user_data"):
        return []
    rows = fetchall(
        conn,
        f"""
        SELECT id, username, display_name, email, phone
        FROM `{schema}`.`user_data`
        ORDER BY id
        """,
    )
    return [
        UserRecord(
            id=int(row["id"]),
            username=row["username"],
            display_name=row["display_name"],
            email=row["email"],
            phone=row["phone"],
        )
        for row in rows
    ]


def load_manual_mapping(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(key).strip().lower(): str(value).strip() for key, value in payload.items()}


def build_user_matches(
    source_users: list[UserRecord],
    target_users: list[UserRecord],
    manual_mapping: dict[str, str],
) -> tuple[dict[str, UserMatch], list[tuple[UserRecord, list[UserRecord], list[str]]]]:
    target_by_username: dict[str, list[UserRecord]] = {}
    target_by_phone: dict[str, list[UserRecord]] = {}
    target_by_email: dict[str, list[UserRecord]] = {}
    target_by_display_name: dict[str, list[UserRecord]] = {}

    for user in target_users:
        username_key = normalize_text(user.username)
        if username_key:
            target_by_username.setdefault(username_key, []).append(user)
        phone_key = normalize_phone(user.phone)
        if phone_key:
            target_by_phone.setdefault(phone_key, []).append(user)
        email_key = normalize_text(user.email)
        if email_key:
            target_by_email.setdefault(email_key, []).append(user)
        display_key = user.display_name.strip() if user.display_name else None
        if display_key:
            target_by_display_name.setdefault(display_key, []).append(user)

    matches: dict[str, UserMatch] = {}
    unresolved: list[tuple[UserRecord, list[UserRecord], list[str]]] = []

    for source_user in source_users:
        source_key = normalize_text(source_user.username) or ""
        if source_key in manual_mapping:
            target_name = normalize_text(manual_mapping[source_key])
            candidates = target_by_username.get(target_name or "", [])
            if len(candidates) != 1:
                unresolved.append((source_user, candidates, ["manual"]))
                continue
            matches[source_key] = UserMatch(source=source_user, target=candidates[0], reasons=["manual"])
            continue

        candidate_map: dict[int, UserRecord] = {}
        reasons_by_id: dict[int, list[str]] = {}

        def add_candidates(candidates: list[UserRecord], reason: str):
            for candidate in candidates:
                candidate_map[candidate.id] = candidate
                reasons_by_id.setdefault(candidate.id, []).append(reason)

        add_candidates(target_by_username.get(source_key, []), "username")
        phone_key = normalize_phone(source_user.phone)
        if phone_key:
            add_candidates(target_by_phone.get(phone_key, []), "phone")
        email_key = normalize_text(source_user.email)
        if email_key:
            add_candidates(target_by_email.get(email_key, []), "email")
        display_key = source_user.display_name.strip() if source_user.display_name else None
        if display_key:
            add_candidates(target_by_display_name.get(display_key, []), "display_name")

        candidates = list(candidate_map.values())
        if len(candidates) == 1:
            target_user = candidates[0]
            matches[source_key] = UserMatch(
                source=source_user,
                target=target_user,
                reasons=reasons_by_id.get(target_user.id, []),
            )
            continue

        unresolved.append(
            (
                source_user,
                candidates,
                [",".join(reasons_by_id.get(candidate.id, [])) for candidate in candidates],
            )
        )

    return matches, unresolved


def get_candidate_user_columns(conn, schema: str, tables: list[str]) -> list[dict[str, Any]]:
    if not tables:
        return []
    placeholders = ", ".join(["%s"] * len(tables))
    return fetchall(
        conn,
        f"""
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = %s
          AND table_name IN ({placeholders})
          AND (
            LOWER(column_name) LIKE %s
            OR LOWER(column_name) IN ({", ".join(["%s"] * len(USERLIKE_COLUMNS))})
          )
        ORDER BY table_name, ordinal_position
        """,
        (schema, *tables, "%user_id", *sorted(USERLIKE_COLUMNS)),
    )


def get_referenced_reviewer_usernames(conn, schema: str) -> list[str]:
    if not table_exists(conn, schema, "payment_data"):
        return []
    rows = fetchall(
        conn,
        f"""
        SELECT DISTINCT valid_by
        FROM `{schema}`.`payment_data`
        WHERE valid_by IS NOT NULL AND valid_by <> ''
        ORDER BY valid_by
        """,
    )
    return [row["valid_by"] for row in rows]


def rewrite_row(table: str, row: dict[str, Any], user_matches: dict[str, UserMatch]) -> dict[str, Any]:
    if table == "payment_data" and row.get("valid_by"):
        source_key = normalize_text(str(row["valid_by"]))
        match = user_matches.get(source_key or "")
        if match:
            row["valid_by"] = match.target.username
    return row


def print_report(
    source_db: str,
    target_db: str,
    tables: list[str],
    row_counts: dict[str, int],
    user_matches: dict[str, UserMatch],
    unresolved_users: list[tuple[UserRecord, list[UserRecord], list[str]]],
    reviewer_usernames: list[str],
    candidate_user_columns: list[dict[str, Any]],
):
    print(f"Source DB: {source_db}")
    print(f"Target DB: {target_db}")
    print("")
    print("Tables to migrate:")
    for table in tables:
        print(f"  - {table}: {row_counts.get(table, 0)} rows")
    print("")
    print("Detected user-like business columns:")
    if candidate_user_columns:
        for item in candidate_user_columns:
            print(f"  - {item['table_name']}.{item['column_name']} ({item['data_type']})")
    else:
        print("  - none")
    print("")
    print("Reviewer usernames referenced by payment_data.valid_by:")
    if reviewer_usernames:
        for name in reviewer_usernames:
            source_key = normalize_text(name) or ""
            match = user_matches.get(source_key)
            if match:
                print(f"  - {name} -> {match.target.username} ({', '.join(match.reasons)})")
            else:
                print(f"  - {name} -> UNMATCHED")
    else:
        print("  - none")
    print("")
    print("Resolved FAHUI user matches:")
    if user_matches:
        for source_key in sorted(user_matches):
            match = user_matches[source_key]
            print(
                f"  - {match.source.username} (#{match.source.id}) -> "
                f"{match.target.username} (#{match.target.id}) "
                f"[{', '.join(match.reasons)}]"
            )
    else:
        print("  - none")
    print("")
    print("Unresolved FAHUI users:")
    if unresolved_users:
        for source_user, candidates, reasons in unresolved_users:
            if not candidates:
                print(f"  - {source_user.username} (#{source_user.id}) -> no candidate")
                continue
            formatted = ", ".join(
                f"{candidate.username}#{candidate.id}<{reason}>"
                for candidate, reason in zip(candidates, reasons)
            )
            print(f"  - {source_user.username} (#{source_user.id}) -> {formatted}")
    else:
        print("  - none")


def ensure_target_tables_absent(conn, target_db: str, tables: list[str]):
    existing = [table for table in tables if table_exists(conn, target_db, table)]
    if existing:
        raise RuntimeError(
            "Target DB already contains FAHUI tables: " + ", ".join(existing)
        )


def create_tables(conn, source_db: str, target_db: str):
    with conn.cursor() as cursor:
        cursor.execute(f"USE `{target_db}`")
        for table in CREATE_ORDER:
            ddl = get_create_table_sql(conn, source_db, table)
            cursor.execute(ddl)


def copy_table_data(conn, source_db: str, target_db: str, table: str, user_matches: dict[str, UserMatch]):
    columns = get_columns(conn, source_db, table)
    rows = fetch_rows(conn, source_db, table, columns)
    if not rows:
        return 0

    rewritten_rows = [rewrite_row(table, dict(row), user_matches) for row in rows]
    placeholders = ", ".join(["%s"] * len(columns))
    column_sql = ", ".join(f"`{column}`" for column in columns)
    values = [tuple(row[column] for column in columns) for row in rewritten_rows]

    with conn.cursor() as cursor:
        cursor.executemany(
            f"INSERT INTO `{target_db}`.`{table}` ({column_sql}) VALUES ({placeholders})",
            values,
        )

        auto_column = get_auto_increment_column(conn, target_db, table)
        if auto_column:
            cursor.execute(
                f"SELECT COALESCE(MAX(`{auto_column}`), 0) + 1 AS next_id FROM `{target_db}`.`{table}`"
            )
            next_id = int(cursor.fetchone()["next_id"])
            cursor.execute(f"ALTER TABLE `{target_db}`.`{table}` AUTO_INCREMENT = %s", (next_id,))

    return len(values)


def execute_copy(
    credentials: DbCredentials,
    source_db: str,
    target_db: str,
    user_matches: dict[str, UserMatch],
):
    conn = connect(credentials)
    try:
        ensure_target_tables_absent(conn, target_db, CREATE_ORDER)
        create_tables(conn, source_db, target_db)
        total_rows = 0
        for table in COPY_ORDER:
            inserted = copy_table_data(conn, source_db, target_db, table, user_matches)
            total_rows += inserted
            print(f"Copied {inserted} rows into {target_db}.{table}")
        conn.commit()
        print(f"Done. Total copied rows: {total_rows}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Migrate FAHUI business tables into UTBA.")
    parser.add_argument("--source-db", default=DEFAULT_SOURCE_DB)
    parser.add_argument("--target-db", default=DEFAULT_TARGET_DB)
    parser.add_argument("--mode", choices=["dry-run", "execute"], default="dry-run")
    parser.add_argument("--user-map-json", type=Path, default=None)
    args = parser.parse_args()

    credentials = load_credentials()
    conn = connect(credentials)
    try:
        tables = get_source_tables(conn, args.source_db)
        missing_tables = [table for table in CREATE_ORDER if table not in tables]
        if missing_tables:
            raise RuntimeError(
                "Source DB is missing expected tables: " + ", ".join(missing_tables)
            )

        row_counts = get_table_row_counts(conn, args.source_db, tables)
        source_users = fetch_users(conn, args.source_db)
        target_users = fetch_users(conn, args.target_db)
        manual_mapping = load_manual_mapping(args.user_map_json)
        user_matches, unresolved_users = build_user_matches(source_users, target_users, manual_mapping)
        reviewer_usernames = get_referenced_reviewer_usernames(conn, args.source_db)
        candidate_user_columns = get_candidate_user_columns(conn, args.source_db, tables)

        print_report(
            source_db=args.source_db,
            target_db=args.target_db,
            tables=tables,
            row_counts=row_counts,
            user_matches=user_matches,
            unresolved_users=unresolved_users,
            reviewer_usernames=reviewer_usernames,
            candidate_user_columns=candidate_user_columns,
        )

        unresolved_reviewer_usernames = [
            name
            for name in reviewer_usernames
            if (normalize_text(name) or "") not in user_matches
        ]

        if args.mode == "dry-run":
            if unresolved_reviewer_usernames:
                print("")
                print("Dry-run warning: unresolved reviewer usernames -> " + ", ".join(unresolved_reviewer_usernames))
            return

        if unresolved_reviewer_usernames:
            raise RuntimeError(
                "Cannot execute migration because some reviewer usernames are unresolved: "
                + ", ".join(unresolved_reviewer_usernames)
            )
    finally:
        conn.close()

    execute_copy(
        credentials=credentials,
        source_db=args.source_db,
        target_db=args.target_db,
        user_matches=user_matches,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
