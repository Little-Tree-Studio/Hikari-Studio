from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from backend.update_service import UpdateService, is_newer_version, normalize_manifest


def manifest(version: str, payload: bytes, channel: str = "beta") -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "version": version,
        "channel": channel,
        "publishedAt": "2026-07-30T00:00:00Z",
        "notes": "Beta stability update",
        "releaseUrl": f"https://github.com/example/releases/tag/v{version}",
        "installer": {
            "url": f"https://example.com/Hikari-Studio-Setup-{version}.exe",
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size": len(payload),
        },
    }


class UpdateServiceTests(unittest.TestCase):
    def test_semantic_version_comparison_handles_prereleases(self) -> None:
        self.assertTrue(is_newer_version("0.4.0-beta.1", "0.3.0"))
        self.assertTrue(is_newer_version("0.4.0", "0.4.0-beta.9"))
        self.assertTrue(is_newer_version("0.4.0-beta.10", "0.4.0-beta.2"))
        self.assertFalse(is_newer_version("0.4.0-beta.1", "0.4.0-beta.1"))

    def test_manifest_rejects_untrusted_installer_metadata(self) -> None:
        value = manifest("0.4.0-beta.2", b"installer")
        value["installer"] = {"url": "http://example.com/setup.exe", "sha256": "bad", "size": 9}
        with self.assertRaises(ValueError):
            normalize_manifest(value)

    def test_check_uses_24_hour_cache_and_discovers_beta_release_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            now = [1_000_000.0]
            payload = b"verified-installer"
            release_response = [{
                "draft": False,
                "prerelease": True,
                "assets": [{"name": "latest.json", "browser_download_url": "https://example.com/latest.json"}],
            }]
            calls: list[str] = []

            def fetch(url: str):
                calls.append(url)
                return release_response if url.endswith("/releases") else manifest("0.4.0-beta.2", payload)

            service = UpdateService(Path(directory), current_version="0.4.0-beta.1", release_api="https://api.example.com/releases", clock=lambda: now[0], json_fetcher=fetch)
            first = service.check(channel="beta")
            second = service.check(channel="beta")
            self.assertEqual(first["status"], "available")
            self.assertEqual(first["manifest"]["version"], "0.4.0-beta.2")
            self.assertEqual(second, first)
            self.assertEqual(len(calls), 2)

            now[0] += 24 * 60 * 60 + 1
            service.check(channel="beta")
            self.assertEqual(len(calls), 4)

    def test_download_verifies_hash_persists_metadata_and_launches_only_after_consent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            payload = b"signed-by-checksum"
            launched: list[Path] = []

            def download(_url: str, destination: Path, _size: int) -> None:
                destination.write_bytes(payload)

            service = UpdateService(
                Path(directory),
                current_version="0.4.0-beta.1",
                release_api="https://example.com/latest.json",
                json_fetcher=lambda _url: manifest("0.4.0-beta.2", payload),
                downloader=download,
                launcher=launched.append,
            )
            service.check(force=True)
            status = service.download()
            self.assertEqual(status["status"], "downloaded")
            self.assertEqual(status["download"]["version"], "0.4.0-beta.2")
            downloaded = service.list_downloaded()
            self.assertEqual(len(downloaded), 1)
            self.assertEqual(downloaded[0]["sha256"], hashlib.sha256(payload).hexdigest())
            self.assertTrue(Path(downloaded[0]["path"]).with_suffix(".exe.json").is_file())

            denied = service.install_downloaded(confirmed=False)
            self.assertFalse(denied["ok"])
            self.assertEqual(launched, [])
            accepted = service.install_downloaded(confirmed=True)
            self.assertTrue(accepted["ok"])
            self.assertEqual(launched, [Path(downloaded[0]["path"])])

    def test_corrupt_download_is_deleted_and_never_becomes_installable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            expected = b"expected"
            service = UpdateService(
                Path(directory),
                current_version="0.4.0-beta.1",
                release_api="https://example.com/latest.json",
                json_fetcher=lambda _url: manifest("0.4.0-beta.2", expected),
                downloader=lambda _url, destination, _size: destination.write_bytes(b"corrupt!"),
            )
            service.check(force=True)
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                service.download()
            self.assertEqual(service.list_downloaded(), [])
            self.assertFalse(any(Path(directory).rglob("*.partial")))

    def test_corrupt_cached_state_falls_back_to_idle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service = UpdateService(Path(directory))
            service.state_path.parent.mkdir(parents=True)
            service.state_path.write_text("not-json", encoding="utf-8")
            self.assertEqual(service.status()["status"], "idle")
            json.dumps(service.status())


if __name__ == "__main__":
    unittest.main()

