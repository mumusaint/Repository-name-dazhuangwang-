"""分析 Character_C 内 178k 区（CharacterEdit 面板表，stride=61）。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOB = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw" / "Character_C.bin"
KEY = 0x279BB3ED
STRIDE = 61
EDIT_START = 178600  # 面板表大致起始


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def c32(raw: int) -> int:
    if raw in (0, KEY):
        return 0
    x = raw ^ KEY
    if raw > 0x00FFFFFF and x < 20_000_000:
        return x
    return raw


def main() -> None:
    blob = BLOB.read_bytes()
    known = load_known()

    # 定位 178k 区所有已知 ID
    hits: list[tuple[int, int]] = []
    for off in range(EDIT_START, min(len(blob), 182000) - 4):
        cid = struct.unpack_from("<I", blob, off)[0]
        if cid in known:
            hits.append((off, cid))
    print(f"178k hits: {len(hits)}")
    strides = [hits[i + 1][0] - hits[i][0] for i in range(len(hits) - 1)]
    from collections import Counter
    print("strides", Counter(strides).most_common(5))

    # 逐 slot 对照 hp/atk
    for si in range(16):
        pos = si * 4
        hp_m = atk_m = 0
        for off, cid in hits:
            if pos + 4 > STRIDE:
                continue
            rec = blob[off : off + STRIDE]
            raw = struct.unpack_from("<I", rec, pos)[0]
            for fn, v in [("raw", raw), ("c", c32(raw))]:
                c = known[cid]
                if v == c["hp"]:
                    hp_m += 1
                if v == c["atk"]:
                    atk_m += 1
        if hp_m or atk_m:
            print(f"slot {si} pos {pos}: hp={hp_m} atk={atk_m}")

    # 打印 10001 完整 record
    for off, cid in hits[:12]:
        c = known[cid]
        rec = blob[off : off + STRIDE]
        print(f"\nid={cid} name={c.get('nameSc')} hp={c['hp']} atk={c['atk']} cd={c['cd']}")
        for si in range(16):
            p = si * 4
            if p + 4 > len(rec):
                break
            raw = struct.unpack_from("<I", rec, p)[0]
            dec = c32(raw)
            mark = ""
            if raw == cid:
                mark = "ID"
            elif dec == c["hp"]:
                mark = "HP"
            elif dec == c["atk"]:
                mark = "ATK"
            elif raw == c["cd"] or dec == c["cd"]:
                mark = "CD"
            elif dec == c.get("rarity") or raw == c.get("rarity"):
                mark = "rarity"
            elif dec == c.get("po") or raw == c.get("po"):
                mark = "po"
            print(f"  [{si:2d}] raw={raw:12d} c={dec:12d} {mark}")


if __name__ == "__main__":
    main()
