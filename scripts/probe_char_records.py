"""探测 Character_C 中 ID 记录附近的字段，与 TenkaAssist 面板值对照。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw" / "Character_C.bin"
KEY = 0x279BB3ED


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def all_id_positions(blob: bytes, cid: int) -> list[int]:
    pat = struct.pack("<I", cid)
    out: list[int] = []
    start = 0
    while True:
        i = blob.find(pat, start)
        if i < 0:
            break
        out.append(i)
        start = i + 1
    return out


def decode_val(raw: int) -> tuple[int, str]:
    if raw == 0:
        return 0, "zero"
    dec = raw ^ KEY
    if dec == KEY:
        return 0, "c-zero"
    return dec, "c" if raw > 1_000_000 else "plain"


def probe_record(blob: bytes, off: int, known: dict) -> None:
    cid = struct.unpack_from("<I", blob, off)[0]
    if cid not in known:
        return
    c = known[cid]
    print(f"\nid={cid} name={c.get('nameSc')} @ {off}  hp={c['hp']} atk={c['atk']} cd={c['cd']}")
    for rel in range(-16, 80, 4):
        pos = off + rel
        if pos < 0 or pos + 4 > len(blob):
            continue
        raw = struct.unpack_from("<I", blob, pos)[0]
        dec, kind = decode_val(raw)
        tags = []
        if raw == cid:
            tags.append("ID")
        if dec == c["hp"]:
            tags.append("HP")
        if dec == c["atk"]:
            tags.append("ATK")
        if dec == c["cd"]:
            tags.append("CD")
        if dec == c.get("atkMag"):
            tags.append("atkMag")
        if dec == c.get("ultMag"):
            tags.append("ultMag")
        if dec == c.get("rarity"):
            tags.append("rarity")
        if dec == c.get("po"):
            tags.append("po")
        if tags or (kind == "plain" and 0 < raw < 500000):
            print(f"  {rel:+3d}: raw={raw:10d} dec={dec:10d} [{kind}] {' '.join(tags)}")


def main() -> int:
    blob = RAW.read_bytes()
    known = load_known()
    for cid in [10001, 10002, 10003, 10004, 10005]:
        positions = all_id_positions(blob, cid)
        print(f"=== {cid}: {len(positions)} hits {positions[:5]}")
        for off in positions[:3]:
            probe_record(blob, off, known)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
