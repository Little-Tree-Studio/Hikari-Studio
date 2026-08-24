import json
import tempfile
import unittest
from pathlib import Path

from backend.project_store import default_project
from backend.exporters import build_web_game
from backend.windows_builder import WindowsBuildPrerequisiteError, build_windows_game, find_dotnet_sdk


class WindowsBuilderTests(unittest.TestCase):
    def test_windows_build_packages_shared_runtime_and_launcher(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "assets"
            custom = root / "custom"
            runtime = root / "runtime"
            launcher_dist = root / "launcher-dist"
            for folder in (builtin, custom, runtime, launcher_dist):
                folder.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            (runtime / "player.js").write_text("engine-core runtime", encoding="utf-8")
            (runtime / "player.css").write_text("runtime css", encoding="utf-8")
            (runtime / "runtime-contract.json").write_text(json.dumps({
                "schemaVersion": 1,
                "matrixVersion": "2026.08.02.1",
                "engineVersion": 3,
                "blockTypes": ["scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue", "branch", "setVariable", "condition", "jump", "call", "return"],
            }), encoding="utf-8")
            cefsharp_dist = launcher_dist / "cefsharp"
            cefsharp_dist.mkdir()
            (cefsharp_dist / "Slide.GameLauncher.exe").write_bytes(b"launcher")
            (cefsharp_dist / "libcef.dll").write_bytes(b"cef")
            project = default_project("测试游戏")

            executable = build_windows_game(
                project,
                root / "output",
                root / "project.slide.json",
                builtin,
                custom,
                runtime,
                root,
                root / "launcher.csproj",
                launcher_dist,
            )

            self.assertEqual(executable.name, "测试游戏.exe")
            self.assertTrue(executable.is_file())
            self.assertTrue((root / "output" / "game" / "player.js").is_file())
            self.assertTrue((root / "output" / "game" / "runtime-contract.json").is_file())
            self.assertTrue((root / "output" / "libcef.dll").is_file())
            config = json.loads((root / "output" / "launcher.json").read_text(encoding="utf-8"))
            self.assertEqual(config["projectId"], project["meta"]["id"])
            self.assertEqual(config["width"], 1280)
            self.assertEqual(config["browserMode"], "cefsharp")

            build_web_game(project, root / "web-output", root / "project.slide.json", builtin, custom, runtime)
            for name in ("player.js", "player.css", "project.js", "runtime-contract.json"):
                self.assertEqual(
                    (root / "output" / "game" / name).read_bytes(),
                    (root / "web-output" / name).read_bytes(),
                    f"Windows and Web runtime artifact diverged: {name}",
                )

    def test_system_browser_build_excludes_cefsharp_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "assets"
            custom = root / "custom"
            runtime = root / "runtime"
            launcher_dist = root / "launcher-dist"
            for folder in (builtin, custom, runtime, launcher_dist / "system", launcher_dist / "cefsharp"):
                folder.mkdir(parents=True)
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            (runtime / "player.js").write_text("engine-core runtime", encoding="utf-8")
            (runtime / "player.css").write_text("runtime css", encoding="utf-8")
            (runtime / "runtime-contract.json").write_text(json.dumps({
                "schemaVersion": 1,
                "matrixVersion": "2026.08.02.1",
                "engineVersion": 3,
                "blockTypes": ["scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue", "branch", "setVariable", "condition", "jump", "call", "return"],
            }), encoding="utf-8")
            (launcher_dist / "system" / "Slide.GameLauncher.exe").write_bytes(b"small-launcher")
            (launcher_dist / "cefsharp" / "Slide.GameLauncher.exe").write_bytes(b"cef-launcher")
            (launcher_dist / "cefsharp" / "libcef.dll").write_bytes(b"large-cef-runtime")

            executable = build_windows_game(
                default_project("轻量游戏"), root / "output", root / "project.slide.json",
                builtin, custom, runtime, root, root / "launcher.csproj", launcher_dist,
                browser_mode="system",
            )

            self.assertTrue(executable.is_file())
            self.assertFalse((root / "output" / "libcef.dll").exists())
            config = json.loads((root / "output" / "launcher.json").read_text(encoding="utf-8"))
            self.assertEqual(config["browserMode"], "system")

    def test_missing_sdk_returns_actionable_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(WindowsBuildPrerequisiteError):
                find_dotnet_sdk(Path(directory), Path(directory) / "missing-dotnet.exe")


if __name__ == "__main__":
    unittest.main()
