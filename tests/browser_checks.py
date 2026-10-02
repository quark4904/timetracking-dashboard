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
        self.page_errors = []
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.addCleanup(self.assertEqual, self.page_errors, [])
        self.page.clock.install(time=datetime.fromisoformat("2026-01-31T12:15:42+09:00"))
        self.page.goto(self.base_url)
        expect(self.page.locator(".task-row")).to_have_count(1)

    def test_mobile_category_creation_and_unclassified_ratio(self) -> None:
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.locator('[data-record-view="tasks"]').click()
        self.page.locator("#add-task").click()
        expect(self.page.locator("#task-category")).to_have_value("growth")
        self.page.locator("#task-name").fill("Entertainment")
        self.page.locator("#task-category").select_option("leisure")
        with self.page.expect_response(lambda response: response.request.method == "POST") as saved:
            self.page.locator('#task-form button[type="submit"]').click()
        task = saved.value.json()
        self.assertEqual(task["category"], "leisure")
        expect(self.page.locator(f'.task-row[data-task-id="{task["id"]}"] .task-category-badge')).to_have_text("Leisure")
        repository.create_session(task["id"], "2026-01-31T02:00:00+00:00", "2026-01-31T03:00:00+00:00", "")
        self.page.locator('[data-view="reports"]').click()
        expect(self.page.locator("#report-growth-percent")).to_have_text("50%")
        expect(self.page.locator("#report-leisure-percent")).to_have_text("50%")
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390)
        self.page.locator('[data-view="tasks"]').click()
        self.page.locator("#task-edit-toggle").click()
        self.page.locator(f'.task-row[data-task-id="{task["id"]}"] .task-info-button').click()
        self.page.locator("#edit-task-category").select_option("unclassified")
        self.page.locator('#task-edit-form button[type="submit"]').click()
        expect(self.page.locator("#task-edit-dialog")).not_to_be_visible()
        self.page.locator('[data-view="reports"]').click()
        expect(self.page.locator("#report-growth-percent")).to_have_text("100%")
        expect(self.page.locator("#report-leisure-percent")).to_have_text("0%")
        expect(self.page.locator("#report-category-note")).to_contain_text("Unclassified: 1:00")

    def test_task_category_edit_updates_report_ratio(self) -> None:
        expect(self.page.locator(".task-row .task-category-badge")).to_have_text("Growth")
        self.page.locator('[data-view="reports"]').click()
        expect(self.page.locator("#report-growth-percent")).to_have_text("100%")
        expect(self.page.locator("#report-leisure-percent")).to_have_text("0%")
        self.page.locator('[data-view="tasks"]').click()
        self.page.locator("#task-edit-toggle").click()
        self.page.locator(".task-info-button").click()
        self.page.locator("#edit-task-category").select_option("leisure")
        self.page.locator('#task-edit-form button[type="submit"]').click()
        expect(self.page.locator(".task-row .task-category-badge")).to_have_text("Leisure")
        self.page.locator('[data-view="reports"]').click()
        expect(self.page.locator("#report-growth-percent")).to_have_text("0%")
        expect(self.page.locator("#report-leisure-percent")).to_have_text("100%")
        self.page.locator('[data-report-range="day"]').click()
        expect(self.page.locator("#report-leisure-percent")).to_have_text("100%")
        self.page.locator("#report-next-period").click()
        expect(self.page.locator("#report-leisure-percent")).to_have_text("0%")
        expect(self.page.locator("#report-category-note")).to_have_text("No classified time in this period yet")

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
        expect(self.page.locator('[data-report-range="month"]')).to_have_attribute("aria-pressed", "true")
        expect(self.page.locator(".bar-chart")).to_have_attribute("data-range", "month")
        expect(self.page.locator("#report-current-period")).to_have_attribute("aria-label", "January 2026")
        self.page.locator("#report-next-period").click()
        expect(self.page.locator("#report-current-period")).to_have_attribute("aria-label", "February 2026")
        self.page.locator("#report-prev-period").click()
        expect(self.page.locator("#report-current-period")).to_have_attribute("aria-label", "January 2026")

    def test_mobile_month_chart_centers_today_on_entry_and_reload(self) -> None:
        context = self.browser.new_context(viewport={"width": 390, "height": 844},
                                           timezone_id="America/Los_Angeles")
        self.addCleanup(context.close)
        page = context.new_page()
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        self.addCleanup(self.assertEqual, page_errors, [])
        page.clock.install(time=datetime.fromisoformat("2026-01-01T00:30:00+09:00"))

        def expect_today_centered(date: str) -> None:
            chart = page.locator("#bar-chart")
            expect(chart).to_have_attribute("data-range", "month")
            expect(chart.locator(f'[data-date="{date}"]')).to_be_attached()
            error = chart.evaluate("""(chart, date) => {
                const day = chart.querySelector(`[data-date="${date}"]`).getBoundingClientRect();
                const rect = chart.getBoundingClientRect();
                return Math.abs(day.left + day.width / 2 - rect.left - chart.clientWidth / 2);
            }""", date)
            self.assertLessEqual(error, 1)
            self.assertTrue(page.evaluate("document.documentElement.scrollWidth <= innerWidth"))

        for day in (1, 15, 31):
            date = f"2026-01-{day:02d}"
            page.clock.set_fixed_time(datetime.fromisoformat(f"{date}T00:30:00+09:00"))
            page.goto(self.base_url)
            page.locator('[data-view="reports"]').click()
            expect_today_centered(date)
            # A refresh must not pull the chart away from the user's chosen days.
            chart = page.locator("#bar-chart")
            chart.evaluate("chart => chart.scrollLeft = 80")
            before = chart.evaluate("chart => chart.scrollLeft")
            with page.expect_response("**/api/sessions?*"):
                page.clock.run_for(60_000)
            page.wait_for_load_state("networkidle")
            self.assertAlmostEqual(chart.evaluate("chart => chart.scrollLeft"), before, delta=1)
            page.locator('[data-view="tasks"]').click()
            page.locator('[data-view="reports"]').click()
            expect_today_centered(date)
            page.reload()
            page.locator('[data-view="reports"]').click()
            expect_today_centered(date)

        for width in (320, 768):
            page.set_viewport_size({"width": width, "height": 844})
            page.locator('[data-view="tasks"]').click()
            page.locator('[data-view="reports"]').click()
            expect_today_centered("2026-01-31")
        page.locator("#report-prev-period").click()
        expect(page.locator("#bar-chart")).to_have_attribute("data-period", "month:2025-12-01")
        self.assertFalse(page.locator("#bar-chart").evaluate("chart => chart.hasAttribute('data-center-today')"))
        self.assertEqual(page.locator("#bar-chart").evaluate("chart => chart.scrollLeft"), 0)
        page.locator("#report-current-reset").click()
        expect_today_centered("2026-01-31")

    def test_desktop_month_chart_keeps_full_width_without_centering(self) -> None:
        self.page.set_viewport_size({"width": 1920, "height": 1080})
        self.page.locator('[data-view="reports"]').click()
        chart = self.page.locator("#bar-chart")
        expect(chart).to_have_attribute("data-range", "month")
        self.assertEqual(chart.evaluate("chart => chart.scrollLeft"), 0)
        self.assertLessEqual(chart.evaluate("chart => chart.scrollWidth"), chart.evaluate("chart => chart.clientWidth"))

    def test_today_defaults_can_be_saved(self) -> None:
        self.page.locator('[data-record-view="timeline"].record-tab').click()
        self.page.locator("#timeline-add-session").click()
        expect(self.page.locator("#session-start-hour")).to_have_value("11")
        expect(self.page.locator("#session-end-hour")).to_have_value("12")
        with self.page.expect_response(lambda response: response.request.method == "POST") as saved:
            self.page.locator("#save-session").click()
        self.assertEqual(saved.value.status, 201)

    def test_return_to_cached_month_ignores_delayed_response(self) -> None:
        self.page.locator('[data-record-view="timeline"].record-tab').click()
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
        page.locator("#record-tab-list").click()
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
        page.locator("#record-tab-tasks").click()
        page.locator(".task-row .task-run-icon").click()
        expect(page.locator("#active-session-control")).to_be_enabled()
        page.locator('[data-record-view="timeline"].record-tab').click()
        expect(page.locator("#active-session-control")).to_be_in_viewport()
        page.locator("#active-session-control").click()
        expect(page.locator("#active-session-control")).to_be_disabled()

    def test_mobile_session_actions_follow_keyboard_viewport(self) -> None:
        context = self.browser.new_context(**self.playwright.devices["iPhone 13"])
        self.addCleanup(context.close)
        page = context.new_page()
        page.clock.install(time=datetime.fromisoformat("2026-01-31T12:15:42+09:00"))
        page.goto(self.base_url)
        page.locator("#record-tab-list").click()
        page.locator(f'#tasks-entry-list [data-session-id="{self.session["id"]}"]').click()
        expect(page.locator("#delete-session")).to_be_visible()
        self.assertLess(page.locator("#delete-session").bounding_box()["y"],
                        page.locator("#session-notes").bounding_box()["y"])
        page.locator("#session-notes").fill("keyboard note")

        # Model iOS: the keyboard changes the visual viewport, while layout
        # height stays unchanged. Also model Safari panning the viewport.
        layout_height = page.evaluate("innerHeight")
        page.evaluate("""() => {
            Object.defineProperty(visualViewport, 'height', {configurable: true, get: () => 420});
            Object.defineProperty(visualViewport, 'offsetTop', {configurable: true, get: () => 110});
            visualViewport.dispatchEvent(new Event('resize'));
            visualViewport.dispatchEvent(new Event('scroll'));
        }""")
        self.assertEqual(page.evaluate("innerHeight"), layout_height)

        def assert_actions_above_keyboard() -> None:
            dialog = page.locator("#session-dialog").bounding_box()
            self.assertAlmostEqual(dialog["y"], 110, delta=1)
            self.assertAlmostEqual(dialog["height"], 420, delta=1)
            for button_id in ("save-session", "cancel-session-edit"):
                button = page.locator(f"#{button_id}").bounding_box()
                self.assertGreaterEqual(button["y"], 110)
                self.assertLessEqual(button["y"] + button["height"], 530)
                self.assertTrue(page.locator(f"#{button_id}").evaluate("""button => {
                    const rect = button.getBoundingClientRect();
                    return document.elementFromPoint(rect.x + rect.width / 2,
                        rect.y + rect.height / 2) === button;
                }"""))

        assert_actions_above_keyboard()
        page.locator("#session-form .session-form-body").evaluate("body => body.scrollTop = body.scrollHeight")
        assert_actions_above_keyboard()
        with page.expect_response(lambda response: response.request.method == "PATCH") as saved:
            page.locator("#save-session").click()
        self.assertEqual(saved.value.status, 200)
        self.assertEqual(saved.value.json()["notes"], "keyboard note")
        expect(page.locator("#session-dialog")).not_to_be_visible()

        page.locator("#record-tab-timeline").click()
        page.locator("#timeline-add-session").click()
        expect(page.locator("#delete-session")).not_to_be_visible()
        expect(page.locator("#save-session")).to_have_text("Create")
        assert_actions_above_keyboard()
        page.locator("#cancel-session-edit").click()
        expect(page.locator("#session-dialog")).not_to_be_visible()

        # Closing the keyboard restores the full-height sheet on reopening.
        page.evaluate("""() => {
            delete visualViewport.height;
            delete visualViewport.offsetTop;
            visualViewport.dispatchEvent(new Event('resize'));
        }""")
        page.locator("#timeline-add-session").click()
        dialog = page.locator("#session-dialog").bounding_box()
        self.assertAlmostEqual(dialog["y"], 0, delta=1)
        self.assertAlmostEqual(dialog["height"], layout_height, delta=1)

    def test_task_history_click_does_not_start_timer(self) -> None:
        other = repository.create_task("Other", "#654321")
        repository.create_session(other["id"], "2026-01-31T03:00:00+00:00",
                                  "2026-01-31T03:30:00+00:00", "other task")
        repository.create_session(self.task["id"], "2025-12-15T00:00:00+00:00",
                                  "2025-12-15T00:20:00+00:00", "older session")
        self.page.reload()
        expect(self.page.locator(".task-row")).to_have_count(2)

        self.page.locator(f'.task-row[data-task-id="{self.task["id"]}"] .task-details-trigger').click()
        expect(self.page.locator("#entries-title")).to_have_text("Focus")
        expect(self.page.locator("#tasks-entry-list .entry-row")).to_have_count(3)
        expect(self.page.locator("#active-session-control")).to_be_disabled()

        self.page.locator(f'.task-row[data-task-id="{self.task["id"]}"] .task-run-icon').click()
        expect(self.page.locator("#active-session-control")).to_be_enabled()
        self.page.locator("#show-all-activity").click()
        expect(self.page.locator("#entries-title")).to_have_text("Day activity")

    def test_desktop_workspace_keeps_tasks_beside_both_record_views(self) -> None:
        expect(self.page.locator(".nav-item")).to_have_count(2)
        expect(self.page.locator("#record-tab-tasks")).not_to_be_visible()
        rail = self.page.locator("#tasks-rail")
        activity = self.page.locator("#activity-view")
        wide_activity_width = None
        for width in (821, 1024, 1280, 1440, 1920, 2560):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 1000})
                self.page.locator("#record-tab-list").click()
                expect(rail).to_be_visible()
                expect(activity).to_be_visible()
                rail_box = rail.bounding_box()
                activity_box = activity.bounding_box()
                self.assertLessEqual(rail_box["x"] + rail_box["width"], activity_box["x"])
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
                self.assertGreaterEqual(self.page.locator(".task-name").first.evaluate(
                    "element => parseFloat(getComputedStyle(element).fontSize)"
                ), 16)
                if width == 1920:
                    wide_activity_width = activity_box["width"]
                elif width == 2560:
                    self.assertGreater(activity_box["width"], wide_activity_width)
                self.page.locator("#record-tab-timeline").click()
                expect(rail).to_be_visible()
                expect(activity).not_to_be_visible()
                expect(self.page.locator("#timeline-view")).to_be_visible()
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.page.locator(".task-details-trigger").click()
        expect(activity).to_be_visible()
        expect(self.page.locator("#entries-title")).to_have_text("Focus")
        expect(self.page.locator("#active-session-control")).to_be_disabled()

    def test_selected_day_is_shared_and_splits_midnight_entries(self) -> None:
        repository.create_session(self.task["id"], "2026-01-30T23:30:00+09:00",
                                  "2026-01-31T00:30:00+09:00", "across midnight")
        self.page.reload()
        expect(self.page.locator("#today-total")).to_have_text("1:30")
        expect(self.page.locator("#tasks-entry-list .entry-row")).to_have_count(3)
        self.page.locator("#track-prev-day").click()
        expect(self.page.locator("#timeline-date-picker")).to_have_value("2026-01-30")
        expect(self.page.locator("#today-total")).to_have_text("0:30")
        expect(self.page.locator("#tasks-entry-list .entry-row")).to_have_count(1)
        expect(self.page.locator(".entry-row > strong")).to_have_text("0:30")
        self.page.locator("#record-tab-timeline").click()
        expect(self.page.locator(".timeline-event")).to_have_count(1)
        expect(self.page.locator(".timeline-event-duration")).to_have_text("0:30")
        self.page.locator("#track-today").click()
        expect(self.page.locator("#today-total")).to_have_text("1:30")
        expect(self.page.locator(".timeline-event")).to_have_count(3)

    def test_mobile_views_and_resize_keep_controls_accessible(self) -> None:
        context = self.browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        self.addCleanup(context.close)
        page = context.new_page()
        page.clock.install(time=datetime.fromisoformat("2026-01-31T12:15:42+09:00"))
        page.goto(self.base_url)
        expect(page.locator("#tasks-rail")).to_be_visible()
        expect(page.locator("#activity-view")).not_to_be_visible()
        page.locator(".task-details-trigger").click()
        expect(page.locator("#activity-view")).to_be_visible()
        expect(page.locator("#tasks-rail")).not_to_be_visible()
        expect(page.locator("#record-tab-list")).to_have_attribute("aria-selected", "true")
        expect(page.locator("#active-session-control")).to_be_disabled()
        page.locator("#record-tab-tasks").click()
        self.assertGreaterEqual(page.locator(".task-action").bounding_box()["height"], 44)
        page.locator(".task-action").click()
        expect(page.locator("#active-session-control")).to_be_in_viewport()
        page.locator('[data-view="reports"]').click()
        expect(page.locator("#active-session-control")).to_be_in_viewport()
        page.locator("#active-session-control").click()
        expect(page.locator("#active-session-control")).not_to_be_visible()
        page.locator('[data-view="tasks"]').click()
        for width in (320, 390, 768):
            page.set_viewport_size({"width": width, "height": 844})
            for tab in ("tasks", "list", "timeline"):
                page.locator(f"#record-tab-{tab}").click()
                self.assertTrue(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), (width, tab))
        page.locator("#record-tab-tasks").click()
        page.set_viewport_size({"width": 1440, "height": 900})
        expect(page.locator("#tasks-rail")).to_be_visible()
        expect(page.locator("#activity-view")).to_be_visible()
        expect(page.locator("#record-tab-tasks")).not_to_be_visible()

    def test_report_layout_and_disclosure_at_desktop_and_mobile_widths(self) -> None:
        self.page.locator('[data-view="reports"]').click()
        expect(self.page.locator("#total-time")).to_have_text("1:00")
        expect(self.page.locator("#session-list")).not_to_be_visible()
        self.page.locator(".sessions-panel > summary").click()
        expect(self.page.locator("#session-list .session-row")).to_have_count(2)
        for width in (320, 390, 768, 821, 1024, 1280, 1440, 1920, 2560):
            self.page.set_viewport_size({"width": width, "height": 900})
            for mode in ("day", "week", "month", "year"):
                self.page.locator(f'[data-report-range="{mode}"]').click()
                expect(self.page.locator(".bar-chart")).to_have_attribute("data-range", mode)
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), (width, mode))
                if mode == "week":
                    expect(self.page.locator(".bar-weekday-short")).to_have_count(7)
                    expect(self.page.locator(".bar-weekday-full").first).not_to_be_visible()
                    self.assertTrue(self.page.locator(".bar-date").evaluate_all(
                        "labels => labels.every(label => label.getBoundingClientRect().width <= "
                        "label.closest('.report-bar-wrap').getBoundingClientRect().width)"
                    ), width)
        self.page.locator('[data-report-range="day"]').click()
        self.page.locator(f'#session-list [data-session-id="{self.session["id"]}"]').click()
        expect(self.page.locator("#session-dialog")).to_be_visible()

    def test_record_tabs_support_keyboard_navigation(self) -> None:
        self.page.locator("#record-tab-list").focus()
        self.page.keyboard.press("ArrowRight")
        expect(self.page.locator("#record-tab-timeline")).to_be_focused()
        expect(self.page.locator("#timeline-view")).to_be_visible()
        self.page.keyboard.press("Home")
        expect(self.page.locator("#record-tab-list")).to_be_focused()
        expect(self.page.locator("#activity-view")).to_be_visible()
