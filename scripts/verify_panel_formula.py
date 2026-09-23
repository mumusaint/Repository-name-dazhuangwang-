"""验证 atk_panel ≈ atk_base * K 与 hp 公式。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOB = ROOT / "scripts/game_dump/extracted/maindata_raw/Character_C.bin"
KEY = 0x279BB3ED


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def index_records(blob: bytes, known: dict[int, dict]) -> dict[int, list[int]]:
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]
    best: dict[int, tuple[int, list[int]]] = {}
    for i in range(len(data) - 61):
        cid = struct.unpack_from("<I", data, i)[0]
        if cid not in known:
            continue
        abs_off = hdr + i
        if abs_off < 94000:
            continue
        if cid not in best or abs_off > best[cid][0]:
            rec = data[i : i + 61]
            fields = [struct.unpack_from("<I", rec, j)[0] for j in range(0, 61, 4) if j + 4 <= len(rec)]
            best[cid] = (abs_off, fields)
    return {cid: f for cid, (_, f) in best.items()}


def main() -> None:
    known = load_known()
    blob = BLOB.read_bytes()
    recs = index_records(blob, known)

    atk_ratios = []
    hp_ratios = []
    for cid, fields in recs.items():
        ref = known[cid]
        atk_b = fields[4] if len(fields) > 4 else 0
        hp_b = fields[2] if len(fields) > 2 else 0
        if atk_b > 0:
            atk_ratios.append(ref["atk"] / atk_b)
        if hp_b > 0:
            hp_ratios.append(ref["hp"] / hp_b)

    from statistics import mean, pstdev

    print(f"chars {len(recs)}")
    if atk_ratios:
        print(f"atk/atk_base: mean={mean(atk_ratios):.4f} stdev={pstdev(atk_ratios):.2f}")
        print(f"  sample: {sorted(atk_ratios)[:5]} ... {sorted(atk_ratios)[-3:]}")
    if hp_ratios:
        print(f"hp/hp_base: mean={mean(hp_ratios):.4f} stdev={pstdev(hp_ratios):.2f}")
        print(f"  sample: {sorted(hp_ratios)[:5]} ... {sorted(hp_ratios)[-3:]}")

    # 固定系数验证
    K_ATK = 442.8826
    hits_atk = sum(
        1
        for cid, fields in recs.items()
        if len(fields) > 4 and fields[4] > 0 and abs(known[cid]["atk"] - fields[4] * K_ATK) < 50
    )
    print(f"atk ~= base*{K_ATK:.4f}: hits={hits_atk}/{len(recs)}")

    for K_HP in [44.4, 44.41, 44.42, 2.2, 2.21, 2.215]:
        hits = sum(
            1
            for cid, fields in recs.items()
            if len(fields) > 2 and fields[2] > 1000 and abs(known[cid]["hp"] - fields[2] * K_HP) < 5000
        )
        if hits > 5:
            print(f"hp ~= base*{K_HP}: hits={hits}")


if __name__ == "__main__":
    main()
