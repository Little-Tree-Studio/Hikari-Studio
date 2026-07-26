import json
import tempfile
import unittest
from pathlib import Path

from backend.project_store import default_project
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
            (launcher_dist / "Hikari.GameLauncher.exe").write_bytes(b"launcher")
            (launcher_dist / "Microsoft.Web.WebView2.Core.dll").write_bytes(b"webview")
            project = default_project("测试游戏")

            executable = build_windows_game(
                project,
                root / "output",
                root / "project.hikari.json",
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
            self.assertTrue((root / "output" / "Microsoft.Web.WebView2.Core.dll").is_file())
            config = json.loads((root / "output" / "launcher.json").read_text(encoding="utf-8"))
            self.assertEqual(config["projectId"], project["meta"]["id"])
            self.assertEqual(config["width"], 1280)

    def test_missing_sdk_returns_actionable_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(WindowsBuildPrerequisiteError):
                find_dotnet_sdk(Path(directory), Path(directory) / "missing-dotnet.exe")


if __name__ == "__main__":
    unittest.main()
