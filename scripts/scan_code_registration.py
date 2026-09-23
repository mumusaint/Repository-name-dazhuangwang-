"""扫描 libil2cpp rw 段或 adb 进程内存，定位 Il2Cpp CodeRegistration / MetadataRegistration。"""
from __future__ import annotations

import json
import re
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "scripts/game_dump/apk/global-metadata.decrypted.dat"
INFO = ROOT / "scripts/game_dump/il2cpp_memory_dump.json"
MUMU_ADB = Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe")
DEVICE = "127.0.0.1:16384"
PKG = "com.pinkcore.tkfm"


def read_metadata_counts() -> tuple[int, int, int]:
    data = META.read_bytes()
    methods_size = struct.unpack_from("<I", data, 52)[0]
    type_size = struct.unpack_from("<I", data, 164)[0]
    images_size = struct.unpack_from("<I", data, 360)[0] if len(data) > 364 else 0
    method_count = methods_size // 32
    type_count = type_size // 88
    image_count = images_size // 40 if images_size else 1
    return method_count, type_count, image_count


def adb_shell(cmd: str) -> str:
    r = subprocess.run(
        [str(MUMU_ADB), "-s", DEVICE, "shell", cmd],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return r.stdout


def adb_read(pid: int, addr: int, size: int) -> bytes:
    cmd = (
        f"dd if=/proc/{pid}/mem iflag=skip_bytes,count_bytes skip={addr} count={size} "
        f"bs=1048576 2>/dev/null"
    )
    r = subprocess.run(
        [str(MUMU_ADB), "-s", DEVICE, "exec-out", "sh", "-c", cmd],
        capture_output=True,
    )
    return r.stdout


def find_pid() -> int | None:
    adb_shell("root")
    for line in adb_shell(f"ps -A | grep {PKG}").splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].isdigit() and PKG in line and ":" not in parts[-1]:
            return int(parts[1])
    return None


def il2cpp_rw_regions(pid: int) -> list[tuple[int, int]]:
    text = adb_shell(f"grep libil2cpp /proc/{pid}/maps")
    out: list[tuple[int, int]] = []
    for line in text.splitlines():
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+)\s+(\S+)", line)
        if not m or "rw" not in m.group(3):
            continue
        start, end = int(m.group(1), 16), int(m.group(2), 16)
        out.append((start, end - start))
    return out


def scan_for_registration(blob: bytes, base: int, method_count: int, type_count: int) -> list[dict]:
    """启发式：在 rw 段中找 genericMethodCount ≈ method_count 的 Il2CppCodeRegistration。"""
    hits: list[dict] = []
    for off in range(0, len(blob) - 64, 8):
        # v24+ CodeRegistration 前几个 u32 计数
        vals = struct.unpack_from("<8I", blob, off)
        if not (method_count * 0.5 < vals[1] < method_count * 2):
            continue
        if vals[1] == 0 or vals[3] == 0:
            continue
        addr = base + off
        hits.append(
            {
                "addr": addr,
                "hex": f"{addr:#x}",
                "off": off,
                "counts": vals[:8],
            }
        )
    return hits[:20]


def main() -> int:
    method_count, type_count, image_count = read_metadata_counts()
    print(f"metadata: methods={method_count} types={type_count} images={image_count}")

    pid = find_pid()
    if not pid:
        print("游戏未运行，请先打开 MuMu 游戏")
        return 1

    regions = il2cpp_rw_regions(pid)
    print(f"PID {pid}, il2cpp rw regions: {len(regions)}")
    all_hits: list[dict] = []
    for start, size in regions:
        print(f"  scan {start:#x} +{size // 1024}KB")
        chunk = adb_read(pid, start, min(size, 4 * 1024 * 1024))
        if len(chunk) < 64:
            continue
        hits = scan_for_registration(chunk, start, method_count, type_count)
        for h in hits:
            h["region"] = f"{start:#x}"
        all_hits.extend(hits)

    all_hits.sort(key=lambda x: abs(x["counts"][1] - method_count))
    out = ROOT / "scripts/game_dump/code_registration_scan.json"
    out.write_text(json.dumps(all_hits[:30], indent=2), encoding="utf-8")
    print(f"\nTop candidates -> {out}")
    for h in all_hits[:8]:
        print(f"  {h['hex']} counts={h['counts'][:4]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
