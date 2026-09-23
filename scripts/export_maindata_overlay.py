"""将 characters_maindata.json 导出为前端可用的 data/maindata_overlay.json

用法（项目根目录）：
    python scripts/export_maindata_overlay.py
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "game_dump" / "extracted" / "characters_maindata.json"
OUT = ROOT / "data" / "maindata_overlay.json"

K_HP = 44.422
K_ATK = 442.8826


def resolve_panel(row: dict) -> dict | None:
    """合并 maindata 解析结果与 TenkaAssist 参考值，供前端覆盖 hp/atk。"""
    status = row.get("parse_status")
    if status == "not_found":
        return None

    hp = row.get("hp")
    atk = row.get("atk")
    hp_ref = row.get("hp_panel_ref")
    atk_ref = row.get("atk_panel_ref")
    out: dict = {"parse_status": status}

    if status in ("ok", "atk_ok") and atk is not None:
        out["atk"] = atk
        out["atkSource"] = "maindata"
    elif status == "base_only" and atk is not None:
        if atk_ref is None or abs(atk - atk_ref) <= 1:
            out["atk"] = atk
            out["atkSource"] = "maindata"

    if status == "ok" and hp is not None:
        out["hp"] = hp
        out["hpSource"] = "maindata"
    elif hp_ref is not None:
        out["hp"] = hp_ref
        out["hpSource"] = "tenka_ref"

    if "hp" not in out and "atk" not in out:
        return None
    if row.get("cd") is not None:
        out["cd"] = row["cd"]
    elif row.get("cd_ref") is not None:
        out["cd"] = row["cd_ref"]
    if row.get("hp_base") is not None:
        out["hp_base"] = row["hp_base"]
    if row.get("atk_base") is not None:
        out["atk_base"] = row["atk_base"]
    if row.get("hp_scale") is not None:
        out["hp_scale"] = row["hp_scale"]
    if row.get("property") is not None:
        out["property"] = row["property"]
    if row.get("note"):
        out["note"] = row["note"]
    return out


def main() -> int:
    if not SRC.is_file():
        print(f"跳过：未找到 {SRC}")
        print("请先运行 python scripts/parse_maindata_tables.py（需 maindata.bundle）")
        return 1

    raw = json.loads(SRC.read_text(encoding="utf-8"))
    by_id: dict[str, dict] = {}
    counts = {"ok": 0, "atk_ok": 0, "base_only": 0, "other": 0}

    for row in raw.get("characters", []):
        cid = row.get("id")
        if cid is None:
            continue
        panel = resolve_panel(row)
        if not panel:
            continue
        by_id[str(cid)] = panel
        st = panel.get("parse_status", "other")
        if st in counts:
            counts[st] += 1
        else:
            counts["other"] += 1

    payload = {
        "source": raw.get("source", "maindata.bundle / Character_C.bytes"),
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "formula": raw.get("formula", {"k_hp": K_HP, "k_atk": K_ATK}),
        "parse_status": raw.get("parse_status", {}),
        "summary": {
            "overlay_count": len(by_id),
            "hp_from_maindata": sum(1 for v in by_id.values() if v.get("hpSource") == "maindata"),
            "atk_from_maindata": sum(1 for v in by_id.values() if v.get("atkSource") == "maindata"),
            "by_status": counts,
        },
        "byId": by_id,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    s = payload["summary"]
    print(f"已写入 {OUT}")
    print(
        f"  覆盖 {s['overlay_count']} 角色 | "
        f"HP maindata {s['hp_from_maindata']} | ATK maindata {s['atk_from_maindata']} | "
        f"ok={counts['ok']} atk_ok={counts['atk_ok']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
