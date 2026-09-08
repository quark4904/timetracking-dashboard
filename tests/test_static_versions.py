import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import update_static_versions as versions


class StaticVersionTestCase(unittest.TestCase):
    def test_dependency_change_propagates_and_second_run_is_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            static = root / "app" / "static"
            shutil.copytree(versions.ROOT / "app" / "static", static)
            date_time = static / "modules" / "date-time.mjs"
            date_time.write_text(date_time.read_text() + "\n// regression fixture\n")
            with patch.object(versions, "ROOT", root), patch.object(versions, "INDEX", static / "index.html"):
                versions.main()
                reporting = static / "modules" / "reporting.mjs"
                app = static / "app.js"
                self.assertIn(f'./date-time.mjs?v={versions.asset_version(date_time)}', reporting.read_text())
                self.assertIn(f'./modules/date-time.mjs?v={versions.asset_version(date_time)}', app.read_text())
                self.assertIn(f'./modules/reporting.mjs?v={versions.asset_version(reporting)}', app.read_text())
                self.assertIn(f'/static/app.js?v={versions.asset_version(app)}', (static / "index.html").read_text())
                paths = [date_time, reporting, app, static / "index.html"]
                before = [path.read_bytes() for path in paths]
                versions.main()
                self.assertEqual(before, [path.read_bytes() for path in paths])
