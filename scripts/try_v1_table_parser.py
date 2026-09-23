"""尝试解析 v1 格式 maindata 表（01000000 开头）。"""
from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

RAW = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw"
KEY = 0x279BB3ED

# 与 CharacterEdit / 常见手游表一致
TYPE_WIDTH = {
    1: 1,  # bool
    2: 1,  # s8
    3: 1,  # u8
    4: 2,  # s16
    5: 2,  # u16
    6: 4,  # s32
    7: 4,  # u32
    8: 8,  # s64
}


def read_c32(raw: int) -> int:
    if raw in (0, KEY):
        return 0
    dec = raw ^ KEY
    if raw > 0x01000000 and dec < 50_000_000:
        return dec
    return raw


def read_field(data: bytes, pos: int, t: int, c_enc: bool) -> tuple[Any, int]:
    if t not in TYPE_WIDTH:
        return None, pos
    w = TYPE_WIDTH[t]
    if pos + w > len(data):
        return None, pos
    if w == 1:
        val = data[pos]
    elif w == 2:
        val = struct.unpack_from("<H", data, pos)[0]
    elif w == 4:
        raw = struct.unpack_from("<I", data, pos)[0]
        val = read_c32(raw) if c_enc and t in (6, 7) else raw
    else:
        val = struct.unpack_from("<Q", data, pos)[0]
    return val, pos + w


def parse_v1(blob: bytes, c_enc: bool = False) -> dict[str, Any] | None:
    if len(blob) < 8 or struct.unpack_from("<I", blob, 0)[0] != 1:
        return None
    col_count = struct.unpack_from("<H", blob, 4)[0]
    row_count = struct.unpack_from("<H", blob, 6)[0]
    pos = 8
    if col_count > 128 or row_count > 100_000 or pos + col_count > len(blob):
        return None
    types = list(blob[pos : pos + col_count])
    pos += col_count
    rows: list[list[Any]] = []
    for _ in range(row_count):
        row: list[Any] = []
        start = pos
        ok = True
        for t in types:
            val, pos = read_field(blob, pos, t, c_enc)
            if val is None:
                ok = False
                break
            row.append(val)
        if not ok:
            break
        rows.append(row)
    consumed = pos
    return {
        "col_count": col_count,
        "row_count": row_count,
        "types": types,
        "parsed_rows": len(rows),
        "consumed_bytes": consumed,
        "total_bytes": len(blob),
        "rows": rows[:20],
    }


def main() -> int:
    results = {}
    for path in sorted(RAW.glob("*.bin")):
        blob = path.read_bytes()
        for c_enc in (False, True):
            r = parse_v1(blob, c_enc=c_enc)
            if r and r["parsed_rows"] == r["row_count"]:
                key = f"{path.stem}{'_C' if c_enc else ''}"
                results[key] = r
                print(
                    f"OK {key}: cols={r['col_count']} rows={r['row_count']} "
                    f"types={r['types'][:12]} consumed={r['consumed_bytes']}/{r['total_bytes']}"
                )
                if r["rows"]:
                    print(f"  first row: {r['rows'][0]}")
                break
    out = Path(__file__).parent / "game_dump" / "extracted" / "v1_tables.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(results)} tables -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
