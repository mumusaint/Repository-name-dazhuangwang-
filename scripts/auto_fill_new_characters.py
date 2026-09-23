"""扫描游戏逆向数据，自动把 TenkaAssist 尚未收录的新角色写入 manual_characters.json

数据源优先级：
  1. game_character_names.json  — 游戏译名表，有名字 = 真角色（最高置信）
  2. new_character_candidates.json — catalog 有 cb+cg 资源
  3. maindata_overlay.json      — 面板数值 ATK/HP（仅用于补全属性，不用于判断是否角色）

不覆盖 manual_characters.json 中已有条目（尊重人工编辑）。
补全后需运行 parse_characters.py 合并到 characters_parsed.json。

用法：
    python scripts/auto_fill_new_characters.py            # 检查并补全
    python scripts/auto_fill_new_characters.py --dry-run   # 仅打印不写入
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARSED = ROOT / "characters_parsed.json"
MANUAL = ROOT / "data" / "manual_characters.json"
GAME_NAMES = ROOT / "data" / "game_character_names.json"
MAINDATA = ROOT / "data" / "maindata_overlay.json"
CANDIDATES = ROOT / "data" / "new_character_candidates.json"
PARSE_PY = ROOT / "parse_characters.py"


def load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def collect_known_ids() -> set[int]:
    """characters_parsed.json 已收录的角色 ID"""
    data = load_json(PARSED)
    return {c["id"] for c in data.get("data", [])}


def collect_manual_ids() -> set[int]:
    """manual_characters.json 已手动收录的 ID（不覆盖）"""
    data = load_json(MANUAL)
    return {c["id"] for c in data.get("characters", [])}


def build_candidate_pool() -> dict[int, dict]:
    """聚合所有可信源的候选角色，key=char_id"""
    pool: dict[int, dict] = {}

    # 源 1: 游戏译名表（最高置信）
    names = load_json(GAME_NAMES)
    for cid_str, entry in names.get("byId", {}).items():
        cid = int(cid_str)
        pool[cid] = {
            "nameSc": entry.get("nameSc", ""),
            "nameTc": entry.get("nameTc", ""),
            "nameEn": entry.get("nameEn", ""),
            "title": entry.get("title", ""),
            "sources": ["game_stringdata"],
            "confidence": "high",
        }

    # 源 2: catalog cb+cg 资源（high_new_id / high）
    cand = load_json(CANDIDATES)
    for row in cand.get("missing", []):
        cid = row.get("char_id")
        if cid is None:
            continue
        conf = row.get("confidence", "")
        if conf not in ("high", "high_new_id"):
            continue
        if cid not in pool:
            pool[cid] = {
                "sources": ["catalog_cb_cg"],
                "confidence": conf,
            }

    return pool


def attach_maindata_panel(entry: dict, cid: int, maindata: dict) -> None:
    """从 maindata_overlay 补全 ATK/HP 面板数值"""
    md = maindata.get("byId", {}).get(str(cid))
    if not md:
        return
    if md.get("atk") is not None:
        entry["atk"] = md["atk"]
        entry["atkSource"] = "maindata"
    if md.get("hp") is not None:
        entry["hp"] = md["hp"]
        entry["hpSource"] = "maindata"
    if md.get("atk_base") is not None:
        entry["atk_base"] = md["atk_base"]
    if md.get("hp_base") is not None:
        entry["hp_base"] = md["hp_base"]


def build_manual_entry(cid: int, info: dict) -> dict:
    """构造一个 manual_characters.json 条目"""
    entry: dict = {
        "ok": True,
        "id": cid,
        "rarity": 3,
        "nameSc": info.get("nameSc") or f"新角色·{cid}",
        "element": 0,
        "role": 0,
        "manual": True,
        "source": "auto_fill",
        "estimateOnly": True,
        "confidence": info.get("confidence", "medium"),
        "note": "自动补全，待 TenkaAssist 收录后覆盖",
    }
    for k in ("nameTc", "nameEn", "title"):
        if info.get(k):
            entry[k] = info[k]
    return entry


def run_parse_characters() -> None:
    if PARSE_PY.is_file():
        print("  刷新 characters_parsed.json …")
        subprocess.run([sys.executable, str(PARSE_PY)], cwd=str(ROOT), check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="自动补全 TenkaAssist 未收录的新角色")
    ap.add_argument("--dry-run", action="store_true", help="仅打印候选，不写入")
    args = ap.parse_args()

    if not PARSED.is_file():
        print("缺少 characters_parsed.json，请先运行 update_all_data.py --chars")
        return 1

    known = collect_known_ids()
    manual_ids = collect_manual_ids()
    pool = build_candidate_pool()
    maindata = load_json(MAINDATA)

    # 真正需要补全的：候选池中 (不在 parsed) 且 (不在 manual) 的
    to_fill = sorted(cid for cid in pool if cid not in known and cid not in manual_ids)

    print(f"已收录角色: {len(known)}")
    print(f"manual 已有: {len(manual_ids)}")
    print(f"候选池:      {len(pool)}")
    print(f"待补全:      {len(to_fill)}")

    if not to_fill:
        print("\n无新角色需要补全。当前数据已是最新。")
        return 0

    print("\n待补全角色:")
    for cid in to_fill:
        info = pool[cid]
        attach_maindata_panel(info, cid, maindata)
        entry = build_manual_entry(cid, info)
        print(f"  {cid} -> {entry.get('nameSc', '?')}"
              f" | atk={entry.get('atk', '-')}"
              f" | conf={entry.get('confidence')}")

    if args.dry_run:
        print("\n[dry-run] 未写入。去掉 --dry-run 执行实际补全。")
        return 0

    # 写入 manual_characters.json（追加，不覆盖已有）
    manual = load_json(MANUAL)
    chars = manual.get("characters", [])
    existing = {c["id"] for c in chars}
    added = 0
    for cid in to_fill:
        if cid in existing:
            continue
        info = pool[cid]
        attach_maindata_panel(info, cid, maindata)
        chars.append(build_manual_entry(cid, info))
        existing.add(cid)
        added += 1

    manual["characters"] = sorted(chars, key=lambda c: c["id"])
    manual["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    MANUAL.parent.mkdir(parents=True, exist_ok=True)
    MANUAL.write_text(json.dumps(manual, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n已追加 {added} 个新角色到 {MANUAL}")

    # 刷新 characters_parsed.json
    run_parse_characters()
    print("完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
