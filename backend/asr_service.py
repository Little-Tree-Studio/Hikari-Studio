from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any


LOGGER = logging.getLogger(__name__)


class AsrService:
    """Optional local speech recognition backed by faster-whisper."""

    def __init__(self, model_name: str = "small") -> None:
        self.model_name = model_name
        self._model: Any = None
        self._loading = False
        self._lock = threading.Lock()

    @staticmethod
    def _model_class() -> Any | None:
        try:
            from faster_whisper import WhisperModel
            return WhisperModel
        except (ImportError, OSError):
            return None

    def status(self) -> dict[str, Any]:
        available = self._model_class() is not None
        if self._model is not None:
            message = "模型已就绪"
        elif self._loading:
            message = "正在加载模型"
        elif available:
            message = "模型尚未加载"
        else:
            message = "内嵌模型缺失，请运行 uv sync --extra asr 后重启 Studio"
        return {
            "available": available,
            "loaded": self._model is not None,
            "loading": self._loading,
            "model": self.model_name,
            "message": message,
        }

    def load(self) -> dict[str, Any]:
        model_class = self._model_class()
        if model_class is None:
            return {"ok": False, "error": {"code": "ASR_MODEL_MISSING", "message": self.status()["message"]}}
        with self._lock:
            if self._model is not None:
                return {"ok": True, "data": self.status()}
            self._loading = True
            try:
                self._model = model_class(self.model_name, device="auto", compute_type="int8")
            except Exception as error:
                LOGGER.exception("Failed to load ASR model")
                return {"ok": False, "error": {"code": "ASR_LOAD_FAILED", "message": str(error)}}
            finally:
                self._loading = False
        return {"ok": True, "data": self.status()}

    def transcribe(self, items: list[tuple[str, Path]], concurrency: int = 1) -> dict[str, Any]:
        if self._model is None:
            return {"ok": False, "error": {"code": "ASR_NOT_LOADED", "message": "请先加载语音识别模型"}}
        workers = max(1, min(8, int(concurrency)))

        def run(asset_id: str, path: Path) -> dict[str, Any]:
            try:
                segments, info = self._model.transcribe(str(path), vad_filter=True)
                text = "".join(segment.text for segment in segments).strip()
                return {"assetId": asset_id, "text": text, "duration": float(info.duration), "status": "success"}
            except Exception as error:
                LOGGER.exception("ASR failed for %s", path)
                return {"assetId": asset_id, "status": "failed", "error": str(error)}

        results: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="slide-asr") as executor:
            futures = [executor.submit(run, asset_id, path) for asset_id, path in items]
            for future in as_completed(futures):
                results.append(future.result())
        return {"ok": True, "data": results}
