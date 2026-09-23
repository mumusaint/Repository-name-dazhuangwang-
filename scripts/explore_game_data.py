"""梳理游戏内数据文件结构，并生成可读索引（直接从 catalog / metadata / bundle）"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUMP = Path(__file__).parent / "game_dump"
CATALOG = DUMP / "catalog_2020.12.07.07.50.36.json"
META = DUMP / "apk" / "global-metadata.decrypted.dat"
OUT = DUMP / "game_data_index.json"

GAME_TYPES = (
    "Character", "Chara", "Skill", "Gacha", "Stage", "Battle",
    "Femdom", "Kizuna", "Partner", "Monster", "Item",
)

TABLE_PREFIXES = (
    "Assets/ResourcesBuild/binarydata/maindata/",
    "Assets/ResourcesBuild/binarydata/stringdata/",
)


def load_catalog_tables() -> dict:
    if not CATALOG.exists():
        return {}
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    ids = cat.get("m_InternalIds", [])
    maindata: list[str] = []
    stringdata: list[str] = []
    bundles: list[str] = []
    for x in ids:
        if not isinstance(x, str):
            continue
        if x.startswith(TABLE_PREFIXES[0]):
            maindata.append(x[len(TABLE_PREFIXES[0]) :])
        elif x.startswith(TABLE_PREFIXES[1]):
            stringdata.append(x[len(TABLE_PREFIXES[1]) :])
        elif "bundle" in x and ("http" in x or x.endswith(".bundle")):
            bundles.append(x.rsplit("/", 1)[-1])

    core = {}
    for name, key in {
        "maindata_bundle": "maindata_assets_all_f2db6548fb88ee11b504cbec631565c7.bundle",
        "stringdata_bundle": "stringdata_assets_all_530cf137327847642a223918c977abdc.bundle",
    }.items():
        for b in bundles:
            if key in b:
                core[name] = b
                break

    return {
        "maindata_tables": sorted(maindata),
        "stringdata_tables": sorted(stringdata),
        "core_bundles": core,
        "bundle_count": len(bundles),
    }


def load_metadata_types() -> list[str]:
    if not META.exists():
        return []
    data = META.read_bytes()
    pat = re.compile(
        rb"T(?:Character|Skill|Team|Gacha|Battle|Stage|Trigger|SkillEffect|SkillGrp)[A-Za-z0-9_]*"
        rb"|(?:Get|Set|Load)(?:Character|Skill)[A-Za-z0-9_]*"
    )
    return sorted(set(m.group().decode("ascii", "ignore") for m in pat.finditer(data)))


def main() -> int:
    tables = load_catalog_tables()
    types = load_metadata_types()

    index = {
        "summary": {
            "角色面板数值": "maindata/Character_C.bytes：61B 流式记录，atk=atk_base×442.8826（251/389）；hp=hp_base×44.422（部分需 LvUp/RankUp 倍率）",
            "角色中英文名": "stringdata/CharacterStr_sc.bytes 等（在 stringdata.bundle 内，可部分明文提取）",
            "技能数据": "maindata/Skill_C.bytes, SkillGroup.bytes, SkillEffect.bytes（同 bundle，C 混淆）",
            "立绘资源": "cb/cg/scg{ID}_*.bundle（单独下载，UnityCN 加密）",
            "配队伤害": "不在客户端静态表，TenkaAssist 为社区上传数据",
        },
        "key_files": {
            "CharacterEdit.bytes": "v2 schema：u16,u8,s32,s32,s8,u16,bool,s64（面板字段类型）",
            "Character_C.bytes": "角色主表（2932 字节头 + 行数据，含 hpBase/atkBase 等）",
            "CharacterStr_sc.bytes": "简中名称/描述",
            "CharacterStr_tc.bytes": "繁中名称",
            "Skill_C.bytes": "技能主表（~1.5MB，C 混淆）",
            "SkillGroup.bytes": "技能组",
            "SkillStr_sc.bytes": "技能简中文本",
        },
        "maindata_unpack": {
            "bundle": "scripts/game_dump/bundles/maindata.bundle",
            "unitycn": "去掉首字节 0xe8 后 UnityPy 可解包 109 个 TextAsset",
            "c_xor_key": "0x279BB3ED（零值占位；非零整型部分 plain 部分 XOR）",
            "parser": "python scripts/parse_maindata_tables.py",
            "outputs": [
                "scripts/game_dump/extracted/maindata_raw/*.bin",
                "scripts/game_dump/extracted/characters_maindata.json",
                "scripts/game_dump/extracted/character_edit_schema.json",
            ],
        },
        "catalog": tables,
        "il2cpp_types": types,
        "workflow": [
            "1. python scripts/pull_game_bundles.py          # 从 MuMu 拉 maindata + stringdata",
            "2. python scripts/parse_maindata_tables.py      # 解包 maindata.bundle → .bin + 扫描 Character_C",
            "3. python scripts/extract_game_strings.py       # 从 stringdata 提取可读文本",
            "4. python scripts/find_new_character_ids.py     # catalog 对比新角色 ID",
            "5. python scripts/analyze_maindata.py           # 逆向辅助：字段探测 / stride 分析",
        ],
        "device_paths": {
            "bundles": "/storage/emulated/0/Android/data/com.pinkcore.tkfm/files/data/",
            "catalog": "assets/aa/catalog.json（APK 内）",
        },
    }

    OUT.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(index["summary"], ensure_ascii=False, indent=2))
    print(f"\nmaindata 表 {len(tables.get('maindata_tables', []))} 个")
    print(f"stringdata 表 {len(tables.get('stringdata_tables', []))} 个")
    print(f"il2cpp 相关类型 {len(types)} 个")
    print(f"\n完整索引 -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
