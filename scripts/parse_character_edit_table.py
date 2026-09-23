"""解析 Character_C 内 CharacterEdit 面板表（offset 140023, stride 61）。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOB = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw" / "Character_C.bin"
OUT = Path(__file__).parent / "game_dump" / "extracted" / "characters_from_maindata.json"

KEY = 0x279BB3ED
TABLE_START = 140023
STRIDE = 61
ROW_COUNT = 634
# CharacterEdit.bytes schema
TYPES = [5, 3, 6, 6, 2, 5, 1, 8]
TYPE_W = {1: 1, 2: 1, 3: 1, 5: 2, 6: 4, 7: 4, 8: 8}
FIELD_NAMES = ["col_u16", "col_u8", "hp", "atk", "col_s8", "col_u16b", "col_bool", "col_s64"]


def read_c32(raw: int) -> int:
    if raw in (0, KEY):
        return 0
    if (raw & 0xFF) == 0xED or ((raw >> 8) & 0xFF) in (0xB2, 0xB3):
        return raw ^ KEY
    return raw


def read_field(data: bytes, pos: int, t: int) -> tuple[int | None, int]:
    w = TYPE_W.get(t, 0)
    if w == 0 or pos + w > len(data):
        return None, pos
    if w == 1:
        return data[pos], pos + w
    if w == 2:
        return struct.unpack_from("<H", data, pos)[0], pos + w
    if w == 4:
        raw = struct.unpack_from("<I", data, pos)[0]
        return read_c32(raw), pos + w
    return struct.unpack_from("<Q", data, pos)[0], pos + w


def parse_row_by_schema(rec: bytes) -> list[int] | None:
    pos = 0
    fields: list[int] = []
    for t in TYPES:
        v, pos = read_field(rec, pos, t)
        if v is None:
            return None
        fields.append(int(v))
    return fields


def parse_row_by_id_prefix(rec: bytes) -> dict | None:
    """行首 u32 为 ID，后续按 schema 解析。"""
    if len(rec) < 4:
        return None
    cid = struct.unpack_from("<I", rec, 0)[0]
    tail = rec[4:]
    fields = parse_row_by_schema(tail)
    if fields is None:
        return None
    return {"id": cid, **dict(zip(FIELD_NAMES, fields))}


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def main() -> int:
    blob = BLOB.read_bytes()
    known = load_known()
    rows: list[dict] = []

    for ri in range(ROW_COUNT):
        off = TABLE_START + ri * STRIDE
        if off + STRIDE > len(blob):
            break
        rec = blob[off : off + STRIDE]
        row = parse_row_by_id_prefix(rec)
        if row:
            rows.append(row)

    hp_match = atk_match = 0
    matched: list[dict] = []
    for row in rows:
        cid = row["id"]
        if 10000 <= cid <= 20000:
            ref = known.get(cid)
            item = dict(row)
            if ref:
                item["ref_hp"] = ref["hp"]
                item["ref_atk"] = ref["atk"]
                item["ref_cd"] = ref["cd"]
                if row["hp"] == ref["hp"]:
                    hp_match += 1
                if row["atk"] == ref["atk"]:
                    atk_match += 1
            matched.append(item)

    print(f"table @{TABLE_START} stride={STRIDE} rows={len(rows)}")
    print(f"char ids: {len(matched)}, hp_match={hp_match}, atk_match={atk_match}")

    # 若 schema 不对，尝试行内 sliding 解析
    if hp_match < 5:
        print("schema id+fields failed, trying id-anchored scan...")
        for cid in [10001, 10002, 10003]:
            ref = known[cid]
            off = blob.find(struct.pack("<I", cid))
            rec = blob[off : off + STRIDE]
            print(f"\nid={cid} @ {off} hp={ref['hp']} atk={ref['atk']}")
            for start in range(0, 20):
                sub = rec[start:]
                fields = parse_row_by_schema(sub)
                if fields and len(fields) >= 4:
                    if fields[2] == ref["hp"] or fields[3] == ref["atk"]:
                        print(f"  START {start}: {fields}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": "Character_C.bin CharacterEdit panel table",
                "table_offset": TABLE_START,
                "stride": STRIDE,
                "schema": dict(zip(FIELD_NAMES, TYPES)),
                "hp_match_tenka": hp_match,
                "atk_match_tenka": atk_match,
                "characters": matched,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"-> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
