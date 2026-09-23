"""按 CharacterEdit schema（含对齐）解析 Character_C 行，提取 HP/ATK 面板。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAR_C = ROOT / "scripts/game_dump/extracted/maindata_raw/Character_C.bin"
OUT = ROOT / "scripts/game_dump/extracted/characters_panel.json"

KEY = 0x279BB3ED
HDR_SIZE = 2932
ROW_COUNT = 2067
# CharacterEdit.bytes
TYPES = [5, 3, 6, 6, 2, 5, 1, 8]
NAMES = ["id_u16", "u8", "hp", "atk", "s8", "u16b", "bool", "s64"]


def align4(pos: int) -> int:
    return (pos + 3) & ~3


def read_c32(data: bytes, pos: int) -> tuple[int, int]:
    if pos + 4 > len(data):
        return 0, pos
    raw = struct.unpack_from("<I", data, pos)[0]
    if raw == KEY or raw == 0:
        return 0, pos + 4
    if data[pos] == 0xED or (raw & 0xFF) == 0xED:
        return raw ^ KEY, pos + 4
    return raw, pos + 4


def read_field(data: bytes, pos: int, t: int) -> tuple[int, int]:
    if t == 5:  # u16
        if pos + 2 > len(data):
            return 0, pos
        return struct.unpack_from("<H", data, pos)[0], pos + 2
    if t == 3:  # u8
        if pos >= len(data):
            return 0, pos
        return data[pos], pos + 1
    if t in (6, 7):  # s32
        pos = align4(pos)
        return read_c32(data, pos)
    if t == 2:  # s8
        if pos >= len(data):
            return 0, pos
        v = data[pos]
        if v > 127:
            v -= 256
        return v, pos + 1
    if t == 1:  # bool
        if pos >= len(data):
            return 0, pos
        return data[pos], pos + 1
    if t == 8:  # s64
        pos = align4(pos)
        if pos + 8 > len(data):
            return 0, pos
        return struct.unpack_from("<Q", data, pos)[0], pos + 8
    return 0, pos + 1


def parse_row(data: bytes) -> dict | None:
    pos = 0
    row: dict = {}
    for name, t in zip(NAMES, TYPES):
        v, pos = read_field(data, pos, t)
        row[name] = v
    return row


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def row_size_estimate() -> int:
    """扫描前几条记录推断行距。"""
    blob = CHAR_C.read_bytes()
    data = blob[HDR_SIZE:]
    sizes = []
    pos = 0
    for _ in range(5):
        start = pos
        _, pos = read_field(data, pos, 5)
        _, pos = read_field(data, pos, 3)
        pos = align4(pos)
        _, pos = read_field(data, pos, 6)
        _, pos = read_field(data, pos, 6)
        sizes.append(pos - start)
    return max(sizes) if sizes else 28


def main() -> int:
    if not CHAR_C.exists():
        print("缺少 Character_C.bin，请先 parse_maindata_tables.py")
        return 1

    blob = CHAR_C.read_bytes()
    data = blob[HDR_SIZE:]
    known = load_known()
    stride = row_size_estimate()
    print(f"estimated row stride: {stride}")

    chars: list[dict] = []
    hp_ok = atk_ok = id_ok = 0

    for ri in range(ROW_COUNT):
        off = ri * stride
        if off + stride > len(data):
            break
        row = parse_row(data[off : off + stride])
        if not row:
            continue
        cid = row["id_u16"]
        if cid < 10000 or cid > 20000:
            continue
        ref = known.get(cid)
        item = {
            "id": cid,
            "hp": row["hp"],
            "atk": row["atk"],
            "raw": row,
        }
        if ref:
            item["nameSc"] = ref.get("nameSc")
            item["ref_hp"] = ref["hp"]
            item["ref_atk"] = ref["atk"]
            if row["hp"] == ref["hp"]:
                hp_ok += 1
            if row["atk"] == ref["atk"]:
                atk_ok += 1
        id_ok += 1
        chars.append(item)

    # 若 stride 不对，按 u16 id 搜索对齐
    if hp_ok < 5:
        print("fixed stride failed, scanning by id_u16...")
        chars = []
        hp_ok = atk_ok = 0
        pos = 0
        while pos < len(data) - 28:
            cid = struct.unpack_from("<H", data, pos)[0]
            if 10000 <= cid <= 20000:
                row = parse_row(data[pos : pos + 48])
                if row and row["id_u16"] == cid:
                    ref = known.get(cid)
                    item = {"id": cid, "hp": row["hp"], "atk": row["atk"], "offset": HDR_SIZE + pos}
                    if ref:
                        item["ref_hp"] = ref["hp"]
                        item["ref_atk"] = ref["atk"]
                        if row["hp"] == ref["hp"]:
                            hp_ok += 1
                        if row["atk"] == ref["atk"]:
                            atk_ok += 1
                    if not any(c["id"] == cid for c in chars):
                        chars.append(item)
            pos += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": "Character_C + CharacterEdit schema",
                "header_size": HDR_SIZE,
                "row_count_header": ROW_COUNT,
                "stride_tried": stride,
                "matched_hp": hp_ok,
                "matched_atk": atk_ok,
                "characters": sorted(chars, key=lambda x: x["id"]),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"parsed {len(chars)} chars, hp_match={hp_ok}, atk_match={atk_ok}")
    print(f"-> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
