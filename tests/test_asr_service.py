import unittest
from unittest.mock import patch

from backend.asr_service import AsrService


class AsrServiceTests(unittest.TestCase):
    def test_missing_optional_runtime_returns_structured_error(self) -> None:
        service = AsrService()
        with patch.object(service, "_model_class", return_value=None):
            status = service.status()
            result = service.load()
        self.assertFalse(status["available"])
        self.assertIn("内嵌模型缺失", status["message"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "ASR_MODEL_MISSING")

    def test_transcription_requires_loaded_model(self) -> None:
        result = AsrService().transcribe([])
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "ASR_NOT_LOADED")


if __name__ == "__main__":
    unittest.main()
