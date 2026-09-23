"""从 MuMu 拉取游戏已下载的 Addressables bundle（角色表/字符串/立绘等）"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "game_dump" / "bundles"
PKG = "com.pinkcore.tkfm"
DEVICE = "127.0.0.1:16384"
MUMU_ADB = Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe")
REMOTE_DIR = f"/storage/emulated/0/Android/data/{PKG}/files/data"

# catalog 中确认的核心数据包
CORE_BUNDLES = {
    "maindata": "maindata_assets_all_f2db6548fb88ee11b504cbec631565c7.bundle",
    "stringdata": "stringdata_assets_all_530cf137327847642a223918c977abdc.bundle",
}


def adb(*args: str) -> str:
    r = subprocess.run(
        [str(MUMU_ADB), "-s", DEVICE, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return (r.stdout or "") + (r.stderr or "")


def pull_bundle(name: str, remote_name: str | None = None) -> Path | None:
    remote_name = remote_name or name
    remote = f"{REMOTE_DIR}/{remote_name}"
    local = OUT / f"{name}.bundle"
    OUT.mkdir(parents=True, exist_ok=True)
    out = adb("pull", remote, str(local))
    if local.exists() and local.stat().st_size > 0:
        print(f"[+] {name}: {local.stat().st_size // 1024} KB")
        return local
    print(f"[-] {name} pull failed: {out.strip()}")
    return None


def pull_by_char_id(char_id: int) -> list[Path]:
    """拉取指定角色的 cb/cg/scg bundle（若已下载）"""
    pulled: list[Path] = []
    listing = adb("shell", f"ls {REMOTE_DIR} 2>/dev/null")
    prefixes = (f"cb{char_id:05d}_", f"cg{char_id:05d}_", f"scg{char_id:05d}_")
    for line in listing.splitlines():
        fname = line.strip()
        if not fname.endswith(".bundle"):
            continue
        if any(fname.startswith(p) for p in prefixes):
            dest = pull_bundle(fname.replace(".bundle", ""), fname)
            if dest:
                pulled.append(dest)
    return pulled


def pull_manual_characters() -> list[Path]:
    """拉取 manual_characters.json 中角色相关 bundle（需先运行 extract 或自行查 catalog）"""
    manual_path = ROOT / "data" / "manual_characters.json"
    if not manual_path.is_file():
        return []
    raw = json.loads(manual_path.read_text(encoding="utf-8"))
    ids = [int(c["id"]) for c in raw.get("characters", []) if c.get("id")]
    pulled: list[Path] = []
    for cid in ids:
        pulled.extend(pull_by_char_id(cid))
    return pulled


def main() -> int:
    if not MUMU_ADB.exists():
        print("MuMu adb not found")
        return 1

    import sys

    print(f"[*] 从 {REMOTE_DIR} 拉取 bundle …")
    results: dict[str, str | None] = {}
    for key, fname in CORE_BUNDLES.items():
        p = pull_bundle(key, fname)
        results[key] = str(p) if p else None

    if len(sys.argv) > 1 and sys.argv[1] == "--manual":
        print("[*] 拉取 manual_characters 相关 bundle …")
        for p in pull_manual_characters():
            results[f"manual_{p.stem}"] = str(p)
    elif len(sys.argv) > 1 and sys.argv[1].isdigit():
        cid = int(sys.argv[1])
        print(f"[*] 拉取角色 {cid} 相关 bundle …")
        for p in pull_by_char_id(cid):
            results[f"char_{cid}_{p.stem}"] = str(p)

    manifest = {
        "remote_dir": REMOTE_DIR,
        "bundles": results,
        "next": "python scripts/extract_game_strings.py",
    }
    (OUT / "pulled.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n清单 -> {OUT / 'pulled.json'}")
    return 0 if any(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
