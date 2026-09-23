"""从 metadata 导出 LvUp/RankUp 相关类型字段。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "scripts/game_dump/apk/global-metadata.decrypted.dat"
OUT = ROOT / "scripts/game_dump/extracted/lvup_rankup_types.json"


def read_str(data: bytes, string_offset: int, index: int) -> str:
    pos = string_offset + index
    end = data.find(b"\x00", pos)
    if end < 0:
        end = min(pos + 256, len(data))
    return data[pos:end].decode("utf-8", "replace")


def main() -> int:
    data = META.read_bytes()
    string_off = struct.unpack_from("<I", data, 24)[0]
    fields_off = struct.unpack_from("<I", data, 96)[0]
    fields_size = struct.unpack_from("<I", data, 100)[0]
    type_off = struct.unpack_from("<I", data, 160)[0]
    type_size = struct.unpack_from("<I", data, 164)[0]
    field_count = fields_size // 12
    type_count = type_size // 88

    fields = []
    for fi in range(field_count):
        off = fields_off + fi * 12
        name_idx, type_idx, _ = struct.unpack_from("<3I", data, off)
        fields.append(
            {"index": fi, "name": read_str(data, string_off, name_idx), "typeIndex": type_idx}
        )

    types = []
    for ti in range(type_count):
        off = type_off + ti * 88
        vals = struct.unpack_from("<22I", data, off)
        types.append(
            {
                "index": ti,
                "name": read_str(data, string_off, vals[0]),
                "namespace": read_str(data, string_off, vals[1]),
                "fieldStart": vals[14],
                "fieldCount": vals[11],
            }
        )

    keywords = ["LvUp", "RankUp", "RareUp", "CharLv", "Potential"]
    matched = []
    for t in types:
        if not any(k in t["name"] for k in keywords):
            continue
        fs, fc = t["fieldStart"], t["fieldCount"]
        tfields = []
        if fs != 0xFFFFFFFF and 0 < fc <= 64 and fs + fc <= field_count:
            tfields = fields[fs : fs + fc]
        matched.append({**t, "fields": tfields})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(matched, ensure_ascii=False, indent=2), encoding="utf-8")
    for t in matched:
        fnames = [f["name"] for f in t["fields"]]
        full = f"{t['namespace']}.{t['name']}" if t["namespace"] else t["name"]
        print(f"{full} (#{t['index']}): {fnames}")
    print(f"-> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
