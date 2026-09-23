"""扫描 CharacterEdit 面板表（140023 起，stride 61），多行/角色匹配 HP/ATK。"""
from __future__ import annotations

import json
import struct
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOB = ROOT / "scripts/game_dump/extracted/maindata_raw/Character_C.bin"
KEY = 0x279BB3ED
START = 140023
STRIDE = 61
END = 182000


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def c32(raw: int) -> int:
    if raw in (0, KEY):
        return 0
    if (raw & 0xFF) == 0xED:
        return raw ^ KEY
    return raw


def main() -> None:
    blob = BLOB.read_bytes()
    known = load_known()
    by_id: dict[int, list[tuple[int, list[int]]]] = defaultdict(list)

    for off in range(START, min(END, len(blob) - STRIDE), 1):
        cid = struct.unpack_from("<I", blob, off)[0]
        if cid not in known:
            continue
        rec = blob[off : off + STRIDE]
        fields = [c32(struct.unpack_from("<I", rec, i)[0]) for i in range(0, STRIDE, 4) if i + 4 <= len(rec)]
        by_id[cid].append((off, fields))

    print(f"chars with hits: {len(by_id)}")
    hp_match = atk_match = 0
    for cid in [10001, 10002, 10003, 10004, 10005]:
        ref = known[cid]
        print(f"\n=== {cid} {ref.get('nameSc')} hp={ref['hp']} atk={ref['atk']} rows={len(by_id.get(cid,[]))} ===")
        for off, fields in by_id.get(cid, []):
            tags = []
            for i, v in enumerate(fields):
                if v == ref["hp"]:
                    tags.append(f"hp@{i}")
                    hp_match += 1
                if v == ref["atk"]:
                    tags.append(f"atk@{i}")
                    atk_match += 1
            if tags:
                print(f"  @{off} MATCH {tags} fields={fields[:12]}")

    # 每角色取 hp 最大行作为满配候选
    best_rows = []
    for cid, rows in by_id.items():
        ref = known.get(cid)
        if not ref:
            continue
        best = max(rows, key=lambda x: x[1][2] if len(x[1]) > 2 else 0)
        off, fields = best
        best_rows.append({"id": cid, "off": off, "fields": fields[:12]})

    out = ROOT / "scripts/game_dump/extracted/character_edit_scan.json"
    out.write_text(json.dumps(best_rows[:30], ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nhp field matches: {hp_match}, atk: {atk_match}")


if __name__ == "__main__":
    main()
