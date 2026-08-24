from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.release_manifest import create_manifest, write_release_files


class ReleaseManifestTests(unittest.TestCase):
    def test_beta_manifest_contains_verified_release_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / "Slide-Studio-Setup-0.4.0-beta.1.exe"
            portable = root / "Slide-Studio-Portable-0.4.0-beta.1.zip"
            installer.write_bytes(b"installer")
            portable.write_bytes(b"portable")
            manifest = create_manifest("0.4.0-beta.1", installer, portable, "owner/repo", "v0.4.0-beta.1")
            self.assertEqual(manifest["schemaVersion"], 1)
            self.assertEqual(manifest["channel"], "beta")
            self.assertEqual(manifest["installer"]["size"], 9)
            self.assertTrue(manifest["installer"]["url"].endswith(installer.name))

            output = root / "release"
            write_release_files(manifest, installer, portable, output)
            self.assertEqual(json.loads((output / "latest.json").read_text(encoding="utf-8"))["version"], "0.4.0-beta.1")
            checksums = (output / "SHA256SUMS.txt").read_text(encoding="ascii")
            self.assertIn(installer.name, checksums)
            self.assertIn(portable.name, checksums)


if __name__ == "__main__":
    unittest.main()

