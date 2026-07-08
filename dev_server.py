from __future__ import annotations

import json
import mimetypes
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
            except ValueError as exc:
                return self.send_error(400, str(exc))
        if parsed.path == "/api/admin/db":
            return self.send_json(repository.list_admin_db())
        return self.send_error(404)

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            return self.serve_file(STATIC / "index.html", head_only=True)
        if parsed.path.startswith("/static/"):
            return self.serve_file(STATIC / parsed.path.removeprefix("/static/"), head_only=True)
        if parsed.path in {"/api/health", "/api/tasks", "/api/sessions", "/api/admin/db"}:
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            return
        return self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/tasks":
            payload = self.read_json()
            return self.send_json(repository.create_task(payload["name"], payload["color"]), status=201)
        if parsed.path == "/api/tasks/reorder":
            payload = self.read_json()
            tasks = repository.reorder_tasks([int(task_id) for task_id in payload.get("task_ids", [])])
            if tasks is None:
                return self.send_error(404, "Task not found")
            return self.send_json(tasks)
        if parsed.path == "/api/sessions":
            payload = self.read_json()
            try:
                session = repository.create_session(
                    int(payload["task_id"]),
                    payload["started_at"],
                    payload.get("ended_at"),
                    payload.get("notes", ""),
                )
            except ValueError as exc:
                return self.send_error(400, str(exc))
            if session is None:
                return self.send_error(404, "Task not found")
            return self.send_json(session, status=201)
        if parsed.path.endswith("/start") and parsed.path.startswith("/api/tasks/"):
            task_id = int(parsed.path.split("/")[3])
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
            session_id = int(parsed.path.split("/")[3])
            payload = self.read_json()
            try:
                session = repository.update_session(
                    session_id,
                    int(payload["task_id"]),
                    payload["started_at"],
                    payload.get("ended_at"),
                    payload.get("notes", ""),
                )
            except ValueError as exc:
                return self.send_error(400, str(exc))
            if session is None:
                return self.send_error(404, "Session not found")
            return self.send_json(session)
        if parsed.path.startswith("/api/tasks/"):
            task_id = int(parsed.path.split("/")[3])
            payload = self.read_json()
            task = repository.update_task(
                task_id,
                payload.get("name"),
                payload.get("color"),
                payload.get("archived"),
                payload.get("notes"),
            )
            if task is None:
                return self.send_error(404, "Task not found")
            return self.send_json(task)
        return self.send_error(404)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/tasks/"):
            task_id = int(parsed.path.split("/")[3])
            if not repository.delete_task(task_id):
                return self.send_error(404, "Task not found")
            self.send_response(204)
            self.end_headers()
            return
        if parsed.path.startswith("/api/sessions/"):
            session_id = int(parsed.path.split("/")[3])
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
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
    server = ThreadingHTTPServer(("0.0.0.0", 8010), Handler)
    print("Serving timetracking dashboard on http://0.0.0.0:8010")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except sqlite3.Error as exc:
        raise SystemExit(f"Database error: {exc}") from exc
