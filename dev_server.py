from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from app import repository

ROOT = Path(__file__).parent
STATIC = ROOT / "app" / "static"


class Handler(BaseHTTPRequestHandler):
    server_version = "TimetrackingDev/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            return self.serve_file(STATIC / "index.html")
        if parsed.path.startswith("/static/"):
            return self.serve_file(STATIC / parsed.path.removeprefix("/static/"))
        if parsed.path == "/api/health":
            return self.send_json({"ok": True})
        if parsed.path == "/api/tasks":
            include_archived = parse_qs(parsed.query).get("include_archived", ["false"])[0] == "true"
            return self.send_json(repository.list_tasks(include_archived))
        if parsed.path == "/api/sessions":
            query = parse_qs(parsed.query)
            try:
                return self.send_json(repository.list_sessions(
                    query.get("start", [None])[0],
                    query.get("end", [None])[0],
                ))
            except (KeyError, TypeError, ValueError) as exc:
                return self.send_error(400, str(exc))
        if parsed.path == "/api/sessions/active":
            return self.send_json(repository.get_active_session())
        if parsed.path == "/api/admin/db":
            return self.send_json(repository.list_admin_db())
        return self.send_error(404)

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            return self.serve_file(STATIC / "index.html", head_only=True)
        if parsed.path.startswith("/static/"):
            return self.serve_file(STATIC / parsed.path.removeprefix("/static/"), head_only=True)
        if parsed.path in {"/api/health", "/api/tasks", "/api/sessions", "/api/sessions/active", "/api/admin/db"}:
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            return
        return self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/tasks":
            payload = self.read_payload()
            if payload is None:
                return
            try:
                task = repository.create_task(payload["name"], payload["color"])
            except (KeyError, ValueError) as exc:
                return self.send_error(400, str(exc))
            return self.send_json(task, status=201)
        if parsed.path == "/api/tasks/reorder":
            payload = self.read_payload()
            if payload is None:
                return
            try:
                task_ids = [int(task_id) for task_id in payload.get("task_ids", [])]
            except (TypeError, ValueError) as exc:
                return self.send_error(400, str(exc))
            tasks = repository.reorder_tasks(task_ids)
            if tasks is None:
                return self.send_error(404, "Task not found")
            return self.send_json(tasks)
        if parsed.path == "/api/sessions":
            payload = self.read_payload()
            if payload is None:
                return
            try:
                session = repository.create_session(
                    int(payload["task_id"]),
                    payload["started_at"],
                    payload.get("ended_at"),
                    payload.get("notes", ""),
                )
            except repository.ActiveSessionConflictError as exc:
                return self.send_error(409, str(exc))
            except repository.SessionOverlapError as exc:
                return self.send_error(409, str(exc))
            except (KeyError, TypeError, ValueError) as exc:
                return self.send_error(400, str(exc))
            if session is None:
                return self.send_error(404, "Task not found")
            return self.send_json(session, status=201)
        if parsed.path.endswith("/start") and parsed.path.startswith("/api/tasks/"):
            try:
                task_id = int(parsed.path.split("/")[3])
            except (IndexError, ValueError):
                return self.send_error(400, "Task id must be an integer")
            session = repository.start_session(task_id)
            if session is None:
                return self.send_error(404, "Task not found")
            return self.send_json(session, status=201)
        if parsed.path == "/api/sessions/stop":
            session = repository.stop_active_session()
            if session is None:
                return self.send_error(404, "No active session")
            return self.send_json(session)
        return self.send_error(404)

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/sessions/"):
            try:
                session_id = int(parsed.path.split("/")[3])
            except (IndexError, ValueError):
                return self.send_error(400, "Session id must be an integer")
            payload = self.read_payload()
            if payload is None:
                return
            try:
                session = repository.update_session(
                    session_id,
                    int(payload["task_id"]),
                    payload["started_at"],
                    payload.get("ended_at"),
                    payload.get("notes", ""),
                )
            except repository.ActiveSessionConflictError as exc:
                return self.send_error(409, str(exc))
            except repository.SessionOverlapError as exc:
                return self.send_error(409, str(exc))
            except (KeyError, TypeError, ValueError) as exc:
                return self.send_error(400, str(exc))
            if session is None:
                return self.send_error(404, "Session not found")
            return self.send_json(session)
        if parsed.path.startswith("/api/tasks/"):
            try:
                task_id = int(parsed.path.split("/")[3])
            except (IndexError, ValueError):
                return self.send_error(400, "Task id must be an integer")
            payload = self.read_payload()
            if payload is None:
                return
            try:
                task = repository.update_task(
                    task_id,
                    payload.get("name"),
                    payload.get("color"),
                    payload.get("archived"),
                    payload.get("notes"),
                )
            except (TypeError, ValueError) as exc:
                return self.send_error(400, str(exc))
            if task is None:
                return self.send_error(404, "Task not found")
            return self.send_json(task)
        return self.send_error(404)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/tasks/"):
            try:
                task_id = int(parsed.path.split("/")[3])
            except (IndexError, ValueError):
                return self.send_error(400, "Task id must be an integer")
            if not repository.delete_task(task_id):
                return self.send_error(404, "Task not found")
            return self.send_json({"ok": True})
        if parsed.path.startswith("/api/sessions/"):
            try:
                session_id = int(parsed.path.split("/")[3])
            except (IndexError, ValueError):
                return self.send_error(400, "Session id must be an integer")
            if not repository.delete_session(session_id):
                return self.send_error(404, "Session not found")
            self.send_response(204)
            self.end_headers()
            return
        return self.send_error(404)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

    def read_payload(self) -> dict | None:
        try:
            return self.read_json()
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
            self.send_error(400, f"Invalid JSON: {exc}")
            return None

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        if self.path.startswith("/api/"):
            self.send_json({"detail": message or "Request failed"}, status=code)
            return
        super().send_error(code, message, explain)

    def serve_file(self, path: Path, head_only: bool = False) -> None:
        try:
            resolved = path.resolve()
            static_root = STATIC.resolve()
            if resolved != static_root and static_root not in resolved.parents:
                return self.send_error(403)
            body = resolved.read_bytes()
        except FileNotFoundError:
            return self.send_error(404)
        content_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")


def main() -> None:
    repository.init_db()
    host = os.getenv("TIMETRACKING_HOST", "0.0.0.0")
    port = int(os.getenv("TIMETRACKING_PORT", "8010"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Serving timetracking dashboard on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except sqlite3.Error as exc:
        raise SystemExit(f"Database error: {exc}") from exc
