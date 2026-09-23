"""dump TCharacterEditData Il2CppTypeDefinition raw fields (v31)。"""
from __future__ import annotations

import struct
from pathlib import Path

data = Path("scripts/game_dump/apk/global-metadata.decrypted.dat").read_bytes()
string_off = struct.unpack_from("<I", data, 24)[0]
type_off = struct.unpack_from("<I", data, 160)[0]

for ti in range(20000):
    off = type_off + ti * 88
    if off + 88 > len(data):
        break
    ni = struct.unpack_from("<I", data, off)[0]
    pos = string_off + ni
    if data[pos : pos + 20].startswith(b"TCharacterEditData"):
        print("type index", ti, "at", off)
        for i in range(0, 88, 4):
            print(f"  +{i:2d}: {struct.unpack_from('<I', data, off + i)[0]}")
        break

# fields hpBase / atkBase
fields_off = struct.unpack_from("<I", data, 96)[0]
for fi in range(62982):
    off = fields_off + fi * 12
    ni = struct.unpack_from("<I", data, off)[0]
    name = data[string_off + ni : string_off + ni + 32].split(b"\x00")[0].decode()
    if name in ("hpBase", "atkBase", "skillGrp"):
        ti = struct.unpack_from("<I", data, off + 4)[0]
        print(f"field {name} index={fi} typeIndex={ti}")
