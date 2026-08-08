from __future__ import annotations

import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from .project_store import new_id


SUPPORTED_BLOCK_TYPES = {"scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue", "branch", "setVariable", "condition", "jump", "call", "return"}
SCENE_PATTERN = re.compile(r"^\[?(?:场景|scene)\s*[：:]\s*(.+?)\]?$", re.IGNORECASE)
HIKARI_BLOCK_PREFIX = "HIKARI_BLOCKS_V1\n"
MAX_SCRIPT_TEXT_BYTES = 4 * 1024 * 1024
DEFAULT_RULES: dict[str, Any] = {
    "dialogueSeparator": "auto",
    "expressionSyntax": "auto",
    "characterMatching": "smart",
    "unknownCharacter": "keep",
    "defaultExpression": "默认",
    "mergeNarrationLines": False,
}
RULE_OPTIONS = {
    "dialogueSeparator": {"auto", "colon", "tab"},
    "expressionSyntax": {"auto", "brackets", "parentheses", "pipe", "none"},
    "characterMatching": {"smart", "exact"},
    "unknownCharacter": {"keep", "narration"},
}


def normalize_script_import_rules(raw: dict[str, Any] | None = None) -> dict[str, Any]:
    rules = dict(DEFAULT_RULES)
    if isinstance(raw, dict):
        for key, allowed in RULE_OPTIONS.items():
            if raw.get(key) in allowed:
                rules[key] = raw[key]
        if isinstance(raw.get("defaultExpression"), str):
            rules["defaultExpression"] = raw["defaultExpression"].strip()[:40] or "默认"
        if isinstance(raw.get("mergeNarrationLines"), bool):
            rules["mergeNarrationLines"] = raw["mergeNarrationLines"]
    return rules


def _normalized_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\s_\-·.]+", "", normalized)


def _fuzzy_match(value: str, candidates: list[tuple[str, Any]], threshold: float) -> Any | None:
    key = _normalized_key(value)
    if len(key) < 2:
        return None
    scored = sorted(
        ((SequenceMatcher(None, key, _normalized_key(candidate)).ratio(), result) for candidate, result in candidates if candidate),
        key=lambda item: item[0],
        reverse=True,
    )
    if not scored or scored[0][0] < threshold:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.08:
        return None
    return scored[0][1]


def _character_aliases(character: dict[str, Any]) -> list[str]:
    aliases: list[str] = []
    for scheme in character.get("displayNameSchemes") or []:
        if isinstance(scheme, dict) and scheme.get("kind") == "fixed" and isinstance(scheme.get("value"), str):
            aliases.append(scheme["value"])
    return [alias for alias in aliases if alias.strip()]


def _match_character(raw_speaker: str, characters: list[dict[str, Any]], mode: str) -> tuple[dict[str, Any] | None, str]:
    for character in characters:
        if raw_speaker == str(character.get("name", "")):
            return character, "exact"
    for character in characters:
        if raw_speaker in _character_aliases(character):
            return character, "alias"
    if mode == "exact":
        return None, "unmatched"
    key = _normalized_key(raw_speaker)
    for character in characters:
        if key == _normalized_key(str(character.get("name", ""))):
            return character, "smart"
        if any(key == _normalized_key(alias) for alias in _character_aliases(character)):
            return character, "alias"
    candidates: list[tuple[str, dict[str, Any]]] = []
    for character in characters:
        candidates.append((str(character.get("name", "")), character))
        candidates.extend((alias, character) for alias in _character_aliases(character))
    matched = _fuzzy_match(raw_speaker, candidates, 0.84)
    return (matched, "smart") if matched else (None, "unmatched")


def _match_expression(raw_expression: str | None, character: dict[str, Any] | None, rules: dict[str, Any]) -> tuple[str, str]:
    requested = (raw_expression or "").strip()
    expressions = [str(item) for item in (character or {}).get("expressions", []) if str(item).strip()]
    fallback = str(rules["defaultExpression"])
    if expressions:
        fallback = next((item for item in expressions if item == fallback), expressions[0])
    if not requested:
        return fallback, "default"
    if not expressions:
        return requested, "unverified"
    if requested in expressions:
        return requested, "exact"
    if rules["characterMatching"] == "smart":
        key = _normalized_key(requested)
        normalized = next((item for item in expressions if _normalized_key(item) == key), None)
        if normalized:
            return normalized, "smart"
        fuzzy = _fuzzy_match(requested, [(item, item) for item in expressions], 0.8)
        if fuzzy:
            return str(fuzzy), "smart"
    return fallback, "fallback"


def _split_dialogue(line: str, separator: str) -> tuple[str, str] | None:
    if separator in {"auto", "tab"} and "\t" in line:
        speaker, body = line.split("\t", 1)
        if speaker.strip() and body.strip():
            return speaker.strip(), body.strip()
    if separator in {"auto", "colon"}:
        match = re.match(r"^([^：:]{1,60})[：:]\s*(.+)$", line)
        if match:
            return match.group(1).strip(), match.group(2).strip()
    return None


def _extract_expression(speaker: str, body: str, syntax: str) -> tuple[str, str | None, str]:
    checks: list[tuple[str, re.Pattern[str]]] = []
    if syntax in {"auto", "brackets"}:
        checks.append(("brackets", re.compile(r"^(.*?)\s*[\[【]([^\]】]+)[\]】]\s*$")))
    if syntax in {"auto", "parentheses"}:
        checks.append(("parentheses", re.compile(r"^(.*?)\s*[（(]([^）)]+)[）)]\s*$")))
    if syntax in {"auto", "pipe"}:
        checks.append(("pipe", re.compile(r"^(.*?)\s*[|｜]\s*([^|｜]+)\s*$")))
    for style, pattern in checks:
        match = pattern.match(speaker)
        if match and match.group(1).strip():
            return match.group(1).strip(), match.group(2).strip(), style
    body_checks: list[tuple[str, re.Pattern[str]]] = []
    if syntax in {"auto", "brackets"}:
        body_checks.append(("brackets", re.compile(r"^[\[【]([^\]】]+)[\]】]\s*(.+)$")))
    if syntax in {"auto", "parentheses"}:
        body_checks.append(("parentheses", re.compile(r"^[（(]([^）)]+)[）)]\s*(.+)$")))
    for style, pattern in body_checks:
        match = pattern.match(body)
        if match:
            return speaker, match.group(1).strip(), style
    return speaker, None, "none"


def _append_narration(blocks: list[dict[str, Any]], text: str, merge: bool) -> dict[str, Any]:
    if merge and blocks and blocks[-1].get("type") == "narration":
        blocks[-1]["text"] = f"{blocks[-1].get('text', '')}\n{text}"
        return blocks[-1]
    block = {"id": new_id("block"), "type": "narration", "text": text}
    blocks.append(block)
    return block


def _text_blocks(
    text: str,
    markdown: bool,
    characters: list[dict[str, Any]] | None = None,
    raw_rules: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[str], list[dict[str, Any]], dict[str, Any]]:
    characters = [item for item in (characters or []) if isinstance(item, dict)]
    rules = normalize_script_import_rules(raw_rules)
    blocks: list[dict[str, Any]] = []
    warnings: list[str] = []
    matches: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(text.splitlines(), 1):
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
                _append_narration(blocks, heading, bool(rules["mergeNarrationLines"]))
            continue
        cleaned = line.lstrip("> ") if markdown else line
        dialogue = _split_dialogue(cleaned, str(rules["dialogueSeparator"]))
        if not dialogue:
            _append_narration(blocks, cleaned, bool(rules["mergeNarrationLines"]))
            continue
        raw_speaker, body = dialogue
        raw_speaker, raw_expression, expression_syntax = _extract_expression(raw_speaker, body, str(rules["expressionSyntax"]))
        if raw_expression and body.startswith((f"[{raw_expression}]", f"【{raw_expression}】", f"({raw_expression})", f"（{raw_expression}）")):
            body = re.sub(r"^[\[【（(][^\]】）)]+[\]】）)]\s*", "", body)
        character, character_status = _match_character(raw_speaker, characters, str(rules["characterMatching"]))
        if not character and rules["unknownCharacter"] == "narration":
            _append_narration(blocks, cleaned, bool(rules["mergeNarrationLines"]))
            warnings.append(f"第 {line_number} 行角色“{raw_speaker}”未匹配，已作为旁白导入")
            continue
        speaker = str(character.get("name")) if character else raw_speaker
        expression, expression_status = _match_expression(raw_expression, character, rules)
        block = {"id": new_id("block"), "type": "dialogue", "speaker": speaker, "text": body, "expression": expression}
        blocks.append(block)
        match_info = {
            "blockId": block["id"],
            "line": line_number,
            "rawSpeaker": raw_speaker,
            "rawExpression": raw_expression,
            "characterId": character.get("id") if character else None,
            "characterName": character.get("name") if character else None,
            "characterStatus": character_status,
            "expression": expression,
            "expressionStatus": expression_status,
            "expressionSyntax": expression_syntax,
        }
        matches.append(match_info)
        if not character:
            warnings.append(f"第 {line_number} 行角色“{raw_speaker}”未匹配，保留原名称")
        if raw_expression and expression_status == "fallback":
            warnings.append(f"第 {line_number} 行表情“{raw_expression}”不存在，已回退为“{expression}”")
    if not blocks:
        warnings.append("文件中没有可导入的内容")
    warnings = list(dict.fromkeys(warnings))
    return blocks, warnings, matches, rules


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


def _preview(source_name: str, format_name: str, blocks: list[dict[str, Any]], warnings: list[str], matches: list[dict[str, Any]], rules: dict[str, Any]) -> dict[str, Any]:
    return {"sourceName": source_name, "format": format_name, "blocks": blocks, "warnings": warnings, "matches": matches, "rules": rules}


def preview_script_text(
    text: str,
    source_name: str = "系统剪贴板",
    characters: list[dict[str, Any]] | None = None,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(text, str):
        raise ValueError("粘贴内容必须是文本")
    text = text.replace("\x00", "")
    if len(text.encode("utf-8")) > MAX_SCRIPT_TEXT_BYTES:
        raise ValueError("粘贴文本超过 4 MB 限制")
    normalized_rules = normalize_script_import_rules(rules)
    stripped = text.strip()
    if not stripped:
        return _preview(source_name, "TXT", [], ["剪贴板中没有文本"], [], normalized_rules)

    if stripped.startswith(HIKARI_BLOCK_PREFIX.strip()):
        payload_text = stripped[len(HIKARI_BLOCK_PREFIX.strip()):].lstrip("\r\n")
        blocks, warnings = _json_blocks(json.loads(payload_text))
        return _preview(source_name, "Hikari JSON", blocks, warnings, [], normalized_rules)

    if stripped[0] in "[{":
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            payload = None
        if payload is not None:
            blocks, warnings = _json_blocks(payload)
            return _preview(source_name, "Hikari JSON", blocks, warnings, [], normalized_rules)

    markdown = bool(re.search(r"(?m)^\s*(?:#{1,6}\s|>\s|---\s*$|\*\*\*)", text))
    blocks, warnings, matches, normalized_rules = _text_blocks(text, markdown, characters, normalized_rules)
    return _preview(source_name, "Markdown" if markdown else "TXT", blocks, warnings, matches, normalized_rules)


def preview_script_import(
    path: Path,
    characters: list[dict[str, Any]] | None = None,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = path.expanduser().resolve()
    if not source.is_file():
        raise ValueError("剧本文件不存在")
    extension = source.suffix.lower()
    if extension not in {".txt", ".md", ".markdown", ".json"}:
        raise ValueError("仅支持 TXT、Markdown 和 Hikari JSON")
    text = source.read_text(encoding="utf-8-sig")
    if extension == ".json":
        blocks, warnings = _json_blocks(json.loads(text))
        return _preview(source.name, "Hikari JSON", blocks, warnings, [], normalize_script_import_rules(rules))
    markdown = extension in {".md", ".markdown"}
    blocks, warnings, matches, normalized_rules = _text_blocks(text, markdown, characters, rules)
    return _preview(source.name, "Markdown" if markdown else "TXT", blocks, warnings, matches, normalized_rules)
