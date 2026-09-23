"""MuMu 模拟器：安装并启动 frida-server，便于 dump global-metadata"""
from __future__ import annotations

import lzma
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRIDA_VER = "17.10.1"
ABI = "android-x86_64"
MUMU_ADB_CANDIDATES = [
    Path(r"C:\Program Files\Netease\MuMu\nx_main\adb.exe"),
    Path(r"C:\Program Files\Netease\MuMuPlayer-12.0\shell\adb.exe"),
    Path(r"C:\Program Files\Netease\MuMuPlayerGlobal-12.0\shell\adb.exe"),
]
MUMU_PORTS = ("127.0.0.1:16384", "127.0.0.1:7555", "emulator-5554")
CACHE = Path(__file__).parent / "game_dump" / "frida-server"


def find_adb() -> Path:
    found = shutil.which("adb")
    if found:
        return Path(found)
    for p in MUMU_ADB_CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError("未找到 adb，请确认 MuMu 已安装")


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print("$", " ".join(cmd))
    return subprocess.run(
        cmd,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        **kwargs,
    )


def pick_device(adb: Path) -> str:
    for port in MUMU_PORTS:
        run([str(adb), "connect", port.split(":")[-1] if port.startswith("127") else port])
    res = run([str(adb), "devices"])
    lines = [ln for ln in res.stdout.splitlines() if "\tdevice" in ln]
    if not lines:
        raise RuntimeError("未检测到 MuMu 设备，请先启动模拟器")
    # 优先 16384
    for ln in lines:
        if "16384" in ln:
            return ln.split("\t")[0]
    return lines[0].split("\t")[0]


def ensure_frida_server() -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"frida-server-{FRIDA_VER}-{ABI}"
    if out.exists():
        return out
    url = f"https://github.com/frida/frida/releases/download/{FRIDA_VER}/frida-server-{FRIDA_VER}-{ABI}.xz"
    xz_path = out.with_suffix(out.suffix + ".xz")
    print(f"下载 frida-server {FRIDA_VER} ({ABI})…")
    urllib.request.urlretrieve(url, xz_path)
    data = lzma.decompress(xz_path.read_bytes())
    out.write_bytes(data)
    xz_path.unlink(missing_ok=True)
    print(f"已保存 -> {out}")
    return out


def main() -> int:
    adb = find_adb()
    device = pick_device(adb)
    server = ensure_frida_server()
    remote = "/data/local/tmp/frida-server"

    run([str(adb), "-s", device, "root"])
    run([str(adb), "-s", device, "push", str(server), remote])
    run([str(adb), "-s", device, "shell", "chmod", "755", remote])
    run([str(adb), "-s", device, "shell", f"pkill -9 frida-server 2>/dev/null; {remote} -D &"])
    chk = run([str(adb), "-s", device, "shell", "pidof frida-server"])
    if not chk.stdout.strip():
        print("frida-server 启动失败，请检查 MuMu 是否已 adb root")
        return 1

    print("\n" + "=" * 60)
    print(f"MuMu 设备: {device}")
    print(f"frida-server PID: {chk.stdout.strip()}")
    print("\n下一步（推荐：adb 内存 dump，无需 Frida）:")
    print(f"  python scripts/dump_metadata_adb.py")
    print(f"  python scripts/run_il2cpp_dump.py")
    print("\n备选（AppGuard 会拦截 Frida attach）:")
    print(f'  powershell -ExecutionPolicy Bypass -File scripts/run_frida_attach.ps1')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
