"""尝试解密 global-metadata 并运行 Il2CppDumper"""
import json
import shutil
import struct
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).parent.parent
DUMP = Path(__file__).parent / "game_dump"
APK_DIR = DUMP / "apk"
DUMPER_DIR = DUMP / "il2cpp_dumper"
OUT_DIR = DUMP / "il2cpp_dump"
META_ENC = APK_DIR / "assets/bin/Data/Managed/Metadata/global-metadata.dat"
META_DEC = APK_DIR / "global-metadata.decrypted.dat"
IL2CPP = APK_DIR / "lib/arm64-v8a/libil2cpp.so"
DUMPER_EXE = DUMPER_DIR / "Il2CppDumper.exe"

APK_CANDIDATES = [BASE / "天下布魔.apk", BASE / "天下布魔.apk.1.1"]
DUMPER_URL = "https://github.com/Perfare/Il2CppDumper/releases/download/v6.7.46/Il2CppDumper-win-v6.7.46.zip"


def find_apk() -> Path | None:
    for p in APK_CANDIDATES:
        if p.exists():
            return p
    for p in BASE.glob("*.apk*"):
        if p.is_file() and p.stat().st_size > 10_000_000:
            return p
    return None


def ensure_dumper() -> Path:
    if DUMPER_EXE.exists():
        return DUMPER_EXE
    DUMPER_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = DUMPER_DIR / "Il2CppDumper-win.zip"
    import urllib.request

    print(f"下载 Il2CppDumper -> {zip_path}")
    urllib.request.urlretrieve(DUMPER_URL, zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(DUMPER_DIR)
    cfg = DUMPER_DIR / "config.json"
    if cfg.exists():
        text = cfg.read_text(encoding="utf-8")
        text = text.replace('"RequireAnyKey": true', '"RequireAnyKey": false')
        cfg.write_text(text, encoding="utf-8")
    return DUMPER_EXE


def try_xor_decrypt(data: bytes) -> tuple[bytes, dict]:
    """天下布魔 metadata 头部为 AEI 壳，非标准 IL2CPP magic。"""
    reports = {}
    # 4 字节 XOR 可还原 magic，但 version/offset 仍无效 → 非全文件简单 XOR
    key4 = bytes.fromhex("bbf4523f")
    dec4 = bytes(b ^ key4[i % 4] for i, b in enumerate(data))
    magic4 = struct.unpack_from("<I", dec4, 0)[0]
    ver4 = struct.unpack_from("<I", dec4, 4)[0]
    reports["xor4_magic"] = hex(magic4)
    reports["xor4_version"] = ver4

    best = None
    for ver in range(24, 32):
        key8 = key4 + bytes(data[4 + i] ^ v for i, v in enumerate(struct.pack("<I", ver)))
        dec8 = bytes(b ^ key8[i % 8] for i, b in enumerate(data))
        magic, version = struct.unpack_from("<II", dec8, 0)
        if magic != 0xFAB11BAF or version != ver:
            continue
        slo = struct.unpack_from("<I", dec8, 8)[0]
        reports[f"xor8_v{ver}_stringLiteralOffset"] = slo
        if slo < len(data):
            best = dec8
    return (best or dec4), reports


def header_valid(data: bytes) -> bool:
    if len(data) < 360:
        return False
    magic, version = struct.unpack_from("<II", data, 0)
    if magic != 0xFAB11BAF or version not in range(16, 40):
        return False
    need = 0
    for i in range(8, 360, 8):
        off, sz = struct.unpack_from("<II", data, i)
        if off > 0 and sz > 0:
            need = max(need, off + sz)
    return len(data) >= need and struct.unpack_from("<I", data, 8)[0] == 0x100


def run_il2cpp_dumper(exe: Path, so: Path, meta: Path, out: Path) -> tuple[int, str]:
    out.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [str(exe), str(so), str(meta), str(out)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(exe.parent),
    )
    text = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, text


def main() -> int:
    apk = find_apk()
    if not apk:
        print("未找到 APK，请将 天下布魔.apk 放到项目根目录")
        return 1
    if not META_ENC.exists():
        print("请先运行: python scripts/extract_apk.py")
        return 1
    if not IL2CPP.exists():
        print("缺少 libil2cpp.so，请先运行 extract_apk.py")
        return 1

    enc = META_ENC.read_bytes()
    if META_DEC.exists():
        existing = META_DEC.read_bytes()
        if header_valid(existing):
            dec = existing
            xor_report = {"source": "memory_dump", "size": len(existing)}
            print(f"使用已有解密 metadata: {META_DEC} ({len(existing)} bytes)")
        else:
            dec, xor_report = try_xor_decrypt(enc)
            META_DEC.write_bytes(dec)
    else:
        dec, xor_report = try_xor_decrypt(enc)
        META_DEC.write_bytes(dec)

    summary = {
        "apk": str(apk),
        "encrypted_metadata": str(META_ENC),
        "decrypt_attempt": xor_report,
        "header_valid": header_valid(dec),
        "protector": "lib39285EFA.so / assets/39285EFA.dex 加固壳，metadata 运行时解密",
        "il2cpp_dumper_status": None,
        "output_dir": str(OUT_DIR),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if not summary["header_valid"]:
        summary["il2cpp_dumper_status"] = "blocked_encrypted_metadata"
        summary["next_steps"] = [
            "静态 APK 内 metadata 被加固壳加密，Il2CppDumper 无法直接使用",
            "方案 A（推荐）：MuMu/真机 + Frida 内存 dump，见 scripts/frida_dump_metadata.js",
            "方案 B：Root + Magisk Zygisk，包名 com.pinkcore.tkfm，用 Zygisk-Il2CppDumper",
            "dump 出解密后的 global-metadata.dat 后，再运行本脚本",
        ]
        out_json = DUMP / "il2cpp_dump_status.json"
        out_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print("=" * 60)
        print("metadata 已加密（AEI 壳），静态 XOR 无法完整解密")
        print(f"加密文件: {META_ENC}")
        print(f"尝试解密: {META_DEC} （header_valid=False）")
        print("\n下一步：在模拟器运行游戏并用 Frida dump 解密 metadata")
        print("  frida -U -f com.pinkcore.tkfm -l scripts/frida_dump_metadata.js")
        print(f"\n详情: {out_json}")
        return 2

    exe = ensure_dumper()
    code, log = run_il2cpp_dumper(exe, IL2CPP, META_DEC, OUT_DIR)
    summary["il2cpp_dumper_status"] = "ok" if code == 0 and (OUT_DIR / "dump.cs").exists() else "failed"
    summary["dumper_log"] = log[-4000:]
    (DUMP / "il2cpp_dump_status.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if (OUT_DIR / "dump.cs").exists():
        print(f"成功: {OUT_DIR / 'dump.cs'}")
        return 0
    print("Il2CppDumper 失败:\n", log)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
