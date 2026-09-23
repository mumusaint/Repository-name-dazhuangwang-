"""从 metadata v31 解析类型/方法/字段，定位 LoadBinaryDataWithCAsync 与 TCharacterEditData。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "scripts/game_dump/apk/global-metadata.decrypted.dat"
OUT = ROOT / "scripts/game_dump/extracted/il2cpp_metadata_types.json"
OUT_CS = ROOT / "scripts/game_dump/extracted/il2cpp_loadbinary_snippet.cs"


def read_str(data: bytes, string_offset: int, index: int) -> str:
    pos = string_offset + index
    if pos >= len(data):
        return ""
    end = data.find(b"\x00", pos)
    if end < 0:
        end = min(pos + 256, len(data))
    return data[pos:end].decode("utf-8", "replace")


def main() -> int:
    data = META.read_bytes()
    if struct.unpack_from("<I", data, 0)[0] != 0xFAB11BAF:
        print("invalid metadata")
        return 1

    version = struct.unpack_from("<I", data, 4)[0]
    string_off = struct.unpack_from("<I", data, 24)[0]
    methods_off = struct.unpack_from("<I", data, 48)[0]
    methods_size = struct.unpack_from("<I", data, 52)[0]
    fields_off = struct.unpack_from("<I", data, 96)[0]
    fields_size = struct.unpack_from("<I", data, 100)[0]
    type_off = struct.unpack_from("<I", data, 160)[0]
    type_size = struct.unpack_from("<I", data, 164)[0]

    # v31 Il2CppMethodDefinition = 32 bytes
    method_count = methods_size // 32
    field_count = fields_size // 12
    type_count = type_size // 88

    types: list[dict] = []
    for ti in range(type_count):
        off = type_off + ti * 88
        if off + 88 > len(data):
            break
        vals = struct.unpack_from("<22I", data, off)
        name_idx, ns_idx = vals[0], vals[1]
        # v31 实测偏移（TCharacterEditData @416 校验）
        field_start, field_cnt = vals[14], vals[11]
        method_start, method_cnt = vals[9], vals[10]
        name = read_str(data, string_off, name_idx)
        ns = read_str(data, string_off, ns_idx)
        types.append(
            {
                "index": ti,
                "namespace": ns,
                "name": name,
                "full": f"{ns}.{name}" if ns else name,
                "methodStart": method_start,
                "methodCount": method_cnt,
                "fieldStart": field_start,
                "fieldCount": field_cnt,
            }
        )

    methods: list[dict] = []
    for mi in range(method_count):
        off = methods_off + mi * 32
        if off + 32 > len(data):
            break
        name_idx, decl_type, _, _, _, _, _, _ = struct.unpack_from("<8I", data, off)
        name = read_str(data, string_off, name_idx)
        methods.append({"index": mi, "name": name, "declaringType": decl_type})

    fields: list[dict] = []
    for fi in range(field_count):
        off = fields_off + fi * 12
        if off + 12 > len(data):
            break
        name_idx, type_idx, _ = struct.unpack_from("<3I", data, off)
        name = read_str(data, string_off, name_idx)
        fields.append({"index": fi, "name": name, "typeIndex": type_idx})

    # 按类型聚合方法/字段
    type_methods: dict[int, list] = {}
    for m in methods:
        t = m["declaringType"]
        if t < len(types):
            type_methods.setdefault(t, []).append(m)

    type_fields: dict[int, list] = {}
    for t in types:
        fs, fc = t["fieldStart"], t["fieldCount"]
        if fs == 0xFFFFFFFF or fc <= 0 or fs + fc > field_count:
            continue
        type_fields[t["index"]] = fields[fs : fs + fc]

    keywords = ["LoadBinary", "CharacterEdit", "BinaryData", "DoDownload", "loadData", "GetCharacterEdit"]
    matched_types = [t for t in types if any(k in t["name"] for k in keywords)]
    matched_methods = [m for m in methods if any(k in m["name"] for k in keywords)]

    char_edit = next((t for t in types if t["name"] == "TCharacterEditData"), None)
    # TCharacterEditData 面板字段（fieldIndex 3631+ 来自 metadata 字符串对齐）
    panel_field_names = [
        "id", "npcID", "diff", "rare", "property", "kind",
        "hpBase", "atkBase", "skillGrp", "potSkillID", "potentialID",
    ]
    panel_fields = [f for f in fields if f["name"] in panel_field_names]
    load_c = next((m for m in methods if m["name"] == "LoadBinaryDataWithCAsync"), None)
    load_parent = None
    if load_c and load_c["declaringType"] < len(types):
        load_parent = types[load_c["declaringType"]]
    # 方法名可能只在字符串堆（async 状态机），补类型条目
    if not load_c:
        async_type = next((t for t in types if t["name"] == "<LoadBinaryDataWithCAsync>d__12"), None)
        if async_type:
            # 外层类名在字符串堆紧邻 DoDownload / loadData
            load_c = {
                "index": -1,
                "name": "LoadBinaryDataWithCAsync",
                "declaringType": async_type["index"],
                "note": "compiler-generated async; 宿主类含 DoDownload/loadData（见 metadata 字符串）",
            }
            load_parent = async_type

    # 生成伪 dump.cs 片段
    lines = [
        "// 从 global-metadata v31 直接解析（无需 CodeRegistration）",
        f"// metadata version {version}",
        "",
    ]
    if char_edit:
        lines.append(f"// TypeDefIndex: {char_edit['index']}")
        lines.append("public class TCharacterEditData")
        lines.append("{")
        for f in panel_fields:
            lines.append(f"    public int {f['name']}; // fieldIndex {f['index']}")
        lines.append("}")
        lines.append("")

    for m in matched_methods:
        if m["name"] in ("LoadBinaryDataWithCAsync", "LoadBinaryDataWithoutCAsync"):
            parent = types[m["declaringType"]] if m["declaringType"] < len(types) else None
            lines.append(f"// MethodIndex: {m['index']} in {parent['full'] if parent else '?'}")
            lines.append(f"public void {m['name']}();")
            lines.append("")

    result = {
        "metadataVersion": version,
        "typeCount": len(types),
        "methodCount": len(methods),
        "fieldCount": len(fields),
        "TCharacterEditData": char_edit,
        "TCharacterEditData_fields": panel_fields,
        "LoadBinaryDataWithCAsync": load_c,
        "LoadBinaryDataWithCAsync_declaringType": load_parent,
        "matchedTypes": matched_types[:30],
        "matchedMethods": matched_methods,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_CS.write_text("\n".join(lines), encoding="utf-8")

    print(f"types={len(types)} methods={len(methods)} fields={len(fields)}")
    if load_c:
        print(f"LoadBinaryDataWithCAsync: method#{load_c['index']} in {load_parent}")
    if char_edit:
        print(f"TCharacterEditData panel fields: {[f['name'] for f in panel_fields]}")
    print(f"-> {OUT}")
    print(f"-> {OUT_CS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
