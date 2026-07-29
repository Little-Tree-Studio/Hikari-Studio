from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any


LOGGER = logging.getLogger(__name__)

THEME_IDS = {"hikari-light", "graphite", "sakura-studio", "high-contrast"}
DEFAULT_EDITOR_APPEARANCE: dict[str, Any] = {
    "version": 1,
    "mode": "system",
    "themeId": "hikari-light",
    "motion": "system",
}


def normalize_editor_appearance(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    result = dict(DEFAULT_EDITOR_APPEARANCE)
    if source.get("mode") in {"system", "fixed"}:
        result["mode"] = source["mode"]
    if source.get("themeId") in THEME_IDS:
        result["themeId"] = source["themeId"]
    if source.get("motion") in {"system", "full", "reduced"}:
        result["motion"] = source["motion"]
    accent = source.get("accentColor")
    if isinstance(accent, str) and len(accent) == 7 and accent.startswith("#"):
        try:
            int(accent[1:], 16)
            result["accentColor"] = accent.lower()
        except ValueError:
            pass
    return result


class EditorAppearanceStore:
    def __init__(self, config_dir: Path) -> None:
        self.path = config_dir.resolve() / "editor-appearance.json"

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return dict(DEFAULT_EDITOR_APPEARANCE)
        try:
            return normalize_editor_appearance(json.loads(self.path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError):
            LOGGER.exception("Editor appearance configuration is invalid; defaults restored")
            return dict(DEFAULT_EDITOR_APPEARANCE)

    def save(self, value: Any) -> dict[str, Any]:
        normalized = normalize_editor_appearance(value)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(prefix="editor-appearance-", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump(normalized, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return normalized
