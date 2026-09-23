"""对比 Character_C 内同一 ID 的多处出现，确定主表 offset 与字段。"""
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


def decode_stream(rec: bytes) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    pos = 0
    while pos < len(rec):
        b = rec[pos]
        if b == 0:
            out.append(("zero", 0))
            pos += 1
            continue
        if b == 0xED and pos + 4 <= len(rec):
            raw = struct.unpack_from("<I", rec, pos)[0]
            out.append(("c32", 0 if raw == KEY else raw ^ KEY))
            pos += 4
            continue
        if pos + 4 <= len(rec):
            raw = struct.unpack_from("<I", rec, pos)[0]
            kind = "id" if 10000 <= raw <= 20000 else "u32"
            out.append((kind, raw))
            pos += 4
        else:
            out.append(("u8", b))
            pos += 1
    return out


def main() -> None:
    blob = BLOB.read_bytes()
    known = load_known()
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]

    for cid in [10001, 10002, 10003]:
        ref = known[cid]
        offs = [hdr + i for i in range(len(data) - 4) if struct.unpack_from("<I", data, i)[0] == cid]
        print(f"\n=== {cid} {ref.get('nameSc')} hp={ref['hp']} atk={ref['atk']} ({len(offs)} hits) ===")
        for off in offs:
            rec = blob[off : off + 61]
            vals = decode_stream(rec)
            nums = [v for k, v in vals if k in ("u32", "c32", "id")]
            sa = nums[2] if len(nums) > 2 else None
            sb = nums[4] if len(nums) > 4 else None
            hp_r = ref["hp"] / sa if sa and sa > 0 else None
            atk_r = ref["atk"] / sb if sb and sb > 0 else None
            hp_s = f"{hp_r:.4f}" if hp_r else "-"
            atk_s = f"{atk_r:.4f}" if atk_r else "-"
            print(f"  @{off}: sa={sa} sb={sb} hp/sa={hp_s} atk/sb={atk_s}")


if __name__ == "__main__":
    main()
