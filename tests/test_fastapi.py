from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

from app import repository
from tests import test_http_api


HAS_API_DEPS = all(importlib.util.find_spec(name) for name in ("fastapi", "httpx"))


@unittest.skipUnless(HAS_API_DEPS, "Install requirements-test.txt to test the production API")
class FastApiTestCase(test_http_api.HttpApiTestCase):
    """Run the same HTTP scenarios against the app used by Docker."""

    def setUp(self) -> None:
        from fastapi.testclient import TestClient
        from app.main import app

        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.original_db_path = repository.DB_PATH
        repository.DB_PATH = Path(self.temp_dir.name) / "timetracking.db"
        self.addCleanup(setattr, repository, "DB_PATH", self.original_db_path)
        self.client = self.enterContext(TestClient(app))

    def tearDown(self) -> None:
        # TestClient lifespan and the temporary DB are handled by addCleanup.
        pass

    def request(self, method: str, path: str, payload: dict | None = None) -> tuple[int, object]:
        response = self.client.request(method, path, json=payload)
        return response.status_code, response.json() if response.content else None

    def test_invalid_payloads_are_validation_errors(self) -> None:
        self.assertEqual(self.request("POST", "/api/tasks", {"name": " ", "color": "red"})[0], 422)
        task = self.create_task()
        self.assertEqual(self.request("POST", "/api/sessions", {
            "task_id": task["id"], "started_at": "2026-08-01T09:00:00",
        })[0], 422)

    def test_note_only_edit_preserves_adjacent_subminute_session(self) -> None:
        task = self.create_task()
        boundary = "2026-08-01T01:00:45.123456+00:00"
        self.assertEqual(self.request("POST", "/api/sessions", {
            "task_id": task["id"], "started_at": "2026-08-01T00:00:00+00:00", "ended_at": boundary,
        })[0], 201)
        payload = {"task_id": task["id"], "started_at": boundary,
                   "ended_at": "2026-08-01T01:00:55.654321+00:00", "notes": "initial"}
        status, session = self.request("POST", "/api/sessions", payload)
        self.assertEqual(status, 201)
        status, edited = self.request("PATCH", f"/api/sessions/{session['id']}", {**payload, "notes": "edited"})
        self.assertEqual(status, 200)
        self.assertEqual(edited["started_at"], boundary)
        self.assertEqual(edited["ended_at"], payload["ended_at"])
