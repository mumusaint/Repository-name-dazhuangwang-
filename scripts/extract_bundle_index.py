"""索引天下布魔资源包：catalog 全库 + 手机已下载 bundle 清单 + 文件名解析"""
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path(__file__).parent.parent
DUMP = Path(__file__).parent / "game_dump"
CATALOG = DUMP / "catalog_2020.12.07.07.50.36.json"
MANIFEST = DUMP / "bundle_manifest.txt"
OUT_DIR = DUMP / "index"


def load_catalog():
    if not CATALOG.exists():
        return []
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    rows = []
    for item in data.get("m_InternalIds", []):
        if not isinstance(item, str):
            continue
        name = item.rsplit("/", 1)[-1] if "/" in item else item
        rows.append({"source": "catalog", "url_or_name": item, "filename": name, **parse_filename(name)})
    return rows


def load_local_manifest():
    if not MANIFEST.exists():
        return []
    rows = []
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("count="):
            continue
        parts = line.split("\t")
        name = parts[0].strip()
        size = int(parts[1]) if len(parts) > 1 and parts[1].strip().isdigit() else 0
        rows.append({"source": "local", "filename": name, "size": size, **parse_filename(name)})
    return rows


def parse_filename(name: str) -> dict:
    info = {"kind": "other", "char_id": None, "locale": None, "hash": None}
    if not name.endswith(".bundle"):
        info["kind"] = "non_bundle"
        return info

    base = name[:-7]
    m_hash = re.search(r"_([0-9a-f]{32})\.bundle$", name)
    if m_hash:
        info["hash"] = m_hash.group(1)
        base = name[: m_hash.start()]

    # cg10161 / cb10108 / scg10919 / sound1010801_jp / cf_1120_tc / bgm7
    m = re.match(r"^(cg|cb|scg|cgpack)(\d{5})", base, re.I)
    if m:
        info["kind"] = m.group(1).lower()
        info["char_id"] = int(m.group(2))
        return info

    m = re.match(r"^sound(\d{5,7})_([a-z]{2})", base, re.I)
    if m:
        info["kind"] = "sound"
        info["char_id"] = int(m.group(1))
        info["locale"] = m.group(2)
        return info

    m = re.match(r"^cf_(\d+)_([a-z]{2})", base, re.I)
    if m:
        info["kind"] = "cf"
        info["char_id"] = int(m.group(1))
        info["locale"] = m.group(2)
        return info

    m = re.match(r"^(bgm|battlebg|homespcbg|emap|ev|ls|ln|hp|cfgroup|lsgroup|2025map|20251210)", base, re.I)
    if m:
        info["kind"] = m.group(1).lower()
        return info

    if base.startswith("sound"):
        info["kind"] = "sound"
    return info


def attach_char_names(rows):
    char_file = BASE / "characters_parsed.json"
    by_id = {}
    if char_file.exists():
        data = json.loads(char_file.read_text(encoding="utf-8"))
        by_id = {c["id"]: c.get("nameSc") or c.get("name") for c in data["data"]}
    for r in rows:
        cid = r.get("char_id")
        r["char_name"] = by_id.get(cid) if cid else None
    return rows


def write_outputs(catalog_rows, local_rows):
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # summary
    local_kinds = Counter(r["kind"] for r in local_rows)
    catalog_kinds = Counter(r["kind"] for r in catalog_rows if r.get("filename", "").endswith(".bundle"))

    summary = {
        "catalog_entries": len(catalog_rows),
        "local_bundles": len(local_rows),
        "local_by_kind": dict(local_kinds.most_common()),
        "catalog_bundle_by_kind": dict(catalog_kinds.most_common(40)),
        "note": "bundle 立绘等仍为 UnityCN；maindata 去掉首字节 0xe8 后可 UnityPy 解包数值表",
    }
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    fields = ["source", "filename", "kind", "char_id", "char_name", "locale", "hash", "size", "url_or_name"]

    for name, rows in [("catalog_all", catalog_rows), ("local_bundles", local_rows)]:
        path = OUT_DIR / f"{name}.csv"
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    # 按角色聚合本地资源
    by_char = defaultdict(list)
    for r in local_rows:
        if r.get("char_id"):
            by_char[r["char_id"]].append(r)

    char_index = []
    for cid in sorted(by_char):
        kinds = Counter(x["kind"] for x in by_char[cid])
        char_index.append({
            "char_id": cid,
            "char_name": by_char[cid][0].get("char_name"),
            "files": len(by_char[cid]),
            "kinds": dict(kinds),
            "filenames": [x["filename"] for x in by_char[cid]],
        })
    (OUT_DIR / "local_by_character.json").write_text(
        json.dumps(char_index, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"输出目录: {OUT_DIR}")


def main():
    catalog_rows = attach_char_names(load_catalog())
    local_rows = attach_char_names(load_local_manifest())
    write_outputs(catalog_rows, local_rows)


if __name__ == "__main__":
    main()
