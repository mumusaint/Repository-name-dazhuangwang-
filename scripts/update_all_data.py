"""从 TenkaAssist / 配队库 / 本地 catalog 拉取并刷新打桩网所需数据

用法:
  python scripts/update_all_data.py           # 全部
  python scripts/update_all_data.py --chars   # 仅角色面板
  python scripts/update_all_data.py --comps   # 仅配队库
  python scripts/update_all_data.py --index   # 仅 bundle 索引 + 新角色候选
  python scripts/update_all_data.py --maindata  # 仅 maindata 面板导出
  python scripts/update_all_data.py --game      # 仅游戏逆向 → data/
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

TENKA_BASE = "https://inittt.github.io/tenkaassist"
TENKA_JS = {
    "characterJson.js": f"{TENKA_BASE}/js/characterJson.js",
    "common.js": f"{TENKA_BASE}/js/common.js",
    "calculator.v3.js": f"{TENKA_BASE}/js/calculator.v3.js",
    "autocalc.v3.js": f"{TENKA_BASE}/js/autocalc.v3.js",
}
COMP_URLS = [
    "https://cdn.jsdelivr.net/gh/inittt/tenkaassist_data@main/data/data.json",
    "https://raw.githubusercontent.com/inittt/tenkaassist_data/main/data/data.json",
    "https://raw.gitmirror.com/inittt/tenkaassist_data/main/data/data.json",
]


def log(msg: str) -> None:
    print(msg, flush=True)


def download(url: str, dest: Path, timeout: int = 120) -> None:
    log(f"  下载 {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "dazhuang-update/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    log(f"  -> {dest} ({len(data) / 1024:.1f} KB)")


def update_characters() -> None:
    log("\n[1/4] 角色：中英文名 / 属性 / 面板数值")
    from tenka_sync import sync_characters

    sync_characters(force=True)


def update_compdata() -> None:
    log("\n[2/4] 配队库：社区配队 / 伤害 / 行动序列")
    from tenka_sync import sync_compdata

    res = sync_compdata(force=True)
    if res.get("error"):
        raise RuntimeError(res["error"])


def update_bundle_index() -> None:
    log("\n[3/4] 资源索引：catalog / 本地 bundle / 立绘文件名")
    script = ROOT / "scripts" / "extract_bundle_index.py"
    if not script.exists():
        log("  跳过：无 extract_bundle_index.py")
        return
    catalog = ROOT / "scripts" / "game_dump" / "catalog_2020.12.07.07.50.36.json"
    if not catalog.exists():
        log("  跳过：无 catalog（需先从 APK 提取，见 scripts/extract_apk.py）")
        return
    subprocess.run([sys.executable, str(script)], cwd=str(ROOT), check=True)


def update_missing_chars() -> None:
    log("\n[4/5] 新角色候选：catalog 有资源但未入库的 ID")
    script = ROOT / "scripts" / "find_new_character_ids.py"
    if script.exists():
        subprocess.run([sys.executable, str(script)], cwd=str(ROOT), check=True)

    # 自动补全：把可信候选写入 manual_characters.json 并刷新 parsed
    auto_fill = ROOT / "scripts" / "auto_fill_new_characters.py"
    if auto_fill.exists():
        log("  自动补全 TenkaAssist 未收录的新角色 …")
        subprocess.run([sys.executable, str(auto_fill)], cwd=str(ROOT), check=True)


def update_game_data() -> None:
    log("\n[游戏逆向] maindata / stringdata / Il2Cpp 状态 → data/")
    script = ROOT / "scripts" / "export_game_data_to_site.py"
    if not script.is_file():
        log("  跳过：无 export_game_data_to_site.py")
        return
    subprocess.run([sys.executable, str(script)], cwd=str(ROOT), check=True)
    parse_py = ROOT / "parse_characters.py"
    if parse_py.is_file():
        log("  刷新 characters_parsed.json（合并译名覆盖）…")
        subprocess.run([sys.executable, str(parse_py)], cwd=str(ROOT), check=True)


def update_maindata() -> None:
    log("\n[5/5] maindata 面板：Character_C → data/maindata_overlay.json")
    bundle = ROOT / "scripts" / "game_dump" / "bundles" / "maindata.bundle"
    parse_script = ROOT / "scripts" / "parse_maindata_tables.py"
    export_script = ROOT / "scripts" / "export_maindata_overlay.py"

    if bundle.is_file() and parse_script.is_file():
        log("  解析 maindata.bundle …")
        subprocess.run([sys.executable, str(parse_script)], cwd=str(ROOT), check=True)
    else:
        src = ROOT / "scripts" / "game_dump" / "extracted" / "characters_maindata.json"
        if src.is_file():
            log("  跳过解析（无 maindata.bundle），使用已有 characters_maindata.json")
        else:
            log("  跳过：无 maindata.bundle 且无 characters_maindata.json")
            return

    if export_script.is_file():
        subprocess.run([sys.executable, str(export_script)], cwd=str(ROOT), check=True)


def write_manifest() -> None:
    manifest = {
        "data_map": {
            "角色中英文名_属性_面板": {
                "本地文件": [
                    "characters_parsed.json",
                    "characters_parsed.csv",
                    "characterJson.js",
                ],
                "字段": "id, nameSc, nameEn, elementName, roleName, rarityName, hp, atk, cd, atkMag, ultMag, hpUp, po",
                "来源": TENKA_JS["characterJson.js"],
                "更新": "python scripts/update_all_data.py --chars",
            },
            "头像_立绘_TenkaAssist": {
                "URL 规则": f"{TENKA_BASE}/images/characters/cs{{角色ID}}_0_0.webp",
                "示例": f"{TENKA_BASE}/images/characters/cs10001_0_0.webp",
                "说明": "角色 ID 为 10001 格式；由前端 common.js charImageUrl 加载",
            },
            "头像_立绘_游戏资源": {
                "索引": "scripts/game_dump/index/catalog_all.csv",
                "按角色": "scripts/game_dump/index/local_by_character.json",
                "bundle 命名": "cg/cb/scg + 5位ID，如 cb10941_*.bundle",
                "说明": "bundle 为 Unity 加密包，索引仅文件名；解包需游戏密钥",
            },
            "配队_伤害_打桩": {
                "本地缓存": "data/compdata.json",
                "在线 API": "http://localhost:8080/api/comps/...（server.py 代理）",
                "精确计算": "assets/js/calculator.v3.js + autocalc.v3.js + characterJson.js",
                "更新配队库": "python scripts/update_all_data.py --comps",
            },
            "新角色预警": {
                "输出": "scripts/game_dump/index/missing_characters.json",
                "更新": "python scripts/find_new_character_ids.py",
            },
            "maindata_面板": {
                "本地文件": "data/maindata_overlay.json",
                "原始解析": "scripts/game_dump/extracted/characters_maindata.json",
                "说明": "从游戏 maindata.bundle Character_C 解析 hp_base/atk_base；ATK 优先 maindata，HP 未完全匹配时用 TenkaAssist 参考",
                "更新": "python scripts/update_all_data.py --maindata",
            },
            "手动收录角色": {
                "本地文件": "data/manual_characters.json",
                "说明": "TenkaAssist 尚未收录的新角色",
                "更新": "编辑 manual_characters.json 后运行 python parse_characters.py",
            },
            "简中译名覆盖": {
                "本地文件": "data/character_name_overrides.json",
                "说明": "官方面板 + 本地简中/别名（不覆盖 hp/atk）",
                "更新": "编辑后运行 python parse_characters.py",
            },
            "游戏译名_stringdata": {
                "本地文件": "data/game_character_names.json",
                "原始": "scripts/game_dump/extracted/character_names_from_game.json",
                "更新": "python scripts/export_game_data_to_site.py",
            },
            "Il2Cpp_dump": {
                "本地文件": "scripts/game_dump/il2cpp_dump/dump.cs",
                "状态": "data/game_data_status.json",
                "关键类": "TCharData, BattleCalculator, TStageData, BattleSys",
                "更新": "Zygisk 拉取后 python scripts/pull_zygisk_il2cpp_dump.py",
            },
            "新角色候选": {
                "本地文件": "data/new_character_candidates.json",
                "原始": "scripts/game_dump/index/missing_characters.json",
                "更新": "python scripts/update_all_data.py --index",
            },
            "自动同步": {
                "配置": "data/sync_config.json",
                "状态": "data/sync_meta.json",
                "说明": "python server.py 启动后每 6 小时与 TenkaAssist 比对更新；页眉「已同步」可手动刷新",
                "API": "GET /api/sync/status · POST /api/sync/run",
            },
        },
        "启动站点": "python server.py  →  http://localhost:8080",
    }
    path = ROOT / "data" / "data_sources.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"\n数据说明已写入 {path}")


def main() -> int:
    ap = argparse.ArgumentParser(description="更新打桩网数据")
    ap.add_argument("--chars", action="store_true", help="仅更新角色")
    ap.add_argument("--comps", action="store_true", help="仅更新配队库")
    ap.add_argument("--index", action="store_true", help="仅更新 bundle 索引")
    ap.add_argument("--maindata", action="store_true", help="仅导出 maindata 面板覆盖层")
    ap.add_argument("--game", action="store_true", help="仅导出游戏逆向数据到 data/")
    args = ap.parse_args()
    all_mode = not (args.chars or args.comps or args.index or args.maindata or args.game)

    try:
        if all_mode or args.chars:
            update_characters()
        if all_mode or args.comps:
            update_compdata()
        if all_mode or args.index:
            update_bundle_index()
            update_missing_chars()
        if args.maindata and not (all_mode or args.game):
            update_maindata()
        if all_mode or args.game:
            update_game_data()
        elif all_mode:
            update_maindata()
        write_manifest()
        from tenka_sync import load_meta, public_status, save_meta

        meta = load_meta()
        meta["last_sync_at"] = meta.get("characters_updated_at") or meta.get("compdata_updated_at")
        meta["last_sync_ok"] = True
        save_meta(meta)
        log(f"\n同步状态: {json.dumps(public_status(meta), ensure_ascii=False)}")
        log("\n完成。运行 python server.py 后刷新浏览器。")
        return 0
    except subprocess.CalledProcessError as e:
        log(f"\n子进程失败: {e}")
        return 1
    except urllib.error.URLError as e:
        log(f"\n网络错误: {e}")
        log("请检查网络，或手动从 TenkaAssist 下载 characterJson.js 到项目根目录后运行 parse_characters.py")
        return 1
    except Exception as e:
        log(f"\n错误: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
