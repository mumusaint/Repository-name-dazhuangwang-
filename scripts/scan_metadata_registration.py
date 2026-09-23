"""在 il2cpp rw 段扫描 Il2CppMetadataRegistration（typeDefinitionsSizes = type_count）。"""
from __future__ import annotations

import json
import re
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "scripts/game_dump/apk/global-metadata.decrypted.dat"
MUMU_ADB = Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe")
DEVICE = "127.0.0.1:16384"
PKG = "com.pinkcore.tkfm"


def counts() -> tuple[int, int]:
    data = META.read_bytes()
    type_count = struct.unpack_from("<I", data, 164)[0] // 88
    method_count = struct.unpack_from("<I", data, 52)[0] // 32
    return method_count, type_count


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
    return subprocess.run(
        [str(MUMU_ADB), "-s", DEVICE, "exec-out", "sh", "-c", cmd],
        capture_output=True,
    ).stdout


def pid() -> int:
    adb_shell("root")
    for line in adb_shell(f"ps -A | grep {PKG}").splitlines():
        if PKG in line and ":" not in line.split()[-1]:
            return int(line.split()[1])
    raise RuntimeError("game not running")


def rw_segs(pid: int) -> list[tuple[int, int]]:
    out = []
    for line in adb_shell(f"grep libil2cpp /proc/{pid}/maps").splitlines():
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+)\s+(\S+)", line)
        if m and "rw" in m.group(3):
            out.append((int(m.group(1), 16), int(m.group(2), 16) - int(m.group(1), 16)))
    return out


def scan_meta_reg(blob: bytes, base: int, type_count: int) -> list[dict]:
    hits = []
    for off in range(0, len(blob) - 32, 8):
        vals = struct.unpack_from("<4Q", blob, off)
        # Il2CppMetadataRegistration: ... typeDefinitionsSizes (count) at offset varies by version
        # v31: scan for u32 == type_count in plausible struct
        u32s = struct.unpack_from("<8I", blob, off)
        for i, v in enumerate(u32s):
            if v == type_count:
                hits.append({"addr": base + off + i * 4, "hex": f"{base + off + i * 4:#x}", "u32s": u32s})
    return hits[:50]


def main() -> None:
    mc, tc = counts()
    print(f"expect type_count={tc} method_count={mc}")
    p = pid()
    hits = []
    for start, size in rw_segs(p):
        blob = adb_read(p, start, min(size, 5 * 1024 * 1024))
        hits.extend(scan_meta_reg(blob, start, tc))
    out = ROOT / "scripts/game_dump/metadata_registration_scan.json"
    out.write_text(json.dumps(hits[:40], indent=2), encoding="utf-8")
    print(f"hits={len(hits)} -> {out}")
    for h in hits[:10]:
        print(h["hex"], h["u32s"])


if __name__ == "__main__":
    main()
