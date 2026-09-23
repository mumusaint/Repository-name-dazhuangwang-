"""为每个角色选取 stat_a/stat_b 与 TenkaAssist 面板最吻合的记录。"""
from __future__ import annotations

import json
import struct
from pathlib import Path
from statistics import mean, pstdev

ROOT = Path(__file__).resolve().parent.parent
BLOB = ROOT / "scripts/game_dump/extracted/maindata_raw/Character_C.bin"
KEY = 0x279BB3ED
K_HP = 44.422
K_ATK = 442.8826


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def record_fields(rec: bytes) -> tuple[int, int, int]:
    """id @0, stat_a @8, stat_b @16（61 字节主表记录布局）。"""
    cid = struct.unpack_from("<I", rec, 0)[0]
    sa = struct.unpack_from("<I", rec, 8)[0]
    sb = struct.unpack_from("<I", rec, 16)[0]
    return cid, sa, sb


def score(ref: dict, sa: int, sb: int) -> float:
    if sa < 50 or sb < 1:
        return 1e18
    hp_est = sa * K_HP
    atk_est = sb * K_ATK
    return abs(ref["hp"] - hp_est) + abs(ref["atk"] - atk_est) / 10


def main() -> None:
    blob = BLOB.read_bytes()
    known = load_known()
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]
    stride = 61

    by_id: dict[int, list[tuple[int, int, int, int]]] = {}
    for i in range(len(data) - stride):
        rec = data[i : i + stride]
        cid, sa, sb = record_fields(rec)
        if cid not in known:
            continue
        by_id.setdefault(cid, []).append((hdr + i, sa, sb, score(known[cid], sa, sb)))

    hp_err: list[float] = []
    atk_err: list[float] = []
    hits = 0
    for cid in sorted(by_id):
        ref = known[cid]
        best = min(by_id[cid], key=lambda x: x[3])
        off, sa, sb, sc = best
        hp_est = round(sa * K_HP)
        atk_est = round(sb * K_ATK)
        hp_err.append(abs(ref["hp"] - hp_est) / ref["hp"])
        atk_err.append(abs(ref["atk"] - atk_est) / ref["atk"])
        if abs(ref["hp"] - hp_est) < 500 and abs(ref["atk"] - atk_est) < 500:
            hits += 1
        if cid <= 10005:
            print(
                f"{cid} {ref.get('nameSc')} @{off} sa={sa} sb={sb} "
                f"hp={ref['hp']}~{hp_est} atk={ref['atk']}~{atk_est} score={sc:.0f}"
            )

    print(f"\nchars={len(by_id)} formula_hits={hits}")
    print(f"hp rel err mean={mean(hp_err)*100:.2f}% stdev={pstdev(hp_err)*100:.2f}%")
    print(f"atk rel err mean={mean(atk_err)*100:.2f}% stdev={pstdev(atk_err)*100:.2f}%")


if __name__ == "__main__":
    main()
