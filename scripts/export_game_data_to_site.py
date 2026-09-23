"""将 scripts/game_dump 成果导出为打桩网前端 data/*.json

用法（项目根目录）：
    python scripts/export_game_data_to_site.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUMP = ROOT / "scripts" / "game_dump"
DATA = ROOT / "data"

SRC_MAIN = DUMP / "extracted" / "characters_maindata.json"
SRC_NAMES = DUMP / "extracted" / "character_names_from_game.json"
SRC_MISSING = DUMP / "index" / "missing_characters.json"
SRC_DUMP = DUMP / "il2cpp_dump" / "dump.cs"
OUT_OVERLAY = DATA / "maindata_overlay.json"
OUT_NAMES = DATA / "game_character_names.json"
OUT_NEW = DATA / "new_character_candidates.json"
OUT_STATUS = DATA / "game_data_status.json"
OUT_OVERRIDES = DATA / "character_name_overrides.json"
OUT_STAGE = DATA / "stage_overlay.json"

# 游戏 EProp: Fire=1 … Dark=5；TenkaAssist element: 0=火 … 4=暗
GAME_PROP_TO_ELEMENT = {
    1: ("火", 0),
    2: ("水", 1),
    3: ("风", 2),
    4: ("光", 3),
    5: ("暗", 4),
    6: ("暗", 4),  # 部分表项为 6，与 Tenka 暗属性一致
    7: ("暗", 4),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_maindata_overlay() -> dict | None:
    script = ROOT / "scripts" / "export_maindata_overlay.py"
    if not script.is_file():
        return None
    subprocess.run([sys.executable, str(script)], cwd=str(ROOT), check=False)
    if OUT_OVERLAY.is_file():
        return json.loads(OUT_OVERLAY.read_text(encoding="utf-8"))
    return None


def run_stage_overlay() -> dict | None:
    script = ROOT / "scripts" / "parse_stage_data.py"
    if not script.is_file():
        return None
    subprocess.run([sys.executable, str(script)], cwd=str(ROOT), check=False)
    if OUT_STAGE.is_file():
        return json.loads(OUT_STAGE.read_text(encoding="utf-8"))
    return None


def export_game_names() -> dict:
    if not SRC_NAMES.is_file():
        return {"byId": {}, "summary": {"mapped": 0}}

    raw = json.loads(SRC_NAMES.read_text(encoding="utf-8"))
    by_id: dict[str, dict] = {}
    for sid, row in (raw.get("by_id") or {}).items():
        entry = {"id": int(sid)}
        if row.get("game_nameSc") or row.get("nameSc"):
            entry["nameSc"] = row.get("game_nameSc") or row.get("nameSc")
        if row.get("nameEn"):
            entry["nameEn"] = row["nameEn"]
        if row.get("nameTc"):
            entry["nameTc"] = row["nameTc"]
        if row.get("title"):
            entry["title"] = row["title"]
        if row.get("sources"):
            entry["sources"] = row["sources"]
        by_id[sid] = entry

    payload = {
        "source": raw.get("source", "stringdata / CharacterStr"),
        "updated": utc_now(),
        "summary": {
            "mapped": len(by_id),
            **(raw.get("summary") or {}),
        },
        "byId": by_id,
    }
    OUT_NAMES.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def export_new_candidates() -> dict:
    if not SRC_MISSING.is_file():
        return {"missing": [], "summary": {"missing_candidates": 0}}

    raw = json.loads(SRC_MISSING.read_text(encoding="utf-8"))
    missing = list(raw.get("missing") or [])
    # 优先 high_new_id / high
    order = {"high_new_id": 0, "high": 1, "medium": 2, "low": 3}
    missing.sort(
        key=lambda x: (
            order.get(x.get("confidence", "low"), 9),
            -(x.get("catalog_bundles") or 0),
            x.get("char_id") or 0,
        )
    )
    payload = {
        "source": "scripts/game_dump/index/missing_characters.json",
        "updated": utc_now(),
        "summary": raw.get("summary") or {},
        "missing": missing[:120],
    }
    OUT_NEW.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def merge_name_overrides(game_names: dict, maindata: dict | None) -> int:
    """把游戏 stringdata 译名写入 character_name_overrides（不覆盖已有手工项）。"""
    existing: dict = {"overrides": []}
    if OUT_OVERRIDES.is_file():
        existing = json.loads(OUT_OVERRIDES.read_text(encoding="utf-8"))
    by_id = {int(o["id"]): o for o in existing.get("overrides", []) if o.get("id") is not None}
    added = 0

    for sid, row in (game_names.get("byId") or {}).items():
        cid = int(sid)
        cur = by_id.get(cid, {"id": cid})
        changed = False
        if row.get("nameSc") and not cur.get("nameSc"):
            cur["nameSc"] = row["nameSc"]
            cur["nameSource"] = "game_stringdata"
            changed = True
        if row.get("title") and not cur.get("title"):
            cur["title"] = row["title"]
            changed = True
        if row.get("nameEn") and not cur.get("nameEn"):
            cur["nameEn"] = row["nameEn"]
            changed = True
        if changed:
            by_id[cid] = cur
            added += 1

    if maindata:
        for sid, row in (maindata.get("byId") or {}).items():
            prop = row.get("property")
            if prop is None:
                continue
            cid = int(sid)
            cur = by_id.get(cid, {"id": cid})
            if cur.get("gameProperty") is not None:
                continue
            cur["gameProperty"] = prop
            info = GAME_PROP_TO_ELEMENT.get(int(prop))
            if info:
                cur["gameElementName"] = info[0]
            by_id[cid] = cur

    payload = {
        "updated": utc_now(),
        "note": "game_stringdata 自动合并；手工条目保留优先",
        "overrides": sorted(by_id.values(), key=lambda x: x["id"]),
    }
    OUT_OVERRIDES.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return added


def export_status(
    maindata: dict | None,
    game_names: dict,
    new_cands: dict,
    stage: dict | None = None,
) -> dict:
    dump_ok = SRC_DUMP.is_file()
    dump_size = SRC_DUMP.stat().st_size if dump_ok else 0
    md_sum = (maindata or {}).get("summary") or {}
    payload = {
        "updated": utc_now(),
        "il2cpp_dump": {
            "ok": dump_ok,
            "path": "scripts/game_dump/il2cpp_dump/dump.cs",
            "size_bytes": dump_size,
            "key_classes": [
                "TCharData (hpBase/atkBase)",
                "TPlayerChar (GetHp/GetAtk)",
                "TStageData (battleLevel/battleRare)",
                "BattleCalculator (GetDamageValue)",
                "BattleSys (SetEnemyCharData)",
            ],
            "note": "精确打桩仍用 TenkaAssist calculator.v3.js；dump.cs 供研究与后续对齐",
        },
        "maindata": {
            "overlay_count": md_sum.get("overlay_count", 0),
            "atk_from_maindata": md_sum.get("atk_from_maindata", 0),
            "hp_from_maindata": md_sum.get("hp_from_maindata", 0),
            "formula": (maindata or {}).get("formula"),
            "parse_status": (maindata or {}).get("parse_status"),
        },
        "game_names": {
            "mapped": (game_names.get("summary") or {}).get("mapped", 0),
        },
        "new_characters": {
            "candidates": (new_cands.get("summary") or {}).get("missing_candidates", 0),
            "high_new_id": (new_cands.get("summary") or {}).get("high_new_id", 0),
        },
        "stages": {
            "parsed": (stage or {}).get("summary", {}).get("by_id_total", 0),
            "battle_level_max": (stage or {}).get("summary", {}).get("battle_level_max"),
            "note": "TStageData battleLevel/battleRare（启发式，供 Boss 页参考）",
        },
    }
    OUT_STATUS.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    print("导出游戏数据 → data/")
    maindata = run_maindata_overlay()
    stage = run_stage_overlay()
    game_names = export_game_names()
    new_cands = export_new_candidates()
    n_override = merge_name_overrides(game_names, maindata)
    status = export_status(maindata, game_names, new_cands, stage)

    print(f"  maindata_overlay: {OUT_OVERLAY.name} ({status['maindata'].get('overlay_count', 0)} 角色)")
    print(f"  stage_overlay: {OUT_STAGE.name} ({status['stages'].get('parsed', 0)} 关卡)")
    print(f"  game_character_names: {len(game_names.get('byId', {}))} 条")
    print(f"  new_character_candidates: {len(new_cands.get('missing', []))} 条（展示用截断）")
    print(f"  character_name_overrides: 新增/更新 {n_override} 条")
    print(f"  game_data_status: Il2Cpp={'OK' if status['il2cpp_dump']['ok'] else '缺失'}")
    print("\n建议接着运行: python parse_characters.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
