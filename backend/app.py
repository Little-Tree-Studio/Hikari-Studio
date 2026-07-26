from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

from .api import DesktopApi
from .logging_config import configure_logging
from .project_store import ProjectStore


ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIST = ROOT / "frontend" / "dist"
DATA_DIR = ROOT / "data"


def create_api(data_dir: Path = DATA_DIR) -> DesktopApi:
    return DesktopApi(ProjectStore(data_dir), ROOT)


def main() -> None:
    parser = argparse.ArgumentParser(description="Hikari Studio desktop editor")
    parser.add_argument("--debug", action="store_true", help="Enable webview debug tools")
    args = parser.parse_args()

    log_path = configure_logging(DATA_DIR)
    logging.getLogger(__name__).info("Starting Hikari Studio; log=%s", log_path)

    if not FRONTEND_DIST.joinpath("desktop.html").exists():
        raise SystemExit("Frontend build is missing. Run: cd frontend && pnpm install && pnpm build")

    try:
        import webview
    except ImportError as exc:
        raise SystemExit("pywebview is not installed. Run: pip install -r requirements.txt") from exc

    api = create_api()
    editor_url = (FRONTEND_DIST / "desktop.html").as_uri()
    window = webview.create_window(
        title="Hikari Studio",
        url=editor_url,
        js_api=api,
        width=1440,
        height=900,
        min_size=(1080, 680),
        frameless=True,
        easy_drag=False,
        background_color="#f4f6f8",
    )
    api._bind_window(window)
    webview.start(debug=args.debug or os.getenv("HIKARI_DEBUG") == "1", private_mode=True)
