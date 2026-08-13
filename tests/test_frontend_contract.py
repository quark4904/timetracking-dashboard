from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "app" / "static"


class FrontendContractTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (STATIC / "index.html").read_text()
        cls.css = (STATIC / "styles.css").read_text()
        cls.js = (STATIC / "app.js").read_text()

    def test_session_time_tab_order_is_explicit(self) -> None:
        ids = [
            "session-start-hour",
            "session-start-minute",
            "session-end-hour",
            "session-end-minute",
            "session-start-date",
            "session-end-date",
        ]
        positions = [self.html.index(f'id="{item}"') for item in ids]
        self.assertEqual(positions, sorted(positions))

    def test_accessibility_contracts_are_present(self) -> None:
        self.assertIn('role="tablist"', self.html)
        self.assertGreaterEqual(len(re.findall(r'role="tab"', self.html)), 3)
        self.assertIn('aria-controls="task-panel-content"', self.html)
        self.assertIn('role="tabpanel"', self.html)
        self.assertIn('type="button" id="report-current-period"', self.html)
        self.assertIn('aria-controls="session-task-menu"', self.html)
        self.assertIn('role="listbox"', self.html)
        self.assertIn('role="option"', self.js)
        self.assertIn('aria-activedescendant', self.js)
        self.assertIn('type="module"', self.html)

    def test_mobile_active_session_and_error_feedback_contracts_are_present(self) -> None:
        self.assertIn("body.has-active-session .active-session-control", self.css)
        self.assertIn("safe-area-inset-bottom", self.css)
        self.assertIn('id="session-form-error"', self.html)
        self.assertIn('id="toast"', self.html)
        self.assertIn("apiLatest(\"timeline-sessions\"", self.js)
        self.assertIn("apiLatest(\"report-sessions\"", self.js)


if __name__ == "__main__":
    unittest.main()
