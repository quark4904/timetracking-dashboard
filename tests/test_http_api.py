from __future__ import annotations

import json
import tempfile
import threading
import unittest
from http.client import HTTPResponse
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app import repository
from dev_server import Handler


class HttpApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = repository.DB_PATH
        repository.DB_PATH = Path(self.temp_dir.name) / "timetracking.db"
        repository.init_db()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        repository.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def request(self, method: str, path: str, payload: dict | None = None) -> tuple[int, object]:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            response: HTTPResponse = urlopen(request, timeout=2)
        except HTTPError as exc:
            with exc:
                raw_body = exc.read()
            return exc.code, json.loads(raw_body.decode("utf-8"))
        with response:
            raw_body = response.read()
            return response.status, json.loads(raw_body.decode("utf-8")) if raw_body else None

    def create_task(self, name: str = "Focus") -> dict:
        status, payload = self.request("POST", "/api/tasks", {"name": name, "color": "#123456"})
        self.assertEqual(status, 201)
        return payload

    def test_task_archive_restore_and_reorder(self) -> None:
        first = self.create_task("First")
        second = self.create_task("Second")

        status, archived = self.request("PATCH", f"/api/tasks/{first['id']}", {"archived": True})
        self.assertEqual(status, 200)
        self.assertEqual(archived["archived"], 1)

        status, active_tasks = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        self.assertEqual([task["id"] for task in active_tasks], [second["id"]])

        status, restored = self.request("PATCH", f"/api/tasks/{first['id']}", {"archived": False})
        self.assertEqual(status, 200)
        self.assertEqual(restored["archived"], 0)

        status, reordered = self.request("POST", "/api/tasks/reorder", {"task_ids": [second["id"], first["id"]]})
        self.assertEqual(status, 200)
        self.assertEqual([task["id"] for task in reordered], [second["id"], first["id"]])

    def test_session_crud_range_and_validation(self) -> None:
        task = self.create_task()
        completed_payload = {
            "task_id": task["id"],
            "started_at": "2026-08-01T09:00:00+09:00",
            "ended_at": "2026-08-01T10:00:00+09:00",
            "notes": "initial",
        }

        status, session = self.request("POST", "/api/sessions", completed_payload)
        self.assertEqual(status, 201)
        self.assertEqual(session["notes"], "initial")

        status, sessions = self.request(
            "GET",
            "/api/sessions?start=2026-08-01T00:00:00%2B09:00&end=2026-08-02T00:00:00%2B09:00",
        )
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in sessions], [session["id"]])

        status, updated = self.request(
            "PATCH",
            f"/api/sessions/{session['id']}",
            {
                **completed_payload,
                "ended_at": "2026-08-01T11:00:00+09:00",
                "notes": "updated",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["notes"], "updated")

        status, deleted = self.request("DELETE", f"/api/sessions/{session['id']}")
        self.assertEqual(status, 204)
        self.assertIsNone(deleted)

        status, _ = self.request(
            "POST",
            "/api/sessions",
            {
                **completed_payload,
                "started_at": "2999-08-01T09:00:00+09:00",
                "ended_at": "2999-08-01T10:00:00+09:00",
            },
        )
        self.assertEqual(status, 400)

    def test_overlapping_and_active_session_conflicts_are_http_errors(self) -> None:
        first_task = self.create_task("First")
        second_task = self.create_task("Second")
        base = {
            "task_id": first_task["id"],
            "started_at": "2026-08-02T09:00:00+09:00",
            "ended_at": "2026-08-02T10:00:00+09:00",
            "notes": "",
        }
        self.assertEqual(self.request("POST", "/api/sessions", base)[0], 201)
        self.assertEqual(
            self.request(
                "POST",
                "/api/sessions",
                {**base, "task_id": second_task["id"], "started_at": "2026-08-02T09:30:00+09:00"},
            )[0],
            409,
        )

        active = {
            "task_id": first_task["id"],
            "started_at": "2026-08-03T09:00:00+09:00",
            "ended_at": None,
            "notes": "",
        }
        self.assertEqual(self.request("POST", "/api/sessions", active)[0], 201)
        self.assertEqual(
            self.request("POST", "/api/sessions", {**active, "task_id": second_task["id"]})[0],
            409,
        )
        self.assertEqual(self.request("POST", "/api/sessions/stop")[0], 200)


if __name__ == "__main__":
    unittest.main()
