from __future__ import annotations

import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app import repository


class RepositoryTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = repository.DB_PATH
        repository.DB_PATH = Path(self.temp_dir.name) / "timetracking.db"
        repository.init_db()

    def tearDown(self) -> None:
        repository.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def create_task(self, name: str = "Focus") -> dict:
        return repository.create_task(name, "#123456")

    def test_category_migration_classifies_existing_tasks_once(self) -> None:
        repository.DB_PATH = Path(self.temp_dir.name) / "legacy.db"
        with sqlite3.connect(repository.DB_PATH) as conn:
            conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, "
                         "color TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)")
            conn.executemany("INSERT INTO tasks (name, color, created_at) VALUES (?, '#123456', '2020-01-01')",
                             [("Entertainment",), ("Study",), (" entertainment ",)])
        repository.init_db()
        tasks = repository.list_tasks()
        self.assertEqual([task["category"] for task in tasks], ["leisure", "growth", "leisure"])
        repository.update_task(tasks[0]["id"], None, None, None, category="growth")
        repository.init_db()
        self.assertEqual(repository.get_task(tasks[0]["id"])["category"], "growth")

    def test_category_changes_apply_to_existing_sessions(self) -> None:
        task = repository.create_task("Entertainment", "#123456", "leisure")
        session = repository.create_session(task["id"], "2020-01-01T00:00:00+00:00",
                                            "2020-01-01T01:00:00+00:00", "")
        self.assertEqual(session["task_category"], "leisure")
        repository.update_task(task["id"], None, None, None, category="growth")
        self.assertEqual(repository.list_sessions()[0]["task_category"], "growth")
        self.assertEqual(repository.get_session(session["id"])["task_category"], "growth")
        with self.assertRaisesRegex(ValueError, "category must be"):
            repository.create_task("Invalid", "#123456", "other")
        with self.assertRaisesRegex(ValueError, "category must be"):
            repository.update_task(task["id"], None, None, None, category="other")

    def test_task_values_are_normalized_and_validated(self) -> None:
        task = self.create_task("  Focus  ")

        self.assertEqual(task["name"], "Focus")
        with self.assertRaisesRegex(ValueError, "must not be blank"):
            self.create_task("   ")
        with self.assertRaisesRegex(ValueError, "6-digit hex"):
            repository.create_task("Focus", "red")

    def test_datetime_requires_timezone(self) -> None:
        task = self.create_task()

        with self.assertRaisesRegex(ValueError, "include a timezone"):
            repository.create_session(
                task["id"],
                "2026-07-11T09:00:00",
                "2026-07-11T10:00:00",
                "",
            )

        with self.assertRaisesRegex(ValueError, "cannot start in the future"):
            repository.create_session(
                task["id"],
                "2999-07-11T09:00:00+09:00",
                None,
                "",
            )

    def test_completed_session_cannot_end_in_the_future(self) -> None:
        task = self.create_task()

        with self.assertRaisesRegex(ValueError, "cannot end in the future"):
            repository.create_session(
                task["id"],
                "2026-07-11T09:00:00+09:00",
                "2999-07-11T10:00:00+09:00",
                "",
            )

    def test_overlapping_sessions_are_rejected(self) -> None:
        task = self.create_task()
        repository.create_session(
            task["id"],
            "2020-07-11T09:00:00+09:00",
            "2020-07-11T10:00:00+09:00",
            "",
        )

        with self.assertRaises(repository.SessionOverlapError):
            repository.create_session(
                task["id"],
                "2020-07-11T09:30:00+09:00",
                "2020-07-11T10:30:00+09:00",
                "",
            )

    def test_completed_session_cannot_overlap_active_session(self) -> None:
        task = self.create_task()
        repository.create_session(task["id"], "2020-07-11T09:00:00+09:00", None, "")

        with self.assertRaises(repository.SessionOverlapError):
            repository.create_session(
                task["id"],
                "2020-07-11T09:30:00+09:00",
                "2020-07-11T10:30:00+09:00",
                "",
            )

    def test_only_one_session_can_be_active(self) -> None:
        first_task = self.create_task("First")
        second_task = self.create_task("Second")
        first = repository.start_session(first_task["id"])

        with self.assertRaises(repository.ActiveSessionConflictError):
            repository.create_session(
                second_task["id"],
                "2020-07-11T09:00:00+09:00",
                None,
                "",
            )

        second = repository.start_session(second_task["id"])
        sessions = repository.list_sessions()
        active = [session for session in sessions if session["ended_at"] is None]

        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertEqual([session["id"] for session in active], [second["id"]])
        self.assertIsNotNone(next(session for session in sessions if session["id"] == first["id"])["ended_at"])

    def test_database_index_rejects_a_second_active_session(self) -> None:
        task = self.create_task()
        repository.create_session(task["id"], "2020-07-11T09:00:00+09:00", None, "")

        with self.assertRaises(sqlite3.IntegrityError), repository.connect() as conn:
            conn.execute(
                "INSERT INTO sessions (task_id, started_at) VALUES (?, ?)",
                (task["id"], "2026-07-11T01:00:00+00:00"),
            )

    def test_concurrent_session_starts_leave_one_active_session(self) -> None:
        first_task = self.create_task("First")
        second_task = self.create_task("Second")

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(repository.start_session, [first_task["id"], second_task["id"]]))

        self.assertTrue(all(results))
        active = [session for session in repository.list_sessions() if session["ended_at"] is None]
        self.assertEqual(len(active), 1)

    def test_concurrent_stop_and_start_never_leave_multiple_active_sessions(self) -> None:
        first_task = self.create_task("First")
        second_task = self.create_task("Second")
        repository.start_session(first_task["id"])

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(repository.stop_active_session),
                executor.submit(repository.start_session, second_task["id"]),
            ]
            [future.result() for future in futures]

        active = [session for session in repository.list_sessions() if session["ended_at"] is None]
        self.assertLessEqual(len(active), 1)

    def test_migration_repairs_existing_duplicate_active_sessions(self) -> None:
        task = self.create_task()
        with repository.connect() as conn:
            conn.execute("DROP INDEX idx_sessions_single_active")
            conn.execute(
                "INSERT INTO sessions (task_id, started_at) VALUES (?, ?)",
                (task["id"], "2026-07-11T00:00:00+00:00"),
            )
            latest = conn.execute(
                "INSERT INTO sessions (task_id, started_at) VALUES (?, ?)",
                (task["id"], "2026-07-11T01:00:00+00:00"),
            ).lastrowid

        repository.init_db()
        sessions = repository.list_sessions()
        active = [session for session in sessions if session["ended_at"] is None]

        self.assertEqual([session["id"] for session in active], [latest])
        self.assertTrue(all(session["ended_at"] for session in sessions if session["id"] != latest))

    def test_range_query_includes_sessions_that_overlap_boundaries(self) -> None:
        task = self.create_task()
        session = repository.create_session(
            task["id"],
            "2026-07-10T23:00:00+09:00",
            "2026-07-11T01:00:00+09:00",
            "crosses midnight",
        )

        first_day = repository.list_sessions(
            "2026-07-10T00:00:00+09:00",
            "2026-07-11T00:00:00+09:00",
        )
        second_day = repository.list_sessions(
            "2026-07-11T00:00:00+09:00",
            "2026-07-12T00:00:00+09:00",
        )

        self.assertEqual([item["id"] for item in first_day], [session["id"]])
        self.assertEqual([item["id"] for item in second_day], [session["id"]])

    def test_admin_payload_contains_only_displayed_metadata(self) -> None:
        self.create_task()

        payload = repository.list_admin_db()

        self.assertEqual(
            set(payload),
            {"db_path", "storage_timezone", "display_timezone"},
        )


if __name__ == "__main__":
    unittest.main()
