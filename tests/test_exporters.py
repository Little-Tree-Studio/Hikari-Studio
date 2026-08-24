import tempfile
import unittest
import json
from pathlib import Path

from backend.exporters import build_web_game, export_renpy
from backend.project_store import default_project


class ExporterTests(unittest.TestCase):
    @staticmethod
    def runtime(root: Path) -> Path:
        runtime = root / "runtime"
        runtime.mkdir(exist_ok=True)
        (runtime / "player.js").write_text("/* engine-core shared runtime */", encoding="utf-8")
        (runtime / "player.css").write_text("/* runtime styles */", encoding="utf-8")
        (runtime / "runtime-contract.json").write_text(json.dumps({
            "schemaVersion": 1,
            "matrixVersion": "2026.08.25.1",
            "engineVersion": 3,
            "blockTypes": ["scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue", "branch", "setVariable", "modifyVariable", "condition", "jump", "call", "return"],
        }), encoding="utf-8")
        return runtime

    def test_renpy_export_contains_labels_and_dialogue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = export_renpy(default_project(), Path(directory))
            text = output.read_text(encoding="utf-8")
            self.assertIn("label start:", text)
            self.assertIn("你果然还是来了", text)

    def test_web_build_creates_playable_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            index = build_web_game(default_project(), root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            self.assertTrue(index.exists())
            self.assertTrue((root / "build" / "player.js").exists())
            self.assertIn("engine-core shared runtime", (root / "build" / "player.js").read_text(encoding="utf-8"))
            self.assertIn("SLIDE_PROJECT", (root / "build" / "project.js").read_text(encoding="utf-8"))
            contract = json.loads((root / "build" / "runtime-contract.json").read_text(encoding="utf-8"))
            self.assertEqual(contract["matrixVersion"], "2026.08.25.1")
            self.assertEqual(len(contract["blockTypes"]), 14)
            self.assertEqual(set(contract["bundles"]), {"player.js", "player.css", "project.js"})
            self.assertEqual(contract["bundles"]["player.js"]["bytes"], (root / "build" / "player.js").stat().st_size)
            self.assertTrue((root / "build" / "assets" / "lake.jpg").exists())
            self.assertFalse((root / "build" / "assets" / "mountain.jpg").exists())

    def test_web_build_includes_force_bundled_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            project = default_project()
            next(asset for asset in project["assets"] if asset["id"] == "mountain")["forceBundle"] = True
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            self.assertTrue((root / "build" / "assets" / "mountain.jpg").exists())

    def test_web_build_includes_title_screen_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            project = default_project()
            project["ui"] = {"theme": "slide-light", "dialogueStyle": "glass", "title": {"backgroundAssetId": "mountain", "logoAssetId": "mountain"}}
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            self.assertTrue((root / "build" / "assets" / "mountain.jpg").exists())
            self.assertIn('"backgroundAssetId": "mountain"', (root / "build" / "project.js").read_text(encoding="utf-8"))

    def test_web_build_preserves_runtime_ui_theme(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            project = default_project()
            project["ui"]["runtimeTheme"] = {
                "preset": "minimal",
                "dialogueFontSize": 17,
                "dialogueHeight": 13,
                "accentColor": "#8fd8c9",
            }
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            web_project = (root / "build" / "project.js").read_text(encoding="utf-8")
            self.assertIn('"preset": "minimal"', web_project)
            self.assertIn('"dialogueHeight": 13', web_project)
            self.assertIn('"accentColor": "#8fd8c9"', web_project)

    def test_web_build_bundles_runtime_theme_font(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            custom = root / "custom"
            builtin.mkdir()
            custom.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            (custom / "dialogue.woff2").write_bytes(b"font")
            project = default_project()
            project["assets"].append({"id": "font-dialogue", "kind": "font", "name": "对白字体", "path": "assets/files/dialogue.woff2"})
            project["ui"]["runtimeTheme"] = {"preset": "modern", "fontAssetId": "font-dialogue", "fontFamily": '"Slide Project Font", sans-serif'}
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, custom, self.runtime(root))
            self.assertTrue((root / "build" / "assets" / "dialogue.woff2").exists())
            self.assertIn('"fontAssetId": "font-dialogue"', (root / "build" / "project.js").read_text(encoding="utf-8"))

    def test_web_build_collects_multilayer_scene_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            project = default_project()
            project["scripts"]["lake-meeting"][0]["layers"] = [{"id": "mist", "name": "雾层", "assetId": "mountain", "opacity": 0.4, "layer": 1}]
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            self.assertTrue((root / "build" / "assets" / "mountain.jpg").exists())
            self.assertIn('"uri": "assets/mountain.jpg"', (root / "build" / "project.js").read_text(encoding="utf-8"))

    def test_web_build_collects_character_overlay_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            project = default_project()
            project["characters"][0]["overlays"] = [{"id": "coat", "name": "外套", "assetId": "mountain", "opacity": 1, "layer": 2}]
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            self.assertTrue((root / "build" / "assets" / "mountain.jpg").exists())
            self.assertIn("engine-core shared runtime", (root / "build" / "player.js").read_text(encoding="utf-8"))

    def test_web_build_collects_timeline_assets_and_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            project = default_project()
            project["timelines"]["lake-meeting"] = {
                "version": 1,
                "fragmentId": "lake-meeting",
                "duration": 8,
                "fps": 30,
                "groups": [{"id": "visuals", "name": "视觉轨道", "collapsed": True}],
                "markers": [{"id": "intro", "name": "开场", "time": 1}],
                "loopRegion": {"start": 1, "end": 3, "enabled": True},
                "tracks": [{"id": "scene", "name": "场景", "kind": "scene", "groupId": "visuals", "clips": [{"id": "clip", "name": "远景", "start": 0, "duration": 2, "assetId": "mountain", "keyframes": [{"id": "fade", "time": 0, "property": "opacity", "value": 0, "easing": "linear"}]}]}],
            }
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            web_project = (root / "build" / "project.js").read_text(encoding="utf-8")
            self.assertTrue((root / "build" / "assets" / "mountain.jpg").exists())
            self.assertIn('"loopRegion": {"start": 1, "end": 3, "enabled": true}', web_project)
            self.assertIn('"property": "opacity"', web_project)

    def test_web_build_collects_voice_by_asset_id_and_includes_audio_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            custom = root / "custom"
            builtin.mkdir()
            custom.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            (custom / "cv-001.ogg").write_bytes(b"voice")
            project = default_project()
            project["assets"].append({"id": "voice-001", "kind": "audio", "name": "cv-001", "path": "cv-001.ogg", "audioCategory": "voice"})
            dialogue = next(block for block in project["scripts"]["lake-meeting"] if block["type"] == "dialogue")
            dialogue["voice"] = "voice-001"
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, custom, self.runtime(root))
            self.assertTrue((root / "build" / "assets" / "cv-001.ogg").exists())
            web_project = (root / "build" / "project.js").read_text(encoding="utf-8")
            self.assertIn('"uri": "assets/cv-001.ogg"', web_project)

    def test_disabled_chapters_are_excluded_from_builds(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            project = default_project()
            project["chapters"][1]["disabled"] = True
            project["timelines"]["lake-meeting"] = {"version": 1, "fragmentId": "lake-meeting", "duration": 8, "fps": 30, "tracks": []}
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            web_project = (root / "build" / "project.js").read_text(encoding="utf-8")
            self.assertNotIn("lake-meeting", web_project)
            script = export_renpy(project, root / "renpy").read_text(encoding="utf-8")
            self.assertNotIn("label lake_meeting", script)

    def test_web_build_fails_when_shared_runtime_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            with self.assertRaises(FileNotFoundError):
                build_web_game(default_project(), root / "build", project_file, builtin, runtime_dist=root / "missing-runtime")

    def test_renpy_export_rejects_project_without_enabled_fragments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = default_project()
            for chapter in project["chapters"]:
                chapter["disabled"] = True
            with self.assertRaisesRegex(ValueError, "没有可导出的片段"):
                export_renpy(project, root / "renpy")
            empty_fragments = default_project()
            for chapter in empty_fragments["chapters"]:
                chapter["fragments"] = []
            with self.assertRaisesRegex(ValueError, "没有可导出的片段"):
                export_renpy(empty_fragments, root / "renpy")

    def test_web_build_excludes_production_memory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin = root / "builtin"
            builtin.mkdir()
            (builtin / "lake.jpg").write_bytes(b"lake")
            (builtin / "mountain.jpg").write_bytes(b"mountain")
            project = default_project()
            project["productionMemory"] = {"version": 1, "world": "SECRET_STORY_BIBLE", "characterRules": [], "styleRules": [], "facts": [], "restrictions": [], "updatedAt": ""}
            project_file = root / "game.slide.json"
            project_file.write_text("{}", encoding="utf-8")
            build_web_game(project, root / "build", project_file, builtin, runtime_dist=self.runtime(root))
            web_project = (root / "build" / "project.js").read_text(encoding="utf-8")
            self.assertNotIn("productionMemory", web_project)
            self.assertNotIn("SECRET_STORY_BIBLE", web_project)


if __name__ == "__main__":
    unittest.main()
