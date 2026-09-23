"""分析 maindata Character_C / Skill_C 二进制格式（逆向辅助）"""
from __future__ import annotations

import json
import struct
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw"
KEY = 0x279BB3ED  # bytes ed b3 9b 27 LE


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def find_id_offsets(blob: bytes, ids: set[int]) -> dict[int, int]:
    found: dict[int, int] = {}
    for i in range(len(blob) - 3):
        v = struct.unpack_from("<I", blob, i)[0]
        if v in ids and v not in found:
            found[v] = i
    return found


def analyze_character_c() -> None:
    blob = (RAW / "Character_C.bin").read_bytes()
    known = load_known()
    offsets = find_id_offsets(blob, set(known))
    print(f"Character_C: {len(blob)} bytes, matched {len(offsets)}/{len(known)} known ids")

    # stride between consecutive known ids (sorted by offset)
    ordered = sorted(offsets.items(), key=lambda x: x[1])
    strides = [ordered[i + 1][1] - ordered[i][1] for i in range(len(ordered) - 1)]
    print("top strides:", Counter(strides).most_common(8))

    for cid, off in ordered[:8]:
        c = known[cid]
        print(f"\n--- id={cid} name={c.get('nameSc')} @ {off} hp={c['hp']} atk={c['atk']} ---")
        for rel in range(-32, 128, 4):
            pos = off + rel
            if pos < 0 or pos + 4 > len(blob):
                continue
            raw = struct.unpack_from("<I", blob, pos)[0]
            dec = raw ^ KEY
            if raw == cid:
                mark = "ID"
            elif dec == c["hp"]:
                mark = "HP!"
            elif dec == c["atk"]:
                mark = "ATK!"
            elif dec in (c.get("cd"), c.get("atkMag"), c.get("ultMag"), c.get("rarity"), c.get("po")):
                mark = f"stat={dec}"
            elif 0 < dec < 50:
                mark = f"small={dec}"
            else:
                mark = ""
            if mark:
                print(f"  rel {rel:+4d}: raw=0x{raw:08x} dec={dec} {mark}")

    print(f"\nhp^KEY = 0x{962383 ^ KEY:08x}, atk^KEY = 0x{254657 ^ KEY:08x}")


def scan_xor_matches() -> None:
    blob = (RAW / "Character_C.bin").read_bytes()
    known = load_known()
    offsets = find_id_offsets(blob, set(known))
    hits: Counter[str] = Counter()
    for cid, off in offsets.items():
        c = known[cid]
        for rel in range(-128, 256, 4):
            pos = off + rel
            if pos < 0 or pos + 4 > len(blob):
                continue
            dec = struct.unpack_from("<I", blob, pos)[0] ^ KEY
            if dec == c["hp"]:
                hits["hp"] += 1
                if hits["hp"] <= 3:
                    print(f"hp hit id={cid} rel={rel}")
            if dec == c["atk"]:
                hits["atk"] += 1
                if hits["atk"] <= 3:
                    print(f"atk hit id={cid} rel={rel}")
    print("xor scan:", dict(hits))


def parse_table_header(path: Path) -> None:
    b = path.read_bytes()
    if len(b) < 8:
        print(path.name, "too small", b.hex())
        return
    v0 = struct.unpack_from("<I", b, 0)[0]
    if v0 == 1:
        print(f"{path.name}: v1 rows?={struct.unpack_from('<H', b, 8)[0]} header={b[:24].hex()}")
    elif v0 == 2:
        print(f"{path.name}: v2 cols?={b[4]} types={list(b[6:])}")
    else:
        print(f"{path.name}: u32@0={v0} ({len(b)} bytes) head={b[:24].hex()}")


def analyze_main_char_table() -> None:
    blob = (RAW / "Character_C.bin").read_bytes()
    known = load_known()
    idx = blob.find(struct.pack("<I", 10001))
    print(f"\n10001 anchor @ {idx}")
    chunk_ids = []
    for i in range(max(0, idx - 100), min(len(blob), idx + 8000)):
        v = struct.unpack_from("<I", blob, i)[0]
        if 10001 <= v <= 10200:
            chunk_ids.append((i, v))
    print(f"ids in region: {len(chunk_ids)}, first 15: {chunk_ids[:15]}")
    strides = [chunk_ids[i + 1][0] - chunk_ids[i][0] for i in range(len(chunk_ids) - 1)]
    print("strides:", Counter(strides).most_common(5))

    off = idx
    rec = blob[off - 8 : off + 116]
    print("record dump (10001 block):")
    c = known[10001]
    for i in range(0, len(rec), 4):
        pos = off - 8 + i
        v = struct.unpack_from("<I", rec, i)[0]
        dec = v ^ KEY
        note = ""
        if v == 10001:
            note = "ID"
        elif dec == c["hp"]:
            note = "HP"
        elif dec == c["atk"]:
            note = "ATK"
        elif v == c.get("cd"):
            note = "cd"
        print(f"  @{pos:6d}: raw={v:12d} dec={dec:12d} {note}")

    for cid in [10001, 10002, 10003]:
        ch = known[cid]
        for val, name in [(ch["hp"], "hp"), (ch["atk"], "atk")]:
            p = blob.find(struct.pack("<I", val))
            px = blob.find(struct.pack("<I", val ^ KEY))
            print(f"{cid} {name}={val} plain@{p} xor@{px}")


def parse_fixed_records(stride: int = 61) -> None:
    blob = (RAW / "Character_C.bin").read_bytes()
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]
    known = load_known()

    by_id: dict[int, bytes] = {}
    for i in range(len(data) - stride):
        cid = struct.unpack_from("<I", data, i)[0]
        if cid in known and cid not in by_id:
            by_id[cid] = data[i : i + stride]

    print(f"\nfixed stride={stride}: unique ids {len(by_id)}")
    for cid in sorted(by_id)[:10]:
        rec = by_id[cid]
        c = known[cid]
        slots = [struct.unpack_from("<I", rec, j)[0] for j in range(0, stride, 4) if j + 4 <= len(rec)]
        print(f"  id={cid} hp={c['hp']} atk={c['atk']} slots={slots[:12]}")

    for si in range(stride // 4):
        vals = []
        for cid in by_id:
            rec = by_id[cid]
            if si * 4 + 4 <= len(rec):
                vals.append(struct.unpack_from("<I", rec, si * 4)[0])
        if not vals:
            continue
        mx = max(vals)
        if 1000 < mx < 500_000:
            print(f"  slot {si}: range {min(vals)}-{mx} (n={len(vals)})")


def main() -> int:
    if not RAW.exists():
        print(f"请先解包 maindata: {RAW}")
        return 1
    print("=== headers ===")
    for name in ["CharacterEdit", "Character_C", "Skill_C", "SkillGroup", "LvUp", "RankUp"]:
        p = RAW / f"{name}.bin"
        if p.exists():
            parse_table_header(p)
    print("\n=== Character_C ===")
    analyze_character_c()
    print("\n=== XOR scan ===")
    scan_xor_matches()
    analyze_main_char_table()
    parse_fixed_records(61)
    parse_fixed_records(57)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
