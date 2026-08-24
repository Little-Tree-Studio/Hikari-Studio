import unittest

from backend import dpapi


class DpapiTests(unittest.TestCase):
    def test_round_trip_preserves_content(self) -> None:
        payload = '{"messages": [{"role": "tool", "content": "机密上下文"}], "value": 42}'.encode("utf-8")
        protected = dpapi.protect(payload)
        self.assertEqual(dpapi.unprotect(protected), payload)

    def test_plaintext_payloads_pass_through(self) -> None:
        legacy = b'{"id": "legacy"}'
        self.assertEqual(dpapi.unprotect(legacy), legacy)

    def test_protected_payload_does_not_leak_plaintext(self) -> None:
        payload = b'{"secret": "sk-0123456789abcdef"}'
        protected = dpapi.protect(payload)
        if protected is payload:
            self.skipTest("DPAPI is unavailable on this platform")
        self.assertTrue(protected.startswith(dpapi.MAGIC))
        self.assertNotIn(b"sk-0123456789abcdef", protected)


if __name__ == "__main__":
    unittest.main()
