"""用内存 dump + 扫描到的 Registration 地址运行 Il2CppDumper（非交互）。"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUMPER = ROOT / "scripts/game_dump/il2cpp_dumper"
EXE = DUMPER / "Il2CppDumper.exe"
SO = ROOT / "scripts/game_dump/apk/libil2cpp.full.mem"
SO_FALLBACK = ROOT / "scripts/game_dump/apk/libil2cpp.seg0.mem"
META = ROOT / "scripts/game_dump/apk/global-metadata.decrypted.dat"
OUT = ROOT / "scripts/game_dump/il2cpp_dump"
INFO = ROOT / "scripts/game_dump/il2cpp_memory_dump.json"
CODE_SCAN = ROOT / "scripts/game_dump/code_registration_scan.json"
META_SCAN = ROOT / "scripts/game_dump/metadata_registration_scan.json"


def load_image_base() -> int:
    if INFO.exists():
        return json.loads(INFO.read_text(encoding="utf-8"))["image_base_int"]
    return 0x72D3CAA7B000


def pick_addresses() -> tuple[int, int]:
    """从扫描结果选取 CodeRegistration / MetadataRegistration。"""
    meta_addr = 0x72D49F930B68  # typeDefinitionsSizesCount=13462
    code_addr = 0x72D49F9E7780  # heuristic from rw scan
    if META_SCAN.exists():
        hits = json.loads(META_SCAN.read_text(encoding="utf-8"))
        if hits:
            meta_addr = hits[0]["addr"] - 0x18  # struct 起始偏移估计
    if CODE_SCAN.exists():
        hits = json.loads(CODE_SCAN.read_text(encoding="utf-8"))
        if hits:
            code_addr = hits[0]["addr"]
    return code_addr, meta_addr


def patch_config() -> None:
    cfg = json.loads((DUMPER / "config.json").read_text(encoding="utf-8"))
    cfg["ForceDump"] = True
    cfg["NoRedirectedPointer"] = True
    cfg["RequireAnyKey"] = False
    cfg["ForceIl2CppVersion"] = False
    cfg["ForceVersion"] = 31
    (DUMPER / "config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def run() -> int:
    if not EXE.exists():
        print("缺少 Il2CppDumper.exe，请先下载到 scripts/game_dump/il2cpp_dumper/")
        return 1
    so_path = SO if SO.exists() else SO_FALLBACK
    if not so_path.exists():
        print("缺少 libil2cpp.full.mem / seg0.mem")
        print("  python scripts/build_il2cpp_full_dump.py  # 需游戏运行")
        print("  python scripts/dump_il2cpp_adb.py")
        return 1
    if not META.exists():
        print("缺少 global-metadata.decrypted.dat")
        return 1

    patch_config()
    base = load_image_base()
    code_reg, meta_reg = pick_addresses()
    OUT.mkdir(parents=True, exist_ok=True)

    # Il2CppDumper 交互：dump 基址 → CodeRegistration → MetadataRegistration
    stdin = f"{base}\n{code_reg}\n{meta_reg}\n"
    print(f"image_base={base:#x}")
    print(f"CodeRegistration={code_reg:#x}")
    print(f"MetadataRegistration={meta_reg:#x}")

    proc = subprocess.run(
        [str(EXE), str(so_path), str(META), str(OUT)],
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(DUMPER),
        timeout=600,
    )
    log = (proc.stdout or "") + (proc.stderr or "")
    (ROOT / "scripts/game_dump/il2cpp_dumper_run.log").write_text(log, encoding="utf-8")
    print(log[-3000:])
    ok = (OUT / "dump.cs").exists()
    print("dump.cs", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
