from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class WindowPlacement:
    width: int = 1440
    height: int = 900
    x: int | None = None
    y: int | None = None
    maximized: bool = False


class WindowStateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()

    def load(self) -> WindowPlacement:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError
            width = min(7680, max(1080, int(value.get("width", 1440))))
            height = min(4320, max(680, int(value.get("height", 900))))
            x = value.get("x")
            y = value.get("y")
            return WindowPlacement(width, height, int(x) if x is not None else None, int(y) if y is not None else None, bool(value.get("maximized", False)))
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return WindowPlacement()

    def save(self, placement: WindowPlacement) -> None:
        payload = json.dumps(asdict(placement), ensure_ascii=False, indent=2)
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(prefix=".window-state-", suffix=".tmp", dir=self.path.parent)
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary_name, self.path)
            except Exception:
                try:
                    os.unlink(temporary_name)
                except OSError:
                    pass
                raise

    def capture(self, window: Any, *, maximized: bool, previous: WindowPlacement | None = None) -> WindowPlacement:
        previous = previous or self.load()

        def window_value(name: str, fallback: int | None) -> int | None:
            try:
                value = getattr(window, name)
                return int(value) if value is not None else fallback
            except (AttributeError, TypeError, ValueError):
                return fallback

        if maximized:
            placement = WindowPlacement(previous.width, previous.height, previous.x, previous.y, True)
        else:
            placement = WindowPlacement(
                width=max(1080, window_value("width", previous.width) or previous.width),
                height=max(680, window_value("height", previous.height) or previous.height),
                x=window_value("x", previous.x),
                y=window_value("y", previous.y),
                maximized=False,
            )
        self.save(placement)
        return placement
