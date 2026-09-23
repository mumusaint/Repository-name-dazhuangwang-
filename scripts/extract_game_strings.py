"""从 stringdata.bundle 提取可读文本（角色名/技能描述等，无需 Unity 解密）"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "scripts" / "game_dump" / "bundles" / "stringdata.bundle"
OUT = ROOT / "scripts" / "game_dump" / "extracted" / "stringdata_strings.json"


def extract_utf8_strings(data: bytes, min_len: int = 2, max_len: int = 40) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    patterns = [
        re.compile(rb"[\x20-\x7e]{2,60}"),
        re.compile(rb"(?:[\xe4-\xe9][\x80-\xbf]{2}){" + str(min_len).encode() + rb"," + str(max_len).encode() + rb"}"),
    ]
    for pat in patterns:
        for m in pat.finditer(data):
            try:
                s = m.group().decode("utf-8")
            except UnicodeDecodeError:
                continue
            if s in seen or len(s) < min_len:
                continue
            seen.add(s)
            out.append(s)
    return out


def classify_string(s: str) -> str:
    if ";" in s or any(ord(c) < 32 for c in s):
        return "skip"
    cjk = sum(1 for c in s if "\u4e00" <= c <= "\u9fff")
    if cjk >= 2 and cjk >= len(s) * 0.6 and len(s) <= 12:
        return "name_like"
    if cjk >= 2:
        return "text_zh"
    if re.match(r"^[A-Za-z][A-Za-z0-9_ '\-\.]{1,40}$", s):
        return "name_en"
    return "other"


def main() -> int:
    if not BUNDLE.exists():
        print(f"缺少 {BUNDLE}")
        print("请先: python scripts/pull_game_bundles.py")
        return 1

    data = BUNDLE.read_bytes()
    strings = extract_utf8_strings(data)
    grouped: dict[str, list[str]] = {
        "name_like": [],
        "name_en": [],
        "text_zh": [],
        "other": [],
    }
    for s in strings:
        cat = classify_string(s)
        if cat == "skip":
            continue
        grouped[cat].append(s)

    payload = {
        "source": str(BUNDLE),
        "size_bytes": len(data),
        "total_strings": len(strings),
        "note": "从 bundle 明文区提取；非完整 CharacterStr_sc 表结构，但含大量简中/英文名",
        "groups": {k: v[:500] if k == "text_zh" else v for k, v in grouped.items()},
        "group_counts": {k: len(v) for k, v in grouped.items()},
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"extracted {len(strings)} raw -> {sum(len(v) for v in grouped.values())} filtered")
    for k, v in grouped.items():
        print(f"  {k}: {len(v)}")
    print(f"-> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
