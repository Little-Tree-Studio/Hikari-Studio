import json
import logging
import unittest

from backend.logging_config import JsonFormatter


class StructuredLoggingTests(unittest.TestCase):
    def test_json_formatter_preserves_structured_performance_details(self) -> None:
        record = logging.LogRecord("backend.api", logging.INFO, __file__, 1, "Project reload complete", (), None)
        record.details = {"reloadId": "reload-test", "totalReloadMs": 1518.9}

        payload = json.loads(JsonFormatter().format(record))

        self.assertEqual(payload["message"], "Project reload complete")
        self.assertEqual(payload["details"]["reloadId"], "reload-test")
        self.assertEqual(payload["details"]["totalReloadMs"], 1518.9)


if __name__ == "__main__":
    unittest.main()
