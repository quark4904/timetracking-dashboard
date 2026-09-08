"""Run explicitly: python -m unittest tests.browser_checks -v."""
from __future__ import annotations

import tempfile
import threading
import unittest
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

from app import repository
from dev_server import Handler


class BrowserChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        cls.browser = cls.playwright.chromium.launch()
        cls.addClassCleanup(cls.browser.close)

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        original_path = repository.DB_PATH
        repository.DB_PATH = Path(directory.name) / "browser.db"
        self.addCleanup(setattr, repository, "DB_PATH", original_path)
        repository.init_db()
        self.task = repository.create_task("Focus", "#123456")
        repository.create_session(self.task["id"], "2026-01-31T00:00:00+00:00",
                                  "2026-01-31T01:00:45.123456+00:00", "first")
        self.session = repository.create_session(self.task["id"], "2026-01-31T01:00:45.123456+00:00",
                                                 "2026-01-31T01:00:55.654321+00:00", "short session")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.context = self.browser.new_context()
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.page.clock.install(time=datetime.fromisoformat("2026-01-31T12:15:42+09:00"))
        self.page.goto(self.base_url)
        expect(self.page.locator(".task-row")).to_have_count(1)

    def test_note_only_edit_preserves_subminute_times(self) -> None:
        self.page.locator(f'#tasks-entry-list [data-session-id="{self.session["id"]}"]').click()
        self.page.locator("#session-notes").fill("updated note")
        with self.page.expect_response(lambda response: response.request.method == "PATCH") as saved:
            self.page.locator("#save-session").click()
        self.assertEqual(saved.value.status, 200)
        edited = saved.value.json()
        self.assertEqual(edited["started_at"], self.session["started_at"])
        self.assertEqual(edited["ended_at"], self.session["ended_at"])
        self.assertEqual(edited["notes"], "updated note")
        expect(self.page.locator("#session-dialog")).not_to_be_visible()

    def test_month_end_navigation_does_not_skip_february(self) -> None:
        self.page.locator('[data-view="reports"]').click()
        self.page.locator('[data-report-range="month"]').click()
        expect(self.page.locator("#report-current-period")).to_have_attribute("aria-label", "January 2026")
        self.page.locator("#report-next-period").click()
        expect(self.page.locator("#report-current-period")).to_have_attribute("aria-label", "February 2026")
        self.page.locator("#report-prev-period").click()
        expect(self.page.locator("#report-current-period")).to_have_attribute("aria-label", "January 2026")

    def test_today_defaults_can_be_saved(self) -> None:
        self.page.locator('[data-view="timeline"]').click()
        self.page.locator("#timeline-add-session").click()
        expect(self.page.locator("#session-start-hour")).to_have_value("11")
        expect(self.page.locator("#session-end-hour")).to_have_value("12")
        with self.page.expect_response(lambda response: response.request.method == "POST") as saved:
            self.page.locator("#save-session").click()
        self.assertEqual(saved.value.status, 201)

    def test_return_to_cached_month_ignores_delayed_response(self) -> None:
        self.page.locator('[data-view="timeline"]').click()
        expect(self.page.locator(".timeline-event")).to_have_count(2)
        pending = []

        def delay_previous_month(route):
            query = parse_qs(urlparse(route.request.url).query)
            if query.get("start", [""])[0].startswith("2025-12"):
                pending.append(route)
            else:
                route.continue_()

        self.page.route("**/api/sessions?*", delay_previous_month)
        picker = self.page.locator("#timeline-date-picker")
        with self.page.expect_request(lambda request: "2025-12-01" in request.url):
            picker.fill("2025-12-31")
            picker.dispatch_event("change")
        picker.fill("2026-01-31")
        picker.dispatch_event("change")
        self.assertTrue(pending)
        # Route fulfilment models the old month finishing after returning to the cached month.
        for route in pending:
            route.fulfill(json=[])
        self.page.wait_for_load_state("networkidle")
        expect(self.page.locator(".timeline-event")).to_have_count(2)
        expect(picker).to_have_value("2026-01-31")

    def test_older_dashboard_refresh_cannot_restore_deleted_task(self) -> None:
        pending = []
        old_tasks = repository.list_tasks(True)

        def delay_tasks(route):
            if not pending:
                pending.append(route)
            else:
                route.continue_()

        self.page.route("**/api/tasks?include_archived=true", delay_tasks)
        # Advancing the clock starts the scheduled dashboard refresh.
        with self.page.expect_request("**/api/tasks?include_archived=true"):
            self.page.clock.run_for(60_000)
        self.assertTrue(pending)
        self.page.locator("#task-edit-toggle").click()
        self.page.locator(".task-info-button").click()
        self.page.locator("#delete-current-task").click()
        self.page.locator("#confirm-accept").click()
        expect(self.page.locator(".task-row")).to_have_count(0)
        for route in pending:
            route.fulfill(json=old_tasks)
        self.page.wait_for_load_state("networkidle")
        expect(self.page.locator(".task-row")).to_have_count(0)

    def test_mobile_session_editor_and_stop(self) -> None:
        context = self.browser.new_context(**self.playwright.devices["iPhone 13"])
        self.addCleanup(context.close)
        page = context.new_page()
        page.clock.install(time=datetime.fromisoformat("2026-01-31T12:15:42+09:00"))
        page.goto(self.base_url)
        page.locator(f'#tasks-entry-list [data-session-id="{self.session["id"]}"]').click()
        page.locator("#session-start-hour").focus()
        for field in ("session-start-minute", "session-end-hour", "session-end-minute"):
            page.keyboard.press("Tab")
            expect(page.locator(f"#{field}")).to_be_focused()
        page.locator("#session-notes").fill("mobile note")
        with page.expect_response(lambda response: response.request.method == "PATCH") as saved:
            page.locator("#save-session").click()
        self.assertEqual(saved.value.status, 200)
        expect(page.locator("#session-dialog")).not_to_be_visible()
        page.locator(".task-row").click()
        expect(page.locator("#active-session-control")).to_be_enabled()
        page.locator('[data-view="timeline"]').click()
        expect(page.locator("#active-session-control")).to_be_in_viewport()
        page.locator("#active-session-control").click()
        expect(page.locator("#active-session-control")).to_be_disabled()
