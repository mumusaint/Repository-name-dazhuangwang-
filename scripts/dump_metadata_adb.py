"""通过 adb root 从游戏进程内存 dump 解密后的 global-metadata.dat（无需 Frida）

游戏含 AppGuard 反调试，Frida attach 会报 process not found，本脚本直接读 /proc/PID/mem。
"""
from __future__ import annotations

import re
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "game_dump" / "apk" / "global-metadata.decrypted.dat"
PKG = "com.pinkcore.tkfm"
MAGIC = b"\xaf\x1b\xb1\xfa"
MIN_REGION = 256 * 1024
MAX_REGION = 64 * 1024 * 1024
CHUNK = 4 * 1024 * 1024
MAX_DUMP = 32 * 1024 * 1024

MUMU_ADB = Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe")
DEVICE = "127.0.0.1:16384"


def log(msg: str) -> None:
    print(msg, flush=True)


def adb(*args: str, binary: bool = False) -> bytes | str:
    cmd = [str(MUMU_ADB), "-s", DEVICE, *args]
    r = subprocess.run(cmd, capture_output=True)
    if binary:
        return r.stdout
    return r.stdout.decode("utf-8", "replace")


def adb_shell(cmd: str, binary: bool = False) -> bytes | str:
    return adb("shell", cmd, binary=binary)


def find_game_pid() -> int | None:
    adb("root")
    text = str(adb_shell(f"ps -A -o PID,RSS,NAME | grep {PKG}"))
    candidates: list[tuple[int, int, bool]] = []
    for line in text.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        pid = int(parts[0])
        rss = int(parts[1]) if parts[1].isdigit() else 0
        maps = str(adb_shell(f"grep -E 'libil2cpp|libunity' /proc/{pid}/maps 2>/dev/null | head -1")).strip()
        candidates.append((pid, rss, bool(maps)))
    if not candidates:
        pidof = str(adb_shell(f"pidof {PKG}")).strip().split()
        if pidof and pidof[0].isdigit():
            return int(pidof[0])
        return None
    with_il2 = [c for c in candidates if c[2]]
    pool = with_il2 if with_il2 else candidates
    pool.sort(key=lambda x: x[1], reverse=True)
    return pool[0][0]


def region_score(prot: str, name: str, size: int) -> int:
    score = 0
    low = name.lower()
    if "global-metadata" in low:
        score += 500
    if "il2cpp" in low and " rw" in f" {prot} ":
        score += 120
    if name in ("", "[anon]", "[anon:libc_malloc]") or name.startswith("[anon"):
        score += 200
    if " rw" in f" {prot} ":
        score += 80
    if prot.startswith("r--"):
        score += 40
    if 0xA00000 <= size <= 0xE00000:
        score += 300
    if size > MAX_REGION:
        score -= 300
    if low.endswith(".so") and prot.startswith("r--") and size > 32 * 1024 * 1024:
        score -= 400
    if "dalvik-main" in low or "compilermetadata" in low:
        score -= 300
    if name.startswith("/system/") or name.startswith("/vendor/"):
        score -= 500
    return score


def parse_maps(pid: int) -> list[tuple[int, int, str, str]]:
    text = str(adb_shell(f"cat /proc/{pid}/maps"))
    regions: list[tuple[int, int, str, str, int]] = []
    for line in text.splitlines():
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+\S+\s+\S+\s+\S+\s*(.*)", line)
        if not m:
            continue
        start = int(m.group(1), 16)
        end = int(m.group(2), 16)
        prot = m.group(3)
        name = m.group(4).strip() or "[anon]"
        size = end - start
        if size < MIN_REGION or "r" not in prot or size > MAX_REGION:
            continue
        if name.startswith("/system/") or name.startswith("/vendor/"):
            continue
        if "CompilerMetadata" in name or "dalvik-main space" in name:
            continue
        sc = region_score(prot, name, size)
        regions.append((start, size, prot, name, sc))
    regions.sort(key=lambda r: (r[4], r[1]), reverse=True)
    return [(r[0], r[1], r[2], r[3]) for r in regions]


def read_mem_chunk(pid: int, addr: int, size: int) -> bytes:
    cmd = (
        f"dd if=/proc/{pid}/mem iflag=skip_bytes,count_bytes skip={addr} count={size} "
        f"bs=1048576 2>/dev/null"
    )
    return adb("exec-out", "sh", "-c", cmd, binary=True)


def scan_region(pid: int, start: int, size: int) -> list[int]:
    hits: list[int] = []
    offset = 0
    while offset < size:
        read = min(CHUNK, size - offset)
        addr = start + offset
        try:
            data = read_mem_chunk(pid, addr, read)
        except Exception:
            data = b""
        if data:
            pos = 0
            while True:
                idx = data.find(MAGIC, pos)
                if idx < 0:
                    break
                hit = addr + idx
                hdr = read_mem_chunk(pid, hit, 128)
                if validate_header_quick(hdr):
                    hits.append(hit)
                pos = idx + 4
        offset += read
    return hits


def metadata_size_from_header(hdr: bytes) -> int:
    if len(hdr) < 360:
        hdr = hdr + b"\x00" * (360 - len(hdr))
    max_end = 0
    for i in range(8, 360, 8):
        off, sz = struct.unpack_from("<II", hdr, i)
        if off > 0 and sz > 0 and off < 0x20000000 and sz < 0x20000000:
            max_end = max(max_end, off + sz)
    return min(max(max_end, 0x600000), MAX_DUMP)


def validate_header_quick(base_data: bytes) -> bool:
    if len(base_data) < 8:
        return False
    magic, ver = struct.unpack_from("<II", base_data, 0)
    if magic != 0xFAB11BAF or ver not in range(16, 40):
        return False
    if len(base_data) >= 12:
        slo = struct.unpack_from("<I", base_data, 8)[0]
        if slo < 0x80 or slo > 0x1000:
            return False
    return True


def validate_header_full(data: bytes) -> bool:
    if not validate_header_quick(data):
        return False
    need = metadata_size_from_header(data[:360])
    if len(data) < need:
        return False
    if struct.unpack_from("<I", data, 8)[0] != 0x100:
        return False
    return True


def estimate_size(base_data: bytes) -> int:
    return metadata_size_from_header(base_data)


def dump_at(pid: int, addr: int) -> bytes | None:
    hdr = read_mem_chunk(pid, addr, 128)
    if not validate_header_quick(hdr):
        return None
    size = estimate_size(hdr)
    log(f"[+] candidate @ {addr:#x}  size~{size:#x}  ver={struct.unpack_from('<I', hdr, 4)[0]}")
    data = read_mem_chunk(pid, addr, size)
    if not validate_header_full(data):
        log(f"    skip: header offsets invalid after full read")
        return None
    return data


def main() -> int:
    if not MUMU_ADB.exists():
        log("MuMu adb not found")
        return 1

    pid = find_game_pid()
    if not pid:
        log(f"未找到 {PKG} 进程，请先在 MuMu 打开游戏到主界面")
        return 1
    log(f"[*] PID {pid}（AppGuard 会拦截 Frida，使用 adb 内存扫描）")

    regions = parse_maps(pid)
    log(f"[*] {len(regions)} candidate regions")

    # 优先扫描 ~11–13 MB 的 anon rw 区（metadata 通常在此）
    fast = [
        r for r in regions
        if r[2].startswith("rw") and (r[3] == "[anon]" or r[3].startswith("[anon:"))
        and 0xB00000 <= r[1] <= 0xD00000
    ]
    fast.sort(key=lambda r: abs(r[1] - 0xB80000))
    rest = [r for r in regions if r not in fast]
    ordered = fast + rest

    meta_addr = None
    data = b""
    limit = min(len(ordered), 120)
    for i, (start, size, prot, name) in enumerate(ordered[:limit], 1):
        log(f"[{i}/{limit}] {start:#x} +{size // 1024}KB {prot} {name[:60]}")
        addr_hits = scan_region(pid, start, size)
        for addr in addr_hits:
            log(f"    -> magic @ {addr:#x}, validating full dump…")
            data = dump_at(pid, addr)
            if data is not None:
                meta_addr = addr
                break
        if meta_addr is not None:
            break

    if meta_addr is None:
        log("[-] 未找到 FAB11BAF")
        log("    请进入游戏主界面 / 点一次「召唤」后重试：")
        log("    python scripts/dump_metadata_adb.py")
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(data)
    log(f"[+] saved {len(data)} bytes -> {OUT}")
    log("    python scripts/run_il2cpp_dump.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
