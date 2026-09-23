"""一键续跑：从本地 bundle 解包 maindata / stringdata 并刷新索引。

用法（项目根目录）：
    python scripts/continue_game_extract.py
    python scripts/continue_game_extract.py --pull     # 若 MuMu 在线则先拉 bundle
    python scripts/continue_game_extract.py --il2cpp   # 尝试拉 Zygisk Il2Cpp dump

无需设备时仅用已有 scripts/game_dump/bundles/*.bundle。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"


def run(script: str, *extra: str) -> bool:
    path = SCRIPTS / script
    if not path.is_file():
        print(f"  跳过：无 {script}")
        return False
    print(f"\n>> python scripts/{script}")
    r = subprocess.run([sys.executable, str(path), *extra], cwd=str(ROOT))
    return r.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser(description="继续解包游戏数据")
    ap.add_argument("--pull", action="store_true", help="从 MuMu adb 拉 maindata/stringdata")
    ap.add_argument("--il2cpp", action="store_true", help="拉 Zygisk Il2Cpp dump（需游戏已触发）")
    args = ap.parse_args()

    ok = True
    bundles = SCRIPTS / "game_dump" / "bundles"
    has_main = (bundles / "maindata.bundle").is_file()
    has_str = (bundles / "stringdata.bundle").is_file()

    if args.pull:
        if not run("pull_game_bundles.py"):
            print("  adb 拉取失败或未连接设备，将使用已有 bundle")
        has_main = (bundles / "maindata.bundle").is_file()
        has_str = (bundles / "stringdata.bundle").is_file()

    if args.il2cpp:
        run("pull_zygisk_il2cpp_dump.py")

    if has_main:
        ok = run("parse_maindata_tables.py") and ok
        ok = run("export_maindata_overlay.py") and ok
    else:
        print("\n缺少 maindata.bundle → 跳过 maindata 解析")
        print("  可从 MuMu 运行: python scripts/pull_game_bundles.py")

    if has_str:
        ok = run("extract_stringdata_tables.py") and ok
        ok = run("extract_game_strings.py") and ok
    else:
        print("\n缺少 stringdata.bundle → 跳过字符串表")

    if (SCRIPTS / "game_dump" / "catalog_2020.12.07.07.50.36.json").is_file():
        ok = run("extract_bundle_index.py") and ok
        ok = run("find_new_character_ids.py") and ok

    print("\n完成。")
    if has_main:
        print("  面板覆盖: data/maindata_overlay.json")
    if has_str:
        print("  角色名:   scripts/game_dump/extracted/character_names_from_game.json")
    print("  新角色:   scripts/game_dump/index/missing_characters.json")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
