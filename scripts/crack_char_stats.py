"""暴力对照 Character_C 字段与 TenkaAssist hp/atk，寻找解码规律。"""
from __future__ import annotations

import json
import struct
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw" / "Character_C.bin"
KEY = 0x279BB3ED


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def decode_variants(raw: int) -> dict[str, int]:
    out: dict[str, int] = {"raw": raw}
    if raw == KEY:
        out["c"] = 0
    else:
        out["c"] = raw ^ KEY
    if raw & 0xFF == 0xED or (raw >> 8) & 0xFF == 0xB3:
        out["c2"] = raw ^ KEY
    hi = raw >> 24
    if hi in (0xED, 0xB3, 0xB2):
        out["hi_ed"] = raw ^ KEY
    return out


def find_primary_records(blob: bytes, known: dict[int, dict]) -> dict[int, tuple[int, bytes]]:
    """取 data 区 offset 最大的一组 ID（主角色表，约 91k+）。"""
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]
    by_id: dict[int, list[tuple[int, bytes]]] = defaultdict(list)
    stride = 61
    for i in range(len(data) - stride):
        cid = struct.unpack_from("<I", data, i)[0]
        if cid in known:
            by_id[cid].append((hdr + i, data[i : i + stride]))
    result: dict[int, tuple[int, bytes]] = {}
    for cid, hits in by_id.items():
        # 主表在较高 offset
        result[cid] = max(hits, key=lambda x: x[0])
    return result


def slot_correlation(records: dict[int, tuple[int, bytes]], known: dict[int, dict]) -> None:
    stride = 61
    nslots = stride // 4 + 1
    for si in range(nslots):
        pos = si * 4
        for dec_name in ("raw", "c"):
            hp_hit = atk_hit = cd_hit = 0
            for cid, (_, rec) in records.items():
                if pos + 4 > len(rec):
                    continue
                raw = struct.unpack_from("<I", rec, pos)[0]
                vals = decode_variants(raw)
                v = vals.get(dec_name, raw)
                c = known[cid]
                if v == c["hp"]:
                    hp_hit += 1
                if v == c["atk"]:
                    atk_hit += 1
                if v == c["cd"]:
                    cd_hit += 1
            if hp_hit >= 5 or atk_hit >= 5 or cd_hit >= 10:
                print(f"slot {si} @{pos} dec={dec_name}: hp={hp_hit} atk={atk_hit} cd={cd_hit}")


def header_field_scan(blob: bytes, known: dict[int, dict]) -> None:
    """扫描 178xxx 区（疑似 CharacterEdit 面板表）。"""
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]
    for cid, c in known.items():
        pat = struct.pack("<I", cid)
        idx = 0
        while True:
            i = data.find(pat, idx)
            if i < 0:
                break
            abs_off = hdr + i
            if 170000 < abs_off < 185000:
                print(f"\nEdit? id={cid} @{abs_off} hp={c['hp']} atk={c['atk']}")
                for rel in range(-8, 96, 4):
                    p = i + rel
                    if p < 0 or p + 4 > len(data):
                        continue
                    raw = struct.unpack_from("<I", data, p)[0]
                    for dn, v in decode_variants(raw).items():
                        tags = []
                        if v == c["hp"]:
                            tags.append("HP")
                        if v == c["atk"]:
                            tags.append("ATK")
                        if v == c["cd"]:
                            tags.append("CD")
                        if tags:
                            print(f"  rel {rel:+3d} {dn}={v} {' '.join(tags)}")
            idx = i + 1


def parse_header_types(blob: bytes) -> list[int]:
    h = blob[: struct.unpack_from("<I", blob, 0)[0]]
    types = []
    for i in range(len(h) - 1):
        if h[i] == 0x18 and i + 1 < len(h):
            # 尝试从 i 开始读类型序列
            chunk = h[i + 1 : i + 30]
            cand = [b for b in chunk if 1 <= b <= 8]
            if len(cand) >= 8:
                types = cand[:24]
                break
    return types


def try_read_rows(blob: bytes, col_types: list[int], c_cols: set[int]) -> list[list]:
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]
    rows = []
    pos = 0
    while pos < len(data) - 4:
        row = []
        start = pos
        ok = True
        for ci, t in enumerate(col_types):
            if pos >= len(data):
                ok = False
                break
            w = {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 4, 7: 4, 8: 8}.get(t, 0)
            if w == 0 or pos + w > len(data):
                ok = False
                break
            if w == 1:
                val = data[pos]
            elif w == 2:
                val = struct.unpack_from("<H", data, pos)[0]
            elif w == 4:
                raw = struct.unpack_from("<I", data, pos)[0]
                val = (raw ^ KEY) if (ci in c_cols or raw == KEY) else raw
                if raw == KEY:
                    val = 0
            else:
                val = struct.unpack_from("<Q", data, pos)[0]
            row.append(val)
            pos += w
        if not ok or not row:
            break
        if row[0] and 10000 <= row[0] <= 20000:
            rows.append(row)
        if len(rows) > 300:
            break
        if pos - start == 0:
            pos += 1
    return rows


def main() -> None:
    blob = RAW.read_bytes()
    known = load_known()
    records = find_primary_records(blob, known)
    print(f"primary records: {len(records)}")
    slot_correlation(records, known)
    header_field_scan(blob, known)

    # CharacterEdit 8 列 schema
    edit_types = [5, 3, 6, 6, 2, 5, 1, 8]
    print("\ntry CharacterEdit 8-col on data section:")
    for c_mask in [
        {2, 3},  # s32 hp, atk
        {0, 1, 2, 3, 4, 5, 6, 7},
        set(),
    ]:
        rows = try_read_rows(blob, edit_types, c_mask)
        if not rows:
            continue
        hp = sum(1 for r in rows if len(r) > 3 and r[0] in known and r[2] == known[r[0]]["hp"])
        atk = sum(1 for r in rows if len(r) > 3 and r[0] in known and r[3] == known[r[0]]["atk"])
        print(f"  c_cols={c_mask}: rows={len(rows)} hp_match={hp} atk_match={atk}")
        if hp > 3 or atk > 3:
            for r in rows[:5]:
                print("   ", r)


if __name__ == "__main__":
    main()
