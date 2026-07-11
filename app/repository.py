from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

DB_PATH = Path(os.getenv("TIMETRACKING_DB_PATH", "data/timetracking.db"))
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


class ActiveSessionConflictError(Exception):
    pass


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_stored_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def duration_seconds(started_at: str, ended_at: str | None) -> int:
    started = parse_stored_datetime(started_at)
    ended = parse_stored_datetime(ended_at) or datetime.now(timezone.utc)
    if started is None:
        return 0
    return max(0, int((ended - started).total_seconds()))


def normalize_to_utc(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("datetime values must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat()


def normalize_task_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise ValueError("name must not be blank")
    if len(normalized) > 80:
        raise ValueError("name must be 80 characters or fewer")
    return normalized


def validate_color(color: str) -> str:
    if not COLOR_PATTERN.fullmatch(color):
        raise ValueError("color must be a 6-digit hex value")
    return color


def init_db() -> None:
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#0a84ff',
                archived INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                notes TEXT NOT NULL DEFAULT ''
            );
            """
        )
        existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
        migrations = {
            "notes": "ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
            "sort_order": "ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
        }
        for column, statement in migrations.items():
            if column not in existing_columns:
                conn.execute(statement)
        conn.execute(
            """
            UPDATE tasks
            SET sort_order = id
            WHERE sort_order = 0
            """
        )
        active_sessions = conn.execute(
            "SELECT id, started_at FROM sessions WHERE ended_at IS NULL"
        ).fetchall()
        if len(active_sessions) > 1:
            latest = max(
                active_sessions,
                key=lambda row: (parse_stored_datetime(row["started_at"]), row["id"]),
            )
            conn.execute(
                """
                UPDATE sessions
                SET ended_at = ?
                WHERE ended_at IS NULL AND id != ?
                """,
                (latest["started_at"], latest["id"]),
            )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active
            ON sessions ((1))
            WHERE ended_at IS NULL
            """
        )


def row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def list_tasks(include_archived: bool = False) -> list[dict]:
    sql = """
        SELECT
            t.*,
            COALESCE(SUM(
                CASE
                    WHEN s.ended_at IS NULL THEN 0
                    ELSE strftime('%s', s.ended_at) - strftime('%s', s.started_at)
                END
            ), 0) AS total_seconds,
            MAX(CASE WHEN s.ended_at IS NULL THEN s.id ELSE NULL END) AS active_session_id
        FROM tasks t
        LEFT JOIN sessions s ON s.task_id = t.id
    """
    where = "" if include_archived else "WHERE t.archived = 0"
    with connect() as conn:
        rows = conn.execute(
            f"{sql} {where} GROUP BY t.id ORDER BY t.archived, t.sort_order, t.created_at"
        ).fetchall()
        return [row_to_dict(row) for row in rows]


def create_task(name: str, color: str) -> dict:
    normalized_name = normalize_task_name(name)
    validated_color = validate_color(color)
    with connect() as conn:
        next_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks").fetchone()[0]
        cursor = conn.execute(
            "INSERT INTO tasks (name, color, sort_order, created_at) VALUES (?, ?, ?, ?)",
            (normalized_name, validated_color, next_order, utc_now()),
        )
        return row_to_dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,)).fetchone())


def update_task(
    task_id: int,
    name: str | None,
    color: str | None,
    archived: bool | None,
    notes: str | None = None,
) -> dict | None:
    fields = []
    values = []
    if name is not None:
        fields.append("name = ?")
        values.append(normalize_task_name(name))
    if color is not None:
        fields.append("color = ?")
        values.append(validate_color(color))
    if archived is not None:
        fields.append("archived = ?")
        values.append(1 if archived else 0)
    if notes is not None:
        fields.append("notes = ?")
        values.append(notes.strip())
    if not fields:
        return get_task(task_id)
    values.append(task_id)
    with connect() as conn:
        conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return row_to_dict(row) if row else None


def reorder_tasks(task_ids: list[int]) -> list[dict] | None:
    with connect() as conn:
        total = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        if not task_ids:
            return [] if total == 0 else None
        placeholders = ",".join("?" for _ in task_ids)
        found = conn.execute(
            f"SELECT COUNT(*) FROM tasks WHERE id IN ({placeholders})",
            task_ids,
        ).fetchone()[0]
        if found != total or len(task_ids) != total or len(set(task_ids)) != total:
            return None
        for index, task_id in enumerate(task_ids, start=1):
            conn.execute("UPDATE tasks SET sort_order = ? WHERE id = ?", (index, task_id))
    return list_tasks(include_archived=True)


def delete_task(task_id: int) -> bool:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return cursor.rowcount > 0


def get_task(task_id: int) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return row_to_dict(row) if row else None


def start_session(task_id: int) -> dict | None:
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        task = conn.execute("SELECT * FROM tasks WHERE id = ? AND archived = 0", (task_id,)).fetchone()
        if not task:
            return None
        started_at = utc_now()
        conn.execute("UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL", (started_at,))
        cursor = conn.execute(
            "INSERT INTO sessions (task_id, started_at) VALUES (?, ?)",
            (task_id, started_at),
        )
        return get_session(cursor.lastrowid, conn)


def create_session(
    task_id: int,
    started_at: str,
    ended_at: str | None,
    notes: str,
) -> dict | None:
    started_utc = normalize_to_utc(started_at)
    ended_utc = normalize_to_utc(ended_at)
    if started_utc is None:
        raise ValueError("started_at is required")
    if ended_utc is not None and duration_seconds(started_utc, ended_utc) <= 0:
        raise ValueError("ended_at must be after started_at")
    if ended_utc is None and parse_stored_datetime(started_utc) > datetime.now(timezone.utc):
        raise ValueError("an active session cannot start in the future")
    with connect() as conn:
        if ended_utc is None:
            conn.execute("BEGIN IMMEDIATE")
        task = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            return None
        if ended_utc is None and conn.execute(
            "SELECT 1 FROM sessions WHERE ended_at IS NULL"
        ).fetchone():
            raise ActiveSessionConflictError("another session is already active")
        cursor = conn.execute(
            """
            INSERT INTO sessions (task_id, started_at, ended_at, notes)
            VALUES (?, ?, ?, ?)
            """,
            (task_id, started_utc, ended_utc, notes.strip()),
        )
        return get_session(cursor.lastrowid, conn)


def stop_active_session() -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1"
        ).fetchone()
        if not row:
            return None
        conn.execute("UPDATE sessions SET ended_at = ? WHERE id = ?", (utc_now(), row["id"]))
        return get_session(row["id"], conn)


def get_active_session() -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1"
        ).fetchone()
        return get_session(row["id"], conn) if row else None


def update_session(
    session_id: int,
    task_id: int,
    started_at: str,
    ended_at: str | None,
    notes: str,
) -> dict | None:
    started_utc = normalize_to_utc(started_at)
    ended_utc = normalize_to_utc(ended_at)
    if started_utc is None:
        raise ValueError("started_at is required")
    if ended_utc is not None and duration_seconds(started_utc, ended_utc) <= 0:
        raise ValueError("ended_at must be after started_at")
    if ended_utc is None and parse_stored_datetime(started_utc) > datetime.now(timezone.utc):
        raise ValueError("an active session cannot start in the future")
    with connect() as conn:
        if ended_utc is None:
            conn.execute("BEGIN IMMEDIATE")
        task = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            return None
        session = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not session:
            return None
        if ended_utc is None and conn.execute(
            "SELECT 1 FROM sessions WHERE ended_at IS NULL AND id != ?",
            (session_id,),
        ).fetchone():
            raise ActiveSessionConflictError("another session is already active")
        conn.execute(
            """
            UPDATE sessions
            SET task_id = ?, started_at = ?, ended_at = ?, notes = ?
            WHERE id = ?
            """,
            (task_id, started_utc, ended_utc, notes.strip(), session_id),
        )
        return get_session(session_id, conn)


def delete_session(session_id: int) -> bool:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        return cursor.rowcount > 0


def get_session(session_id: int, conn: sqlite3.Connection | None = None) -> dict | None:
    close_conn = conn is None
    if conn is None:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
    try:
        row = conn.execute(
            """
            SELECT s.*, t.name AS task_name, t.color AS task_color
            FROM sessions s
            JOIN tasks t ON t.id = s.task_id
            WHERE s.id = ?
            """,
            (session_id,),
        ).fetchone()
        return row_to_dict(row) if row else None
    finally:
        if close_conn:
            conn.close()


def list_sessions(start: str | None = None, end: str | None = None) -> list[dict]:
    start_utc = normalize_to_utc(start)
    end_utc = normalize_to_utc(end)
    if (start is None) != (end is None):
        raise ValueError("start and end must be provided together")
    if start_utc is not None and end_utc is not None and parse_stored_datetime(start_utc) >= parse_stored_datetime(end_utc):
        raise ValueError("end must be after start")

    where = ""
    params: tuple[str, str] | tuple[()] = ()
    if start_utc is not None and end_utc is not None:
        where = "WHERE s.started_at < ? AND (s.ended_at IS NULL OR s.ended_at > ?)"
        params = (end_utc, start_utc)

    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT s.*, t.name AS task_name, t.color AS task_color
            FROM sessions s
            JOIN tasks t ON t.id = s.task_id
            {where}
            ORDER BY s.started_at DESC
            """,
            params,
        ).fetchall()
        return [row_to_dict(row) for row in rows]


def list_admin_db() -> dict:
    return {
        "db_path": str(DB_PATH),
        "storage_timezone": "UTC",
        "display_timezone": "Asia/Seoul",
    }
