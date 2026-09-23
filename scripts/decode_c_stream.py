"""流式 C 字段解码：按 0xED 标记读取整型。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOB = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw" / "Character_C.bin"
KEY = 0x279BB3ED


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def decode_stream(data: bytes) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    pos = 0
    while pos < len(data):
        b = data[pos]
        if b == 0:
            out.append(("zero", 0))
            pos += 1
            continue
        if b == 0xED and pos + 4 <= len(data):
            raw = struct.unpack_from("<I", data, pos)[0]
            out.append(("c32", raw ^ KEY if raw != KEY else 0))
            pos += 4
            continue
        if pos + 4 <= len(data) and data[pos + 1] in (0xB2, 0xB3) and data[pos] == 0xED:
            raw = struct.unpack_from("<I", data, pos)[0]
            out.append(("c32", raw ^ KEY if raw != KEY else 0))
            pos += 4
            continue
        if pos + 4 <= len(data):
            raw = struct.unpack_from("<I", data, pos)[0]
            if 10000 <= raw <= 20000:
                out.append(("id", raw))
            else:
                out.append(("u32", raw))
            pos += 4
        else:
            out.append(("u8", b))
            pos += 1
    return out


def main() -> None:
    blob = BLOB.read_bytes()
    known = load_known()
    hdr = struct.unpack_from("<I", blob, 0)[0]

    for cid in [10001, 10002, 10003, 10004]:
        ref = known[cid]
        off = blob.find(struct.pack("<I", cid))
        chunk = blob[off : off + 80]
        vals = decode_stream(chunk)
        print(f"\n=== {cid} @ {off} hp={ref['hp']} atk={ref['atk']} ===")
        for kind, v in vals[:20]:
            tag = ""
            if v == ref["hp"]:
                tag = " HP!"
            if v == ref["atk"]:
                tag = " ATK!"
            if v == ref["cd"]:
                tag = " CD!"
            print(f"  {kind:4s} {v}{tag}")

    # 全文件搜索 decode 后等于 hp 的 c32 位置
    hits = 0
    for cid, ref in list(known.items())[:20]:
        hp, atk = ref["hp"], ref["atk"]
        for enc, label in [(hp, "plain"), (hp ^ KEY, "xor")]:
            p = blob.find(struct.pack("<I", enc))
            if p >= hdr:
                print(f"found {label} hp for {cid} at {p}")
                hits += 1
    print("plain/xor hp hits in file:", hits)


def inspect_offsets() -> None:
    blob = BLOB.read_bytes()
    hdr = struct.unpack_from("<I", blob, 0)[0]
    data = blob[hdr:]
    known = load_known()
    pairs = [(10001, 21675), (10002, 625074), (10003, 12), (10001, 575), (10002, 300)]
    for cid, off in pairs:
        if off >= len(data):
            continue
        ref = known[cid]
        chunk = data[off : off + 80]
        print(f"--- cid={cid} off={off} hp={ref['hp']} atk={ref['atk']} ---")
        for j in range(0, min(76, len(chunk) - 3), 4):
            raw = struct.unpack_from("<I", chunk, j)[0]
            dec = raw ^ KEY if (raw & 0xFF) == 0xED else raw
            tags = []
            if dec == ref["hp"]:
                tags.append("HP")
            if dec == ref["atk"]:
                tags.append("ATK")
            if tags:
                print(f"  +{j}: raw={raw} dec={dec} {' '.join(tags)}")


if __name__ == "__main__":
    main()
    print()
    inspect_offsets()
