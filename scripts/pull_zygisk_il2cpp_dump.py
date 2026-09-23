"""从 Zygisk-Il2CppDumper 输出目录拉取 dump 到本地。

前提：
  1. MuMu 已装 Magisk/Kitsune Mask 并开启 Zygisk
  2. 已安装包名 com.pinkcore.tkfm 的 Zygisk-Il2CppDumper 模块并重启
  3. 启动游戏并进入主界面，等待 dump 完成

用法（项目根目录）：
    python scripts/pull_zygisk_il2cpp_dump.py
    python scripts/pull_zygisk_il2cpp_dump.py --list   # 仅列出设备端文件
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "game_dump" / "il2cpp_dump"
PKG = "com.pinkcore.tkfm"
REMOTE_DIR = f"/data/data/{PKG}/files"
MUMU_ADB = Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe")
DEVICE = "127.0.0.1:16384"

# Zygisk-Il2CppDumper 常见产物
WANT = (
    "dump.cs",
    "script.json",
    "stringliteral.json",
    "il2cpp.h",
    "DummyDll",
)


def adb(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(MUMU_ADB), "-s", DEVICE, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def adb_shell(cmd: str) -> str:
    return adb("shell", cmd).stdout


def ensure_root() -> bool:
    adb("root")
    r = adb_shell("id")
    if "uid=0(root)" not in r:
        print("adb 无 root。MuMu：设置中心 → 磁盘可写 + 开启 Root，并安装 Magisk。")
        return False
    return True


def remote_list() -> list[str]:
    text = adb_shell(f"ls -la {REMOTE_DIR} 2>/dev/null")
    if "No such file" in text or not text.strip():
        return []
    lines = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 8 and parts[0].startswith("-"):
            lines.append(parts[-1])
    return lines


def windows_safe(name: str) -> bool:
    """Windows 文件名非法字符（如 Firebase 的 frc_1:6136...）。"""
    bad = '<>:"/\\|?*'
    return name and not any(c in name for c in bad)


def pull_file(name: str) -> bool:
    local = OUT / name
    local.parent.mkdir(parents=True, exist_ok=True)
    r = adb("pull", f"{REMOTE_DIR}/{name}", str(local))
    if r.returncode == 0 and local.exists():
        print(f"  [+] {name} ({local.stat().st_size // 1024}KB)")
        return True
    err = (r.stderr or r.stdout or "").strip()
    if err:
        print(f"  [-] {name}: {err}")
    return False


def pull_tree(name: str) -> bool:
    local = OUT / name
    local.mkdir(parents=True, exist_ok=True)
    r = adb("pull", f"{REMOTE_DIR}/{name}", str(local))
    if r.returncode == 0:
        print(f"  [+] {name}/")
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="拉取 Zygisk-Il2CppDumper 产物")
    parser.add_argument("--list", action="store_true", help="仅列出设备端 files 目录")
    args = parser.parse_args()

    if not MUMU_ADB.exists():
        print(f"未找到 adb: {MUMU_ADB}")
        return 1

    if not ensure_root():
        return 1

    names = remote_list()
    if args.list:
        print(f"{REMOTE_DIR}:")
        for n in names:
            print(f"  {n}")
        return 0 if names else 1

    if not names:
        print(f"目录为空或不存在: {REMOTE_DIR}")
        print()
        print("请确认：")
        print("  1. 已在 Magisk 安装 Zygisk-Il2CppDumper（包名 com.pinkcore.tkfm）并重启")
        print("  2. 已启动游戏并进入主界面（dump 在 il2cpp 加载后生成）")
        print("  3. Magisk 设置中 Zygisk 已开启")
        return 1

    il2cpp = [n for n in names if n in WANT or n.endswith((".cs", ".h")) or n == "DummyDll"]
    skipped = [n for n in names if n not in il2cpp]
    if skipped:
        print(f"忽略游戏缓存 {len(skipped)} 个（非 Il2Cpp dump）")
    if not il2cpp:
        print("\n目录里只有 Firebase/Adjust 等缓存，没有 dump.cs。")
        print("请先：Magisk 安装 Zygisk-Il2CppDumper → 重启 → 进游戏主界面 → 再运行本脚本")
        return 1

    print(f"Il2Cpp 相关: {', '.join(il2cpp)}")
    print(f"拉取到: {OUT}")
    ok = 0
    for w in WANT:
        if w not in names:
            continue
        if w == "DummyDll":
            if pull_tree(w):
                ok += 1
        elif pull_file(w):
            ok += 1

    for n in il2cpp:
        if n in WANT or not windows_safe(n):
            continue
        if n.endswith((".cs", ".json", ".h")) and not (OUT / n).exists():
            if pull_file(n):
                ok += 1

    if (OUT / "dump.cs").exists():
        print("\n成功。可在 dump.cs 搜索 LoadCharLvUpData / LoadBinaryDataWithCAsync")
        return 0
    print("\n未找到 dump.cs。Zygisk 模块尚未产出 dump，或需重新进游戏触发。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
