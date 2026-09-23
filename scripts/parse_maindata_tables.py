"""解析 maindata.bundle 内表格（Character_C / Skill_C 等）。

用法（项目根目录）：
    python scripts/parse_maindata_tables.py

格式说明：
- Unity bundle 首字节 0xe8 为 UnityCN 标记，去掉后 UnityPy 可解包（110 objects）。
- CharacterEdit.bytes：v2 表头，仅 8 列类型定义（面板字段 schema）。
- *_C.bytes：带 C 混淆；零值常存为 KEY=0x279BB3ED；非零整型可能 plain 或 value^KEY。
- Character_C：u32@0 = 2932 为文件头长度；61 字节流式记录含 hp_base/atk_base，
  满配 atk≈atk_base×442.8826；hp≈hp_base×44.422（部分角色需 LvUp/RankUp 倍率）。
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import UnityPy

from maindata_reader import build_panel_rows, parse_character_edit_schema

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).parent
BUNDLE = SCRIPTS / "game_dump" / "bundles" / "maindata.bundle"
NOE8 = SCRIPTS / "game_dump" / "bundles" / "maindata_noe8.bundle"
OUT_DIR = SCRIPTS / "game_dump" / "extracted"
RAW_DIR = OUT_DIR / "maindata_raw"

KEY = 0x279BB3ED

# CharacterEdit v2 列类型（8 列，与 TCharacterEditData 面板字段对应，待验证）
COL_TYPES = {
    1: "bool",
    2: "s8",
    3: "u8",
    5: "u16",
    6: "s32",
    8: "s64",
}


@dataclass
class TableInfo:
    name: str
    size: int
    header_u32: int
    note: str = ""


def strip_unitycn(raw: bytes) -> bytes:
    return raw[1:] if raw and raw[0] == 0xE8 else raw


def script_bytes(asset) -> bytes:
    raw = asset.m_Script
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw)
    if isinstance(raw, str):
        return raw.encode("utf-8", "surrogatepass")
    return b""


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
            assets[d.m_Name] = script_bytes(d)
        except Exception:
            continue
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name, blob in assets.items():
        (RAW_DIR / f"{name}.bin").write_bytes(blob)
    return assets


def read_c_int(raw: int) -> int:
    if raw == 0 or raw == KEY:
        return 0
    plain = raw ^ KEY
    # 启发式：解密后数量级合理则视为 C 编码
    if plain < 10_000_000 and raw > 1_000_000:
        return plain
    return raw


def parse_character_edit(blob: bytes) -> dict[str, Any]:
    if len(blob) < 6:
        return {"error": "too small", "hex": blob.hex()}
    version = struct.unpack_from("<I", blob, 0)[0]
    col_count = blob[4]
    types = list(blob[6:])
    return {
        "version": version,
        "col_count": col_count,
        "column_types": types,
        "column_type_names": [COL_TYPES.get(t, f"type{t}") for t in types],
    }


def scan_char_rows(blob: bytes) -> list[dict[str, Any]]:
    """按 data 区内 ID 锚点扫描，提取邻近 plain 字段。"""
    hdr = struct.unpack_from("<I", blob, 0)[0] if len(blob) >= 4 else 0
    data = blob[hdr:] if hdr < len(blob) else blob
    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    i = 0
    while i < len(data) - 3:
        cid = struct.unpack_from("<I", data, i)[0]
        if 10000 <= cid <= 20000 and cid not in seen:
            seen.add(cid)
            row: dict[str, Any] = {"id": cid, "offset": hdr + i}
            for rel, key in [
                (-12, "f_m12"),
                (-8, "f_m8"),
                (-4, "f_m4"),
                (4, "f_p4"),
                (8, "f_p8"),
                (12, "f_p12"),
                (16, "f_p16"),
                (20, "f_p20"),
                (24, "f_p24"),
                (28, "f_p28"),
                (32, "f_p32"),
                (64, "f_p64"),
                (68, "f_p68"),
                (72, "f_p72"),
            ]:
                pos = i + rel
                if 0 <= pos <= len(data) - 4:
                    raw = struct.unpack_from("<I", data, pos)[0]
                    row[key] = read_c_int(raw)
            rows.append(row)
        i += 1
    rows.sort(key=lambda r: r["id"])
    return rows


def enrich_with_tenka(rows: list[dict], known: dict[int, dict]) -> list[dict]:
    out = []
    for r in rows:
        cid = r["id"]
        ref = known.get(cid)
        item = dict(r)
        if ref:
            item["ref_name"] = ref.get("nameSc")
            item["ref_hp"] = ref["hp"]
            item["ref_atk"] = ref["atk"]
            item["ref_cd"] = ref["cd"]
        out.append(item)
    return out


def load_known_chars() -> dict[int, dict]:
    p = ROOT / "characters_parsed.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def main() -> int:
    if not BUNDLE.exists():
        print(f"缺少 {BUNDLE}")
        print("请先: python scripts/pull_game_bundles.py")
        return 1

    print("解包 maindata.bundle ...")
    assets = extract_bundle()
    print(f"TextAsset: {len(assets)}")

    known = load_known_chars()
    meta: dict[str, Any] = {
        "bundle": str(BUNDLE),
        "unitycn_strip_first_byte": True,
        "c_xor_key": hex(KEY),
        "tables": {},
    }

    for name in sorted(assets):
        blob = assets[name]
        meta["tables"][name] = TableInfo(
            name=name,
            size=len(blob),
            header_u32=struct.unpack_from("<I", blob, 0)[0] if len(blob) >= 4 else 0,
        ).__dict__

    char_edit = parse_character_edit_schema(assets.get("CharacterEdit", b""))
    char_rows = build_panel_rows(assets.get("Character_C", b""), known)
    matched_ref = sum(1 for r in char_rows if r.get("hp_panel_ref"))
    hp_ok = sum(1 for r in char_rows if r.get("parse_status") == "ok")
    atk_ok = sum(1 for r in char_rows if r.get("atk") is not None)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "character_edit_schema.json").write_text(
        json.dumps(char_edit, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "characters_maindata.json").write_text(
        json.dumps(
            {
                "source": "maindata.bundle / Character_C.bytes",
                "c_xor_key": hex(KEY),
                "character_edit_schema": char_edit,
                "parse_status": {
                    "hp_atk_panel": "partial_formula",
                    "detail": "atk=atk_base×442.8826；hp=hp_base×44.422（ok=双匹配，atk_ok=仅攻击）",
                    "indexed_characters": len(char_rows),
                    "with_tenka_ref": matched_ref,
                    "hp_parsed": hp_ok,
                    "atk_parsed": atk_ok,
                },
                "characters": char_rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (OUT_DIR / "maindata_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    matched = [r for r in char_rows if r["id"] in known]
    print(f"CharacterEdit schema: {char_edit}")
    print(f"Character_C indexed: {len(char_rows)} (TenkaAssist 对照 {matched_ref})")
    print(f"面板解析: HP 完整 {hp_ok} / ATK {atk_ok}")
    print(f"输出:")
    print(f"  {OUT_DIR / 'character_edit_schema.json'}")
    print(f"  {OUT_DIR / 'characters_maindata.json'}")
    print(f"  {OUT_DIR / 'maindata_meta.json'}")
    print(f"  {RAW_DIR}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
