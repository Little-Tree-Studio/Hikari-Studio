from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


MIN_WINDOW_WIDTH = 760
MIN_WINDOW_HEIGHT = 520


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

    @staticmethod
    def _screen_bounds(screen: Any, scale_factor: float = 1) -> tuple[int, int, int, int]:
        frame = getattr(screen, "frame", None)
        factor = scale_factor if 1 <= scale_factor <= 4 else 1
        return (
            round(int(getattr(frame, "X", getattr(screen, "x", 0))) / factor),
            round(int(getattr(frame, "Y", getattr(screen, "y", 0))) / factor),
            round(int(getattr(frame, "Width", getattr(screen, "width", 0))) / factor),
            round(int(getattr(frame, "Height", getattr(screen, "height", 0))) / factor),
        )

    @classmethod
    def fit_to_screens(
        cls,
        placement: WindowPlacement,
        screens: list[Any] | tuple[Any, ...],
        scale_factor: float = 1,
    ) -> WindowPlacement:
        bounds = [cls._screen_bounds(screen, scale_factor) for screen in screens]
        bounds = [item for item in bounds if item[2] > 0 and item[3] > 0]
        if not bounds:
            return placement

        target = bounds[0]
        if placement.x is not None and placement.y is not None:
            center_x = placement.x + placement.width // 2
            center_y = placement.y + placement.height // 2
            target = next(
                (item for item in bounds if item[0] <= center_x < item[0] + item[2] and item[1] <= center_y < item[1] + item[3]),
                target,
            )

        frame_x, frame_y, frame_width, frame_height = target
        width = min(placement.width, frame_width)
        height = min(placement.height, frame_height)
        if placement.x is None or placement.y is None:
            x = frame_x + max(0, frame_width - width) // 2
            y = frame_y + max(0, frame_height - height) // 2
        else:
            x = min(max(placement.x, frame_x), frame_x + max(0, frame_width - width))
            y = min(max(placement.y, frame_y), frame_y + max(0, frame_height - height))
        return WindowPlacement(width, height, x, y, placement.maximized)

    def load(self, *, screens: list[Any] | tuple[Any, ...] = (), scale_factor: float = 1) -> WindowPlacement:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError
            version = int(value.get("version", 1))
            factor = scale_factor if version < 2 and 1 <= scale_factor <= 4 else 1
            width = min(7680, max(MIN_WINDOW_WIDTH, round(int(value.get("width", 1440)) / factor)))
            height = min(4320, max(MIN_WINDOW_HEIGHT, round(int(value.get("height", 900)) / factor)))
            x = value.get("x")
            y = value.get("y")
            placement = WindowPlacement(
                width,
                height,
                round(int(x) / factor) if x is not None else None,
                round(int(y) / factor) if y is not None else None,
                bool(value.get("maximized", False)),
            )
            return self.fit_to_screens(placement, screens, scale_factor) if screens else placement
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            placement = WindowPlacement()
            return self.fit_to_screens(placement, screens, scale_factor) if screens else placement

    def save(self, placement: WindowPlacement) -> None:
        payload = json.dumps({"version": 2, **asdict(placement)}, ensure_ascii=False, indent=2)
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

    def capture(
        self,
        window: Any,
        *,
        maximized: bool,
        previous: WindowPlacement | None = None,
        scale_factor: float = 1,
        screens: list[Any] | tuple[Any, ...] = (),
    ) -> WindowPlacement:
        previous = previous or self.load()
        factor = scale_factor if 1 <= scale_factor <= 4 else 1

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
                width=max(MIN_WINDOW_WIDTH, round((window_value("width", round(previous.width * factor)) or round(previous.width * factor)) / factor)),
                height=max(MIN_WINDOW_HEIGHT, round((window_value("height", round(previous.height * factor)) or round(previous.height * factor)) / factor)),
                x=round(value / factor) if (value := window_value("x", None)) is not None else previous.x,
                y=round(value / factor) if (value := window_value("y", None)) is not None else previous.y,
                maximized=False,
            )
            if screens:
                placement = self.fit_to_screens(placement, screens, factor)
        self.save(placement)
        return placement
