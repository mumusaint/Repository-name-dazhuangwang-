"""合并 MuMu 进程内 libil2cpp 全映射为连续 dump（供 Il2CppDumper 使用）。"""
from __future__ import annotations

import json
import re
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts/game_dump/apk/libil2cpp.full.mem"
INFO = ROOT / "scripts/game_dump/il2cpp_memory_dump.json"
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
    raise RuntimeError(f"未找到 {PKG}，请先打开游戏")


def parse_il2cpp_maps(pid: int) -> list[tuple[int, int, str]]:
    segs: list[tuple[int, int, str]] = []
    for line in adb_shell(f"grep libil2cpp /proc/{pid}/maps").splitlines():
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+)\s+(\S+)", line)
        if m:
            segs.append((int(m.group(1), 16), int(m.group(2), 16) - int(m.group(1), 16), m.group(3)))
    return segs


def patch_elf_phdr_memsz(buf: bytearray, total: int) -> None:
    """扩展首个 PT_LOAD 的 p_memsz 以覆盖连续 dump 全长。"""
    if buf[:4] != b"\x7fELF":
        return
    e_phoff = struct.unpack_from("<Q", buf, 32)[0]
    e_phnum = struct.unpack_from("<H", buf, 56)[0]
    for i in range(e_phnum):
        o = e_phoff + i * 56
        p_type = struct.unpack_from("<I", buf, o)[0]
        if p_type != 1:
            continue
        struct.pack_into("<Q", buf, o + 40, total)  # p_memsz
        break


def main() -> int:
    pid = find_pid()
    segs = parse_il2cpp_maps(pid)
    if not segs:
        print("无 libil2cpp 映射")
        return 1

    image_base = min(s[0] for s in segs)
    max_end = max(s[0] + s[1] for s in segs)
    total = max_end - image_base
    print(f"PID={pid} base={image_base:#x} span={total // 1024 // 1024}MB segments={len(segs)}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "wb") as f:
        for start, size, prot in segs:
            off = start - image_base
            print(f"  read {start:#x}+{size // 1024}KB ({prot}) -> off {off:#x}")
            chunk = adb_read(pid, start, size)
            if len(chunk) != size:
                print(f"    warn: got {len(chunk)} / {size}")
            f.seek(off)
            f.write(chunk)

    with open(OUT, "r+b") as f:
        hdr = bytearray(f.read(4096))
    patch_elf_phdr_memsz(hdr, total)
    with open(OUT, "r+b") as f:
        f.write(hdr)

    on_disk = OUT.stat().st_size
    print(f"[+] sparse dump on disk ~{on_disk // 1024 // 1024}MB (VA span {total // 1024 // 1024}MB)")

    info = {
        "pid": pid,
        "image_base": hex(image_base),
        "image_base_int": image_base,
        "output": str(OUT),
        "size": total,
        "on_disk_bytes": on_disk,
        "payload_size": total,
        "segments": [
            {"start": hex(s), "size": sz, "prot": p, "offset": hex(s - image_base)} for s, sz, p in segs
        ],
        "code_registration_hint": "0x72d49f9e7780",
        "metadata_registration_hint": "0x72d49f930b68",
        "note": "连续 VA ELF dump；Il2CppDumper 输入 image_base + 绝对 Registration 地址",
    }
    INFO.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[+] {OUT}")
    print(f"[+] {INFO}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
