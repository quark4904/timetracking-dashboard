from __future__ import annotations

import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "app" / "static" / "index.html"


def asset_version(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def content_version(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:12]


def update_reference(source: str, asset: str, version: str) -> tuple[str, int]:
    pattern = re.compile(rf"({re.escape(asset)}\?v=)[^\"']+")
    return pattern.subn(rf"\g<1>{version}", source)


def main() -> None:
    index = INDEX.read_text()
    styles_version = asset_version(ROOT / "app" / "static" / "styles.css")
    index, count = update_reference(index, "/static/styles.css", styles_version)
    if count != 1:
        raise SystemExit(f"expected one cache reference for /static/styles.css, found {count}")

    app_path = ROOT / "app" / "static" / "app.js"
    app = app_path.read_text()
    module_references = {
        "./modules/date-time.mjs": ROOT / "app" / "static" / "modules" / "date-time.mjs",
        "./modules/reporting.mjs": ROOT / "app" / "static" / "modules" / "reporting.mjs",
    }
    for asset, path in module_references.items():
        updated_app, count = update_reference(app, asset, asset_version(path))
        if count != 1:
            raise SystemExit(f"expected one cache reference for {asset}, found {count}")
        app = updated_app

    if app != app_path.read_text():
        app_path.write_text(app)

    index, count = update_reference(index, "/static/app.js", content_version(app))
    if count != 1:
        raise SystemExit(f"expected one cache reference for /static/app.js, found {count}")
    if index != INDEX.read_text():
        INDEX.write_text(index)

    print("Updated static asset cache versions.")


if __name__ == "__main__":
    main()
