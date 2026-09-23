"""对比 catalog / 本地 bundle 与 characters_parsed.json，找出可能的新角色 ID"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DUMP = Path(__file__).parent / "game_dump"
CATALOG = DUMP / "catalog_2020.12.07.07.50.36.json"
MANIFEST = DUMP / "bundle_manifest.txt"
CHARS = BASE / "characters_parsed.json"
OUT_DIR = DUMP / "index"

CHAR_BUNDLE_RE = re.compile(r"^(cg|cb|scg|cgpack)(\d{5})", re.I)
SOUND_RE = re.compile(r"^sound(\d{5,7})_([a-z]{2})", re.I)
MIN_CHAR_ID = 10000


def parse_bundle_name(name: str) -> dict:
    info = {"kind": None, "char_id": None}
    m = CHAR_BUNDLE_RE.match(name.split("_")[0] if "_" in name else name.replace(".bundle", ""))
    if not m:
        base = name.replace(".bundle", "")
        m = CHAR_BUNDLE_RE.match(base)
    if m:
        info["kind"] = m.group(1).lower()
        info["char_id"] = int(m.group(2))
        return info
    m = SOUND_RE.match(name.replace(".bundle", ""))
    if m:
        info["kind"] = "sound"
        info["char_id"] = int(m.group(1))
    return info


def load_known_ids() -> tuple[set[int], dict[int, dict]]:
    data = json.loads(CHARS.read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in data["data"]}
    return set(by_id), by_id


def scan_sources() -> dict[int, dict]:
    """聚合 catalog + 本地 manifest 中出现的 char_id"""
    agg: dict[int, dict] = defaultdict(
        lambda: {
            "kinds": set(),
            "catalog_files": [],
            "local_files": [],
            "sound_locales": set(),
        }
    )

    def add(source: str, filename: str) -> None:
        info = parse_bundle_name(filename)
        cid = info.get("char_id")
        if cid is None:
            return
        row = agg[cid]
        kind = info.get("kind")
        if kind:
            row["kinds"].add(kind)
        if kind == "sound":
            m = SOUND_RE.match(filename.replace(".bundle", ""))
            if m:
                row["sound_locales"].add(m.group(2))
        key = "catalog_files" if source == "catalog" else "local_files"
        if filename not in row[key]:
            row[key].append(filename)

    if CATALOG.exists():
        cat = json.loads(CATALOG.read_text(encoding="utf-8"))
        for item in cat.get("m_InternalIds", []):
            if isinstance(item, str):
                add("catalog", item.rsplit("/", 1)[-1])

    if MANIFEST.exists():
        for line in MANIFEST.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("count="):
                continue
            add("local", line.split("\t")[0].strip())

    return agg


def confidence(row: dict, cid: int, max_known: int) -> str:
    kinds = row["kinds"]
    has_cb = "cb" in kinds
    has_cg = "cg" in kinds or "scg" in kinds or "cgpack" in kinds
    if has_cb and has_cg:
        if cid > max_known:
            return "high_new_id"
        return "high"
    if has_cb:
        return "medium"
    if has_cg or "scg" in kinds:
        return "low_skin_or_cg_only"
    return "low"


def build_report(agg: dict[int, dict], known: set[int], known_by_id: dict[int, dict]) -> list[dict]:
    max_known = max(known) if known else 0
    rows: list[dict] = []
    for cid in sorted(agg):
        if cid < MIN_CHAR_ID or cid in known:
            continue
        row = agg[cid]
        kinds = sorted(row["kinds"])
        conf = confidence(row, cid, max_known)
        if conf.startswith("low") and "cb" not in row["kinds"]:
            continue
        rows.append(
            {
                "char_id": cid,
                "confidence": conf,
                "kinds": kinds,
                "has_cb": "cb" in row["kinds"],
                "has_cg": any(k in row["kinds"] for k in ("cg", "scg", "cgpack")),
                "catalog_bundles": len(row["catalog_files"]),
                "local_bundles": len(row["local_files"]),
                "sound_locales": sorted(row["sound_locales"]),
                "sample_files": (row["catalog_files"][:3] or row["local_files"][:3]),
                "note": (
                    "ID 大于当前库最大 ID，较可能是新角色"
                    if cid > max_known
                    else "有 cb 资源但未入库，可能是新角色或换皮"
                ),
            }
        )
    order = {"high_new_id": 0, "high": 1, "medium": 2, "low_skin_or_cg_only": 3, "low": 4}
    rows.sort(key=lambda r: (order.get(r["confidence"], 9), -r["char_id"]))
    return rows


def main() -> int:
    if not CHARS.exists():
        print("缺少 characters_parsed.json")
        return 1
    if not CATALOG.exists() and not MANIFEST.exists():
        print("缺少 catalog 或 bundle_manifest，请先运行 extract_bundle_index 相关步骤")
        return 1

    known, known_by_id = load_known_ids()
    agg = scan_sources()
    missing = build_report(agg, known, known_by_id)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_json = OUT_DIR / "missing_characters.json"
    out_csv = OUT_DIR / "missing_characters.csv"

    summary = {
        "known_characters": len(known),
        "known_max_id": max(known),
        "catalog_char_ids_ge_10000": sum(1 for i in agg if i >= MIN_CHAR_ID),
        "missing_candidates": len(missing),
        "high_new_id": sum(1 for r in missing if r["confidence"] == "high_new_id"),
        "high": sum(1 for r in missing if r["confidence"] == "high"),
        "medium": sum(1 for r in missing if r["confidence"] == "medium"),
        "note": "confidence=high 需同时有 cb+cg；high_new_id 表示 ID 超过 characters_parsed 最大 ID",
    }

    payload = {"summary": summary, "missing": missing}
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    fields = [
        "char_id", "confidence", "kinds", "has_cb", "has_cg",
        "catalog_bundles", "local_bundles", "sound_locales", "note", "sample_files",
    ]
    with out_csv.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in missing:
            row = dict(r)
            row["kinds"] = ",".join(r["kinds"])
            row["sound_locales"] = ",".join(r["sound_locales"])
            row["sample_files"] = " | ".join(r["sample_files"])
            w.writerow(row)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n候选新角色 {len(missing)} 个（已过滤无 cb 的低置信条目）")
    if missing:
        print("\n优先关注（ID > 当前最大已知 ID 且有 cb+cg）：")
        for r in missing:
            if r["confidence"] == "high_new_id":
                print(f"  {r['char_id']}  kinds={r['kinds']}  {r['sample_files'][0]}")
        print("\n其余高置信（有 cb+cg）：")
        shown = 0
        for r in missing:
            if r["confidence"] == "high" and shown < 15:
                print(f"  {r['char_id']}  kinds={r['kinds']}")
                shown += 1
        if shown == 15:
            print("  …")
    print(f"\n完整列表: {out_json}")
    print(f"CSV: {out_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
