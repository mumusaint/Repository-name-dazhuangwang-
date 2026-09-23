"""仅 dump libil2cpp rw 段（<16MB），供扫描 Registration / 小体积分析。"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts/game_dump/apk/libil2cpp.rw.mem"
INFO = ROOT / "scripts/game_dump/il2cpp_rw_dump.json"
MUMU_ADB = Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe")
DEVICE = "127.0.0.1:16384"
PKG = "com.pinkcore.tkfm"


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


def find_pid() -> int:
    adb_shell("root")
    for line in adb_shell(f"ps -A | grep {PKG}").splitlines():
        if PKG in line and ":" not in line.split()[-1]:
            return int(line.split()[1])
    raise RuntimeError(f"未找到 {PKG}")


def main() -> int:
    pid = find_pid()
    rw_segs: list[tuple[int, int]] = []
    for line in adb_shell(f"grep libil2cpp /proc/{pid}/maps").splitlines():
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+)\s+(\S+)", line)
        if m and "rw" in m.group(3):
            rw_segs.append((int(m.group(1), 16), int(m.group(2), 16) - int(m.group(1), 16)))

    if not rw_segs:
        print("无 rw 段")
        return 1

    base = min(s[0] for s in rw_segs)
    end = max(s[0] + s[1] for s in rw_segs)
    total = end - base
    buf = bytearray(total)
    for start, size in rw_segs:
        off = start - base
        chunk = adb_read(pid, start, size)
        buf[off : off + len(chunk)] = chunk

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(buf)
    info = {
        "pid": pid,
        "image_base": hex(base),
        "image_base_int": base,
        "size": len(buf),
        "segments": [{"start": hex(s), "size": sz} for s, sz in rw_segs],
    }
    INFO.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[+] {OUT} ({len(buf) // 1024}KB) base={base:#x}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
