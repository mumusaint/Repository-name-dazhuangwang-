"""解包 stringdata.bundle 并解析 CharacterStr / SimpleSkinStr 等表。

用法（项目根目录）：
    python scripts/extract_stringdata_tables.py

说明：
- bundle 首字节常为 0x55（UnityCN），去掉后 UnityPy 可解包。
- CharacterStr：u16 长度 + UTF-8 名 + XX 0x02 + 描述（简中/英文结构相同）。
- SimpleSkinStr：u32 条数 + u32 版本 + [u16 len, utf8, u32 id]…
"""
from __future__ import annotations

import json
import re
import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import UnityPy

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).parent
BUNDLE = SCRIPTS / "game_dump" / "bundles" / "stringdata.bundle"
NOE8 = SCRIPTS / "game_dump" / "bundles" / "stringdata_noe8.bundle"
OUT_DIR = SCRIPTS / "game_dump" / "extracted"
RAW_DIR = OUT_DIR / "stringdata_raw"

HDR = 6  # ed b3 ac 0d 00 00
NAME_EN_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 .'()-]{0,40}$")


def strip_unitycn(raw: bytes) -> bytes:
    if raw and raw[0] in (0x55, 0xE8):
        return raw[1:]
    return raw


def script_bytes(raw) -> bytes:
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw)
    return str(raw).encode("utf-8", "surrogatepass")


def extract_bundle() -> dict[str, bytes]:
    raw = BUNDLE.read_bytes()
    NOE8.write_bytes(strip_unitycn(raw))
    env = UnityPy.load(str(NOE8))
    assets: dict[str, bytes] = {}
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        try:
            d = obj.read()
            assets[d.m_Name] = script_bytes(d.m_Script)
        except Exception:
            continue
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name, blob in assets.items():
        (RAW_DIR / f"{name}.bin").write_bytes(blob)
    return assets


@dataclass
class NameEntry:
    name: str
    offset: int
    title: str | None = None
    lang: str = "sc"


def parse_u16_xx02_names(data: bytes, lang: str) -> list[NameEntry]:
    """解析 CharacterStr 中 u16 + 名称 + XX 0x02 记录。"""
    rows: list[NameEntry] = []
    pos = HDR if len(data) > HDR and data[0] == 0xED else 0
    while pos < len(data) - 8:
        ln = struct.unpack_from("<H", data, pos)[0]
        if not (2 <= ln <= 80 and pos + 2 + ln + 2 <= len(data)):
            pos += 1
            continue
        chunk = data[pos + 2 : pos + 2 + ln]
        try:
            name = chunk.decode("utf-8")
        except UnicodeDecodeError:
            pos += 1
            continue
        if lang == "en":
            if not NAME_EN_RE.match(name):
                pos += 1
                continue
        elif not any("\u4e00" <= c <= "\u9fff" for c in name):
            pos += 1
            continue
        if data[pos + 2 + ln + 1] != 0x02:
            pos += 1
            continue
        if "\n" in name or (lang == "sc" and len(name) > 40):
            pos += 1
            continue

        parts = name.split("\u3000")
        short = parts[-1].strip() if parts else name
        title = parts[0].strip() if len(parts) > 1 else None
        rows.append(NameEntry(name=short, title=title, offset=pos, lang=lang))

        desc_start = pos + 2 + ln + 2
        desc_end = len(data)
        for j in range(desc_start + 4, len(data) - 6):
            if data[j] == 0xED and data[j + 1] == 0xB3 and data[j + 3] == 0x27:
                desc_end = j
                break
            ln2 = struct.unpack_from("<H", data, j)[0]
            if not (2 <= ln2 <= 80 and j + 2 + ln2 + 2 <= len(data)):
                continue
            try:
                n2 = data[j + 2 : j + 2 + ln2].decode("utf-8")
            except UnicodeDecodeError:
                continue
            if lang == "en" and NAME_EN_RE.match(n2) and data[j + 2 + ln2 + 1] == 0x02:
                desc_end = j
                break
            if lang == "sc" and any("\u4e00" <= c <= "\u9fff" for c in n2):
                if data[j + 2 + ln2 + 1] == 0x02 and "\n" not in n2 and len(n2) <= 40:
                    desc_end = j
                    break
        pos = desc_end
    return rows


def parse_simple_skin(blob: bytes) -> list[dict[str, Any]]:
    if len(blob) < 8:
        return []
    count = struct.unpack_from("<I", blob, 0)[0]
    version = struct.unpack_from("<I", blob, 4)[0]
    if count > 500 or version > 10:
        return []
    pos = 8
    rows: list[dict[str, Any]] = []
    for _ in range(count):
        if pos + 6 > len(blob):
            break
        ln = struct.unpack_from("<H", blob, pos)[0]
        pos += 2
        if ln <= 0 or pos + ln + 4 > len(blob):
            break
        try:
            label = blob[pos : pos + ln].decode("utf-8")
        except UnicodeDecodeError:
            break
        pos += ln
        skin_id = struct.unpack_from("<I", blob, pos)[0]
        pos += 4
        rows.append({"id": skin_id, "label": label})
    return rows


def load_known_chars() -> tuple[dict[int, dict], dict[str, int], dict[str, int]]:
    p = ROOT / "characters_parsed.json"
    if not p.exists():
        return {}, {}, {}
    data = json.loads(p.read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in data["data"] if c.get("ok")}
    by_sc = {c["nameSc"]: c["id"] for c in by_id.values() if c.get("nameSc")}
    by_en = {c["nameEn"]: c["id"] for c in by_id.values() if c.get("nameEn")}
    return by_id, by_sc, by_en


def merge_character_names(
    sc_rows: list[NameEntry],
    en_rows: list[NameEntry],
    tc_rows: list[NameEntry],
    by_id: dict[int, dict],
    by_sc: dict[str, int],
    by_en: dict[str, int],
) -> dict[str, Any]:
    by_id_out: dict[str, dict[str, Any]] = {}

    def attach(cid: int, patch: dict[str, Any]) -> None:
        key = str(cid)
        row = by_id_out.setdefault(
            key,
            {
                "id": cid,
                "nameSc": by_id.get(cid, {}).get("nameSc"),
                "nameEn": by_id.get(cid, {}).get("nameEn"),
                "titles": [],
                "sources": [],
            },
        )
        for k, v in patch.items():
            if k in ("titles", "sources"):
                continue
            if v and (row.get(k) is None or k.startswith("game_")):
                row[k] = v
        if patch.get("title") and patch["title"] not in row["titles"]:
            row["titles"].append(patch["title"])
        src = patch.get("source")
        if src and src not in row["sources"]:
            row["sources"].append(src)

    skin_titles: list[dict[str, Any]] = []
    for entry in sc_rows:
        cid = by_sc.get(entry.name)
        item = {
            "nameSc": entry.name,
            "titleSc": entry.title,
            "fullSc": f"{entry.title}\u3000{entry.name}" if entry.title else entry.name,
            "offset": entry.offset,
            "char_id": cid,
        }
        skin_titles.append(item)
        if cid:
            attach(
                cid,
                {
                    "game_nameSc": entry.name,
                    "title": entry.title,
                    "source": "CharacterStr_sc",
                },
            )

    en_entries: list[dict[str, Any]] = []
    for entry in en_rows:
        cid = by_en.get(entry.name)
        item = {"nameEn": entry.name, "offset": entry.offset, "char_id": cid}
        en_entries.append(item)
        if cid:
            attach(cid, {"game_nameEn": entry.name, "source": "CharacterStr_en"})

    tc_map: dict[int, str] = {}
    for entry in tc_rows:
        cid = by_sc.get(entry.name)  # 繁中短名常与简中相同或相近，先用简中索引
        if cid:
            tc_map[cid] = entry.name

    for cid, name_tc in tc_map.items():
        attach(cid, {"nameTc": name_tc, "source": "CharacterStr_tc"})

    new_entries = []
    for item in skin_titles:
        if item["char_id"] is None:
            new_entries.append(item)

    return {
        "by_id": by_id_out,
        "skin_titles_sc": skin_titles,
        "en_entries": en_entries,
        "unmapped_sc_titles": new_entries,
    }


def main() -> int:
    if not BUNDLE.is_file():
        print(f"缺少 {BUNDLE}")
        print("请先: python scripts/pull_game_bundles.py")
        return 1

    print("解包 stringdata.bundle ...")
    assets = extract_bundle()
    print(f"TextAsset: {len(assets)}")

    by_id, by_sc, by_en = load_known_chars()
    sc_rows = parse_u16_xx02_names(assets.get("CharacterStr_sc", b""), "sc")
    en_rows = parse_u16_xx02_names(assets.get("CharacterStr_en", b""), "en")
    tc_rows = parse_u16_xx02_names(assets.get("CharacterStr_tc", b""), "sc")
    merged = merge_character_names(sc_rows, en_rows, tc_rows, by_id, by_sc, by_en)

    simple_skin: dict[str, list] = {}
    for lang in ("sc", "tc", "en", "jp", "kr"):
        key = f"SimpleSkinStr_{lang}"
        if key in assets:
            simple_skin[lang] = parse_simple_skin(assets[key])

    meta = {
        "bundle": str(BUNDLE),
        "strip_prefix": "0x55/0xE8 first byte",
        "text_asset_count": len(assets),
        "tables": {name: {"size": len(blob)} for name, blob in sorted(assets.items())},
        "character_str": sorted(n for n in assets if n.startswith("CharacterStr_")),
        "skill_str": sorted(n for n in assets if n.startswith("SkillStr_")),
        "parsed": {
            "CharacterStr_sc_u16_records": len(sc_rows),
            "CharacterStr_en_u16_records": len(en_rows),
            "CharacterStr_tc_u16_records": len(tc_rows),
            "mapped_char_ids": len(merged["by_id"]),
            "unmapped_sc_titles": len(merged["unmapped_sc_titles"]),
        },
    }

    names_payload = {
        "source": "stringdata.bundle / CharacterStr_*.bytes",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "game_nameSc/En 来自 u16+XX02 记录；与 TenkaAssist 不一致时以游戏字符串为准",
        "summary": meta["parsed"],
        "by_id": merged["by_id"],
        "skin_titles_sc": merged["skin_titles_sc"],
        "en_entries": merged["en_entries"],
        "unmapped_sc_titles": merged["unmapped_sc_titles"],
        "simple_skin": simple_skin,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "stringdata_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "character_names_from_game.json").write_text(
        json.dumps(names_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"CharacterStr SC/EN/TC 记录: {len(sc_rows)} / {len(en_rows)} / {len(tc_rows)}")
    print(f"已映射角色 ID: {len(merged['by_id'])}")
    print(f"未映射简中称号: {len(merged['unmapped_sc_titles'])}")
    print(f"输出:")
    print(f"  {OUT_DIR / 'stringdata_meta.json'}")
    print(f"  {OUT_DIR / 'character_names_from_game.json'}")
    print(f"  {RAW_DIR}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
