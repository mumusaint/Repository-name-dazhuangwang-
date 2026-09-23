"""从天下布魔 APK 提取 libil2cpp、global-metadata 等逆向所需文件"""
import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).parent.parent
DUMP = Path(__file__).parent / "game_dump"
OUT = DUMP / "apk"

# 优先使用标准 .apk；QQ/微信传输可能变成 .apk.1.1
APK_CANDIDATES = [
    BASE / "天下布魔.apk",
    BASE / "天下布魔.apk.1.1",
    BASE / "com.pinkcore.tkfm.apk",
]

# 只解压这些路径（APK 体积大，不必全量展开）
EXTRACT_PREFIXES = (
    "lib/arm64-v8a/",
    "lib/armeabi-v7a/",
    "assets/bin/Data/Managed/Metadata/",
    "assets/bin/Data/boot.config",
    "assets/bin/Data/ScriptingAssemblies.json",
    "assets/bin/Data/RuntimeInitializeOnLoads.json",
)
EXTRACT_EXACT = ("AndroidManifest.xml",)


def find_apk() -> Path | None:
    for p in APK_CANDIDATES:
        if p.exists():
            return p
    for p in BASE.glob("*.apk*"):
        if p.is_file() and p.stat().st_size > 10_000_000:
            return p
    return None


def should_extract(name: str) -> bool:
    if name in EXTRACT_EXACT:
        return True
    return any(name.startswith(prefix) for prefix in EXTRACT_PREFIXES)


def scan_il2cpp_strings(so_path: Path, limit: int = 80) -> list[str]:
    data = so_path.read_bytes()
    # 可读 ASCII 串，过滤 Unity / 加密相关
    raw = re.findall(rb"[\x20-\x7e]{6,}", data)
    keywords = (
        b"unity", b"Unity", b"encrypt", b"decrypt", b"bundle", b"Bundle",
        b"AssetBundle", b"UnityFS", b"key", b"Key", b"xxtea", b"AES",
        b"UnityCN", b"offset", b"catalog", b"Addressable",
    )
    hits = []
    seen = set()
    for s in raw:
        if any(k in s for k in keywords) and s not in seen:
            seen.add(s)
            hits.append(s.decode("ascii", errors="ignore"))
    hits.sort(key=len, reverse=True)
    return hits[:limit]


def main():
    apk = find_apk()
    if not apk:
        print("未找到 APK。请将安装包放到项目根目录，命名为 天下布魔.apk 或 天下布魔.apk.1.1")
        return 1

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    extracted = []
    with zipfile.ZipFile(apk) as zf:
        for name in zf.namelist():
            if not should_extract(name):
                continue
            dest = OUT / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(name) as src, open(dest, "wb") as dst:
                shutil.copyfileobj(src, dst)
            extracted.append({"path": name, "size": dest.stat().st_size})

    il2cpp_arm64 = OUT / "lib/arm64-v8a/libil2cpp.so"
    metadata = OUT / "assets/bin/Data/Managed/Metadata/global-metadata.dat"
    strings = scan_il2cpp_strings(il2cpp_arm64) if il2cpp_arm64.exists() else []

    summary = {
        "apk": str(apk),
        "apk_size": apk.stat().st_size,
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "output_dir": str(OUT),
        "files": extracted,
        "il2cpp_arm64": str(il2cpp_arm64) if il2cpp_arm64.exists() else None,
        "global_metadata": str(metadata) if metadata.exists() else None,
        "il2cpp_string_hits": strings,
        "next_steps": [
            "用 Il2CppDumper 解析 libil2cpp.so + global-metadata.dat 导出 C# 伪代码与脚本映射",
            "在 dump 中搜索 AssetBundle / UnityCN / Decrypt 相关类定位 bundle 解密密钥",
            "密钥到手后可解 scripts/game_dump 里 UnityCN 加密的 bundle",
        ],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"APK: {apk.name} ({apk.stat().st_size // 1024 // 1024} MB)")
    print(f"已解压 {len(extracted)} 个文件 -> {OUT}")
    for f in extracted:
        print(f"  {f['size']:>12}  {f['path']}")
    if strings:
        print(f"\nlibil2cpp.so 相关字符串（前 15 条）:")
        for s in strings[:15]:
            preview = s if len(s) <= 100 else s[:97] + "..."
            print(f"  {preview}")
    print(f"\n摘要: {OUT / 'summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
