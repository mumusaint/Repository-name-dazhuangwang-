"""从 MuMu 游戏进程内存 dump libil2cpp.so，供 Il2CppDumper 使用

注意：不要用 file-offset 合并（会破坏 ELF）。应 dump 第一个 r-- 映射段，
Il2CppDumper 提示 dump address 时输入 image_base。
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_SO = ROOT / "scripts" / "game_dump" / "apk" / "libil2cpp.seg0.mem"
INFO_JSON = ROOT / "scripts" / "game_dump" / "il2cpp_memory_dump.json"
PKG = "com.pinkcore.tkfm"
MUMU_ADB = Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe")
DEVICE = "127.0.0.1:16384"


@dataclass
class MapSeg:
    start: int
    end: int
    prot: str
    file_off: int

    @property
    def size(self) -> int:
        return self.end - self.start


def log(msg: str) -> None:
    print(msg, flush=True)


def adb(*args: str, binary: bool = False) -> bytes | str:
    cmd = [str(MUMU_ADB), "-s", DEVICE, *args]
    r = subprocess.run(cmd, capture_output=True)
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def adb_shell(cmd: str) -> str:
    return str(adb("shell", cmd))


def find_il2cpp_pid() -> int | None:
    adb("root")
    text = adb_shell(f"ps -A -o PID,RSS,NAME | grep {PKG}")
    best = None
    for line in text.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        pid = int(parts[0])
        rss = int(parts[1]) if parts[1].isdigit() else 0
        if adb_shell(f"grep libil2cpp /proc/{pid}/maps 2>/dev/null | head -1").strip():
            return pid
        if best is None or rss > best[1]:
            best = (pid, rss)
    return best[0] if best else None


def parse_il2cpp_maps(pid: int) -> list[MapSeg]:
    text = adb_shell(f"grep libil2cpp /proc/{pid}/maps")
    segs: list[MapSeg] = []
    for line in text.splitlines():
        m = re.match(
            r"([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+([0-9a-f]+)\s+\S+\s+\S+\s*(.*)",
            line,
        )
        if not m:
            continue
        segs.append(
            MapSeg(
                start=int(m.group(1), 16),
                end=int(m.group(2), 16),
                prot=m.group(3),
                file_off=int(m.group(4), 16),
            )
        )
    return segs


def read_mem(pid: int, addr: int, size: int) -> bytes:
    cmd = (
        f"dd if=/proc/{pid}/mem iflag=skip_bytes,count_bytes skip={addr} count={size} "
        f"bs=1048576 2>/dev/null"
    )
    return adb("exec-out", "sh", "-c", cmd, binary=True)


def pick_primary_segment(segs: list[MapSeg]) -> MapSeg:
    primaries = [s for s in segs if s.file_off == 0 and s.prot.startswith("r")]
    if not primaries:
        raise RuntimeError("no primary libil2cpp mapping")
    return max(primaries, key=lambda s: s.size)


def main() -> int:
    if not MUMU_ADB.exists():
        log("MuMu adb not found")
        return 1

    pid = find_il2cpp_pid()
    if not pid:
        log(f"未找到 {PKG}，请打开游戏到主界面")
        return 1

    segs = parse_il2cpp_maps(pid)
    primary = pick_primary_segment(segs)
    image_base = primary.start

    log(f"[*] PID {pid}")
    log(f"[*] dump 主映射 {primary.start:#x} +{primary.size // 1024}KB ({primary.prot})")

    data = read_mem(pid, primary.start, primary.size)
    if len(data) < 4 or data[:4] != b"\x7fELF":
        log("[-] dump 内容不是有效 ELF")
        return 1

    OUT_SO.parent.mkdir(parents=True, exist_ok=True)
    OUT_SO.write_bytes(data)

    info = {
        "pid": pid,
        "image_base": hex(image_base),
        "image_base_int": image_base,
        "output_so": str(OUT_SO),
        "size": len(data),
        "note": "不要用 libil2cpp.memory.so（file-offset 合并会破坏 ELF）",
        "il2cpp_dumper_steps": [
            "cd scripts/game_dump/il2cpp_dumper",
            f'Il2CppDumper.exe "..\\apk\\libil2cpp.seg0.mem" '
            f'"..\\apk\\global-metadata.decrypted.dat" "..\\il2cpp_dump"',
            f"Input il2cpp dump address → {image_base} （十进制）",
        ],
    }
    INFO_JSON.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

    log(f"[+] saved {len(data)} bytes -> {OUT_SO}")
    log(f"[+] image base = {image_base:#x}  （十进制 {image_base}）")
    log("")
    log("下一步（CMD 交互）：")
    log("  cd scripts\\game_dump\\il2cpp_dumper")
    log('  Il2CppDumper.exe "..\\apk\\libil2cpp.seg0.mem" '
        '"..\\apk\\global-metadata.decrypted.dat" "..\\il2cpp_dump"')
    log(f"  dump address 输入: {image_base}")
    log("")
    log("若仍报 CodeRegistration: 0 → 游戏壳过强，需 Zygisk-Il2CppDumper")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
