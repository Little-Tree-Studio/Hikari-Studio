import tempfile
import unittest
from pathlib import Path

from backend.build_preflight import BuildPreflightError, collect_build_preflight, enforce_build_preflight
from backend.api import DesktopApi
from backend.project_store import ProjectStore
from backend.project_store import blank_project


class BuildPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.builtin = self.root / "builtin"
        self.custom = self.root / "custom"
        self.builtin.mkdir()
        self.custom.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_missing_asset_file_blocks_build(self) -> None:
        project = blank_project("Missing")
        project["assets"] = [{"id": "background", "kind": "scene", "name": "Background", "path": "missing.png"}]
        project["scripts"]["opening"] = [{"id": "scene", "type": "scene", "assetId": "background"}, {"id": "line", "type": "narration", "text": "Hello"}]

        report = collect_build_preflight(project, "web", self.builtin, self.custom)

        self.assertTrue(report["blocked"])
        self.assertIn("ASSET_FILE_MISSING", {issue["code"] for issue in report["issues"]})
        with self.assertRaises(BuildPreflightError):
            enforce_build_preflight(project, "web", self.builtin, self.custom)

    def test_invalid_target_and_deterministic_cycle_block_both_targets(self) -> None:
        invalid = blank_project("Invalid")
        invalid["scripts"]["opening"] = [{"id": "jump", "type": "jump", "target": "missing"}]
        self.assertIn("INVALID_TARGET", {issue["code"] for issue in collect_build_preflight(invalid, "web", self.builtin, self.custom)["issues"]})

        loop = blank_project("Loop")
        loop["chapters"][0]["fragments"].append({"id": "loop", "name": "Loop"})
        loop["scripts"] = {
            "opening": [{"id": "to-loop", "type": "jump", "target": "loop"}],
            "loop": [{"id": "to-opening", "type": "jump", "target": "opening"}],
        }
        for target in ("web", "windows"):
            report = collect_build_preflight(loop, target, self.builtin, self.custom)
            self.assertTrue(report["blocked"])
            self.assertIn("DETERMINISTIC_LOOP", {issue["code"] for issue in report["issues"]})

    def test_unreachable_and_frontend_compatibility_are_merged_as_warnings(self) -> None:
        project = blank_project("Warnings")
        project["chapters"][0]["fragments"].append({"id": "unused", "name": "Unused"})
        project["scripts"]["opening"] = [{"id": "line", "type": "narration", "text": "Hello"}]
        project["scripts"]["unused"] = [{"id": "unused-line", "type": "narration", "text": "Unused"}]
        frontend = {
            "target": "web",
            "projectId": project["meta"]["id"],
            "generatedAt": "2026-07-31T00:00:00Z",
            "issues": [{"severity": "warning", "blocking": False, "category": "compatibility", "code": "FORMAT_WARNING", "message": "Compatibility warning", "source": "engine"}],
            "stats": {"simulatedPaths": 2},
            "simulation": {"completed": True, "truncated": False, "loops": 0, "runtimeErrors": 0, "coveragePercent": 50},
        }

        report = collect_build_preflight(project, "web", self.builtin, self.custom, frontend)

        self.assertFalse(report["blocked"])
        self.assertEqual(report["stats"]["simulatedPaths"], 2)
        self.assertIn("UNREACHABLE_FRAGMENT", {issue["code"] for issue in report["issues"]})
        self.assertIn("FORMAT_WARNING", {issue["code"] for issue in report["issues"]})

    def test_desktop_api_returns_structured_blocking_report(self) -> None:
        store = ProjectStore(self.root / "project")
        api = DesktopApi(store, self.root)
        project = blank_project("Blocked API build")
        project["scripts"]["opening"] = [{"id": "jump", "type": "jump", "target": "missing"}]

        report = api.preflight_build(project, "web", None)
        result = api.build_web(project, report)

        self.assertTrue(report["blocked"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "BUILD_PREFLIGHT_FAILED")
        self.assertEqual(result["preflight"]["projectId"], project["meta"]["id"])
        api.stop_background_services()


if __name__ == "__main__":
    unittest.main()
