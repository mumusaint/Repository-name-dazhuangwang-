"""探测 HP/ATK 面板 = stat_a * K_HP + stat_b * K_ATK 公式。"""
from __future__ import annotations

import json
import struct
from pathlib import Path
from statistics import mean, pstdev

ROOT = Path(__file__).resolve().parent.parent
BLOB = ROOT / "scripts/game_dump/extracted/maindata_raw/Character_C.bin"
KEY = 0x279BB3ED


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def decode_record(rec: bytes) -> list[int]:
    nums: list[int] = []
    pos = 0
    while pos < len(rec):
        b = rec[pos]
        if b == 0:
            pos += 1
            continue
        if b == 0xED and pos + 4 <= len(rec):
            raw = struct.unpack_from("<I", rec, pos)[0]
            nums.append(0 if raw == KEY else raw ^ KEY)
            pos += 4
            continue
        if pos + 4 <= len(rec):
            nums.append(struct.unpack_from("<I", rec, pos)[0])
            pos += 4
        else:
            pos += 1
    return nums


def pick_records(blob: bytes, known: dict[int, dict], min_off: int = 94000) -> dict[int, tuple[int, list[int]]]:
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]
    best: dict[int, tuple[int, list[int]]] = {}
    for i in range(len(data) - 61):
        cid = struct.unpack_from("<I", data, i)[0]
        if cid not in known:
            continue
        abs_off = hdr + i
        if abs_off < min_off:
            continue
        if cid not in best or abs_off > best[cid][0]:
            best[cid] = (abs_off, decode_record(blob[abs_off : abs_off + 61]))
    return best


def main() -> None:
    blob = BLOB.read_bytes()
    known = load_known()
    recs = pick_records(blob, known)

    hp_ratios: list[float] = []
    atk_ratios: list[float] = []
    for cid, (_, nums) in recs.items():
        ref = known[cid]
        if len(nums) > 2 and nums[2] > 100:
            hp_ratios.append(ref["hp"] / nums[2])
        if len(nums) > 4 and nums[4] > 0:
            atk_ratios.append(ref["atk"] / nums[4])

    print(f"records @>=94000: {len(recs)}")
    if hp_ratios:
        print(
            f"hp/stat_a: mean={mean(hp_ratios):.6f} stdev={pstdev(hp_ratios):.4f} "
            f"range=[{min(hp_ratios):.4f},{max(hp_ratios):.4f}]"
        )
    if atk_ratios:
        print(
            f"atk/stat_b: mean={mean(atk_ratios):.6f} stdev={pstdev(atk_ratios):.4f} "
            f"range=[{min(atk_ratios):.4f},{max(atk_ratios):.4f}]"
        )

    for K_HP in [44.0, 44.4, 44.42, 44.422, 44.5]:
        hits = sum(
            1
            for cid, (_, n) in recs.items()
            if len(n) > 2 and n[2] > 100 and abs(known[cid]["hp"] - n[2] * K_HP) < 200
        )
        if hits >= 3:
            print(f"  hp ~= stat_a * {K_HP}: hits={hits}/{len(recs)}")

    for K_ATK in [440, 442, 442.88, 442.8826, 443]:
        hits = sum(
            1
            for cid, (_, n) in recs.items()
            if len(n) > 4 and n[4] > 0 and abs(known[cid]["atk"] - n[4] * K_ATK) < 200
        )
        if hits >= 3:
            print(f"  atk ~= stat_b * {K_ATK}: hits={hits}/{len(recs)}")

    # 示例
    for cid in [10001, 10002, 10003, 10004, 10005]:
        if cid not in recs:
            continue
        off, nums = recs[cid]
        ref = known[cid]
        sa = nums[2] if len(nums) > 2 else 0
        sb = nums[4] if len(nums) > 4 else 0
        print(
            f"\n{cid} {ref.get('nameSc')} @{off} stat_a={sa} stat_b={sb} "
            f"hp={ref['hp']} atk={ref['atk']}"
        )
        if sa:
            print(f"  hp/sa={ref['hp']/sa:.4f}")
        if sb:
            print(f"  atk/sb={ref['atk']/sb:.4f}")


if __name__ == "__main__":
    main()
