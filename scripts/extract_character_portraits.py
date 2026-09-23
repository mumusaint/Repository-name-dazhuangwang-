"""从游戏 bundle 提取新角色立绘（charpics / cb）→ assets/images/new-characters/

用法（项目根目录）：
    python scripts/extract_character_portraits.py
    python scripts/extract_character_portraits.py --ids 12011 10941
    python scripts/extract_character_portraits.py --pull-only

优先 MuMu 已下载 bundle；否则尝试 catalog CDN。charpics 包内纹理名为 cs{ID}_0_0；
cb 包内为 {ID} 全图（1024²），作头像备用。
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import UnityPy
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent
DUMP = SCRIPTS / "game_dump"
BUNDLE_DIR = DUMP / "bundles"
CATALOG = DUMP / "index" / "catalog_all.csv"
MANUAL = ROOT / "data" / "manual_characters.json"
OUT_DIR = ROOT / "assets" / "images" / "new-characters"
MANIFEST = ROOT / "data" / "character_images.json"

MUMU_ADB = Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe")
DEVICE = "127.0.0.1:16384"
REMOTE_DIR = "/storage/emulated/0/Android/data/com.pinkcore.tkfm/files/data"
CDN = "http://file.sg-arts.com/bundle/tkfm/development/Android"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def strip_unitycn(raw: bytes) -> bytes:
    if len(raw) > 8 and raw[1:8] == b"UnityFS":
        return raw[1:]
    return raw


def load_unity_env(path: Path):
    raw = path.read_bytes()
    dec = strip_unitycn(raw)
    tmp = path.with_suffix(".noenc.bundle")
    tmp.write_bytes(dec)
    return UnityPy.load(str(tmp))


def adb(*args: str) -> str:
    r = subprocess.run(
        [str(MUMU_ADB), "-s", DEVICE, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return (r.stdout or "") + (r.stderr or "")


def remote_has(fname: str) -> bool:
    out = adb("shell", f"ls {REMOTE_DIR}/{fname} 2>/dev/null")
    return fname in out and "No such file" not in out


def pull_remote(fname: str, local: Path) -> bool:
    local.parent.mkdir(parents=True, exist_ok=True)
    if local.is_file() and local.stat().st_size > 0:
        return True
    if not MUMU_ADB.is_file():
        return False
    if not remote_has(fname):
        return False
    adb("pull", f"{REMOTE_DIR}/{fname}", str(local))
    return local.is_file() and local.stat().st_size > 0


def download_url(url: str, local: Path) -> bool:
    local.parent.mkdir(parents=True, exist_ok=True)
    if local.is_file() and local.stat().st_size > 0:
        return True
    try:
        urllib.request.urlretrieve(url, local)
        return local.stat().st_size > 0
    except (urllib.error.URLError, OSError) as e:
        print(f"  CDN 失败 {local.name}: {e}")
        return False


def load_catalog_index() -> dict:
    bundles: dict[str, dict] = {}
    charpics_group: dict[int, str] = {}
    cb_bundle: dict[int, str] = {}

    if not CATALOG.is_file():
        return {"bundles": bundles, "charpics_group": charpics_group, "cb_bundle": cb_bundle}

    with CATALOG.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            fn = row.get("filename") or ""
            url = row.get("url_or_name") or ""
            if fn.endswith(".bundle"):
                bundles[fn] = {
                    "filename": fn,
                    "url": url if url.startswith("http") else f"{CDN}/{fn}",
                    "kind": row.get("kind"),
                    "char_id": row.get("char_id"),
                }
                cid = row.get("char_id")
                if cid and fn.startswith(f"cb{int(cid):05d}_"):
                    cb_bundle[int(cid)] = fn
                if "charpics" in fn and fn.endswith(".bundle"):
                    m = re.match(r"charpics(\w+)_assets", fn)
                    if m:
                        bundles[fn]["group"] = m.group(1)

            m = re.search(r"charpics/charpics(\w+)/cs(\d{5})_0_0\.png", url.replace("\\", "/"))
            if m:
                charpics_group[int(m.group(2))] = m.group(1)

    return {"bundles": bundles, "charpics_group": charpics_group, "cb_bundle": cb_bundle}


def charpics_bundle_name(group: str, bundles: dict[str, dict]) -> str | None:
    prefix = f"charpics{group}_assets_all_"
    for fn in bundles:
        if fn.startswith(prefix):
            return fn
    return None


def acquire_bundle(fname: str, meta: dict) -> Path | None:
    local = BUNDLE_DIR / fname.replace(".bundle", ".bundle")
    if local.is_file() and local.stat().st_size > 0:
        return local
    if pull_remote(fname, local):
        print(f"  [MuMu] {fname}")
        return local
    url = meta.get("url") or f"{CDN}/{fname}"
    if download_url(url, local):
        print(f"  [CDN] {fname}")
        return local
    return None


def texture_to_image(tex) -> Image.Image:
    img = tex.image
    if hasattr(img, "convert"):
        return img.convert("RGBA")
    return Image.open(BytesIO(img)).convert("RGBA")


def save_portrait(img: Image.Image, char_id: int, source: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"cs{char_id}_0_0.webp"
    # 与 TenkaAssist 头像比例接近（256×512）
    w, h = img.size
    if h > w * 1.2:
        target = (256, 512)
    else:
        target = (256, 256)
    img = img.resize(target, Image.Resampling.LANCZOS)
    img.save(out, "WEBP", quality=88, method=6)
    return out


def extract_from_charpics(bundle_path: Path, char_id: int) -> Image.Image | None:
    env = load_unity_env(bundle_path)
    want = f"cs{char_id}_0_0"
    for obj in env.objects:
        if obj.type.name != "Texture2D":
            continue
        data = obj.read()
        if data.m_Name == want:
            return texture_to_image(data)
    return None


def extract_from_cb(bundle_path: Path, char_id: int) -> Image.Image | None:
    env = load_unity_env(bundle_path)
    names = [str(char_id), f"{char_id}"]
    best = None
    best_area = 0
    for obj in env.objects:
        if obj.type.name != "Texture2D":
            continue
        data = obj.read()
        name = data.m_Name or ""
        if name in names or name == str(char_id):
            return texture_to_image(data)
        if name.lower() in ("mosaic", "noise"):
            continue
        area = data.m_Width * data.m_Height
        if area > best_area and data.m_Width >= 256:
            best_area = area
            best = data
    if best:
        return texture_to_image(best)
    return None


def load_target_ids(explicit: list[int] | None) -> list[int]:
    if explicit:
        return explicit
    if not MANUAL.is_file():
        return []
    raw = json.loads(MANUAL.read_text(encoding="utf-8"))
    return [int(c["id"]) for c in raw.get("characters", []) if c.get("id")]


def process_char(char_id: int, idx: dict) -> dict | None:
    bundles = idx["bundles"]
    group = idx["charpics_group"].get(char_id)
    cb_fname = idx["cb_bundle"].get(char_id)

    img = None
    source = None
    bundle_used = None

    if group:
        bname = charpics_bundle_name(group, bundles)
        if bname:
            path = acquire_bundle(bname, bundles[bname])
            if path:
                img = extract_from_charpics(path, char_id)
                if img:
                    source = "charpics"
                    bundle_used = bname

    if img is None and cb_fname and cb_fname in bundles:
        path = acquire_bundle(cb_fname, bundles[cb_fname])
        if path:
            img = extract_from_cb(path, char_id)
            if img:
                source = "cb"
                bundle_used = cb_fname

    if img is None:
        print(f"  [-] {char_id}: 无可用立绘")
        return None

    out = save_portrait(img, char_id, source or "")
    print(f"  [+] {char_id}: {out.name} ({source}, {bundle_used})")
    return {
        "id": char_id,
        "path": str(out.relative_to(ROOT)).replace("\\", "/"),
        "source": source,
        "bundle": bundle_used,
    }


def write_manifest(entries: list[dict]) -> None:
    by_id = {str(e["id"]): e for e in entries}
    payload = {
        "updated": utc_now(),
        "note": "本地提取的游戏立绘；前端 charImageUrl 优先使用",
        "count": len(entries),
        "byId": by_id,
    }
    MANIFEST.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="提取新角色立绘")
    ap.add_argument("--ids", nargs="*", type=int, help="指定角色 ID，默认 manual_characters.json")
    ap.add_argument("--pull-only", action="store_true", help="仅拉 bundle 不解图")
    args = ap.parse_args()

    ids = load_target_ids(args.ids)
    if not ids:
        print("无目标角色 ID")
        return 1

    idx = load_catalog_index()
    print(f"目标 {len(ids)} 个角色: {ids}")

    if args.pull_only:
        for cid in ids:
            group = idx["charpics_group"].get(cid)
            if group:
                bname = charpics_bundle_name(group, idx["bundles"])
                if bname:
                    acquire_bundle(bname, idx["bundles"][bname])
            cb = idx["cb_bundle"].get(cid)
            if cb:
                acquire_bundle(cb, idx["bundles"][cb])
        return 0

    entries: list[dict] = []
    existing = {}
    if MANIFEST.is_file():
        existing = json.loads(MANIFEST.read_text(encoding="utf-8")).get("byId", {})

    for cid in ids:
        row = process_char(cid, idx)
        if row:
            entries.append(row)

    # 保留已有、本次未处理的条目
    done_ids = {e["id"] for e in entries}
    for sid, row in existing.items():
        if int(sid) not in ids and Path(ROOT / row["path"]).is_file():
            entries.append(row)

    entries.sort(key=lambda x: x["id"])
    write_manifest(entries)
    print(f"\n完成 {len([e for e in entries if e['id'] in ids])}/{len(ids)} → {OUT_DIR}")
    print(f"清单 → {MANIFEST}")
    return 0 if entries else 1


if __name__ == "__main__":
    raise SystemExit(main())
