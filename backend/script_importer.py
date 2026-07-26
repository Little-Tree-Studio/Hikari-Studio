from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .project_store import new_id


SUPPORTED_BLOCK_TYPES = {"scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue", "branch", "setVariable", "condition", "jump", "call", "return"}
DIALOGUE_PATTERN = re.compile(r"^([^：:]{1,30})[：:]\s*(.+)$")
SCENE_PATTERN = re.compile(r"^\[?(?:场景|scene)\s*[：:]\s*(.+?)\]?$", re.IGNORECASE)


def _text_blocks(text: str, markdown: bool) -> tuple[list[dict[str, Any]], list[str]]:
    blocks: list[dict[str, Any]] = []
    warnings: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or (markdown and line in {"---", "***"}):
            continue
        scene = SCENE_PATTERN.match(line)
        if scene:
            blocks.append({"id": new_id("block"), "type": "scene", "title": scene.group(1), "transition": "dissolve", "duration": 1})
            continue
        if markdown and line.startswith("#"):
            heading = line.lstrip("#").strip()
            if heading:
                blocks.append({"id": new_id("block"), "type": "narration", "text": heading})
            continue
        cleaned = line.lstrip("> ") if markdown else line
        dialogue = DIALOGUE_PATTERN.match(cleaned)
        if dialogue:
            blocks.append({"id": new_id("block"), "type": "dialogue", "speaker": dialogue.group(1).strip(), "text": dialogue.group(2).strip(), "expression": "默认"})
        else:
            blocks.append({"id": new_id("block"), "type": "narration", "text": cleaned})
    if not blocks:
        warnings.append("文件中没有可导入的内容")
    return blocks, warnings


def _json_blocks(payload: Any) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    source = payload
    if isinstance(payload, dict) and isinstance(payload.get("scripts"), dict):
        fragment_id = payload.get("activeFragmentId")
        source = payload["scripts"].get(fragment_id, [])
        warnings.append(f"已读取活动片段 {fragment_id}")
    elif isinstance(payload, dict) and isinstance(payload.get("blocks"), list):
        source = payload["blocks"]
    if not isinstance(source, list):
        raise ValueError("Hikari JSON 必须是 Block 数组、含 blocks 的对象或完整项目")
    blocks = []
    for index, item in enumerate(source):
        if not isinstance(item, dict) or item.get("type") not in SUPPORTED_BLOCK_TYPES:
            warnings.append(f"第 {index + 1} 项不是支持的 Block，已跳过")
            continue
        block = dict(item)
        block["id"] = new_id("block")
        blocks.append(block)
    return blocks, warnings


def preview_script_import(path: Path) -> dict[str, Any]:
    source = path.expanduser().resolve()
    if not source.is_file():
        raise ValueError("剧本文件不存在")
    extension = source.suffix.lower()
    if extension not in {".txt", ".md", ".markdown", ".json"}:
        raise ValueError("仅支持 TXT、Markdown 和 Hikari JSON")
    text = source.read_text(encoding="utf-8-sig")
    if extension == ".json":
        blocks, warnings = _json_blocks(json.loads(text))
        format_name = "Hikari JSON"
    else:
        blocks, warnings = _text_blocks(text, extension in {".md", ".markdown"})
        format_name = "Markdown" if extension in {".md", ".markdown"} else "TXT"
    return {"sourceName": source.name, "format": format_name, "blocks": blocks, "warnings": warnings}
