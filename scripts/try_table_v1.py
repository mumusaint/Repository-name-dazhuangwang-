"""解析 v1 表（01000000）并尝试推导 C 字段读取。"""
from __future__ import annotations

import struct
from pathlib import Path

KEY = 0x279BB3ED
RAW = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw"
TYPE_W = {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 4, 7: 4, 8: 8}


def read_c32(raw: int) -> int:
    if raw == KEY:
        return 0
    if (raw & 0xFF) == 0xED or ((raw >> 8) & 0xFF) in (0xB2, 0xB3):
        return raw ^ KEY
    return raw


def parse_v1(blob: bytes, c_int_types: set[int] | None = None) -> dict | None:
    if len(blob) < 10 or struct.unpack_from("<I", blob, 0)[0] != 1:
        return None
    ncol = struct.unpack_from("<H", blob, 4)[0]
    nrow = struct.unpack_from("<H", blob, 6)[0]
    if ncol > 64 or nrow > 50000:
        return None
    pos = 8
    types = list(blob[pos : pos + ncol])
    pos += ncol
    if len(types) != ncol:
        return None
    c_int_types = c_int_types or {6, 7}
    rows = []
    for _ in range(nrow):
        row = []
        for t in types:
            w = TYPE_W.get(t)
            if not w or pos + w > len(blob):
                return None
            if w == 1:
                row.append(blob[pos])
            elif w == 2:
                row.append(struct.unpack_from("<H", blob, pos)[0])
            elif w == 4:
                raw = struct.unpack_from("<I", blob, pos)[0]
                row.append(read_c32(raw) if t in c_int_types else raw)
            else:
                row.append(struct.unpack_from("<Q", blob, pos)[0])
            pos += w
        rows.append(row)
    if pos > len(blob) + 4:
        return None
    return {"ncol": ncol, "nrow": nrow, "types": types, "rows": rows, "consumed": pos}


def parse_c_stream(data: bytes, pos: int = 0) -> tuple[list, int]:
    """按字节流解析：遇 0x00=padding；0xED/xx 起 4 字节 C 数；否则按 schema 读。"""
    out = []
    while pos < len(data):
        b = data[pos]
        if b == 0:
            pos += 1
            continue
        if b == 0xED and pos + 4 <= len(data):
            raw = struct.unpack_from("<I", data, pos)[0]
            out.append(read_c32(raw))
            pos += 4
            continue
        if pos + 4 <= len(data):
            out.append(struct.unpack_from("<I", data, pos)[0])
            pos += 4
        else:
            break
    return out, pos


def main() -> None:
    for name in ["BuildingLvUp_C", "BackBonus_C", "LvUp", "RankUp", "CharacterBonus"]:
        p = RAW / f"{name}.bin"
        if not p.exists():
            continue
        blob = p.read_bytes()
        for cset in [{6}, {6, 7}, set()]:
            r = parse_v1(blob, cset)
            if r and r["consumed"] <= len(blob) + 8:
                print(
                    f"{name} cols={r['ncol']} rows={r['nrow']} types={r['types'][:16]} "
                    f"consumed={r['consumed']}/{len(blob)} first={r['rows'][0][:8] if r['rows'] else []}"
                )
                break
        else:
            print(f"{name}: v1 failed, head={blob[:20].hex()}")

    # Character_C data section: try stream parse from first row
    cc = (RAW / "Character_C.bin").read_bytes()
    hdr = struct.unpack_from("<I", cc, 0)[0]
    chunk = cc[hdr : hdr + 200]
    vals, end = parse_c_stream(chunk)
    print(f"\nCharacter_C stream first vals: {vals[:20]}")


if __name__ == "__main__":
    main()
