"""与 TenkaAssist / tenkaassist_data 同步角色与配队库（供 server 与 update_all_data 调用）"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYNC_META_PATH = ROOT / "data" / "sync_meta.json"
SYNC_CONFIG_PATH = ROOT / "data" / "sync_config.json"

TENKA_BASE = "https://inittt.github.io/tenkaassist"
TENKA_JS = {
    "characterJson.js": f"{TENKA_BASE}/js/characterJson.js",
    "common.js": f"{TENKA_BASE}/js/common.js",
}
# 计算器引擎：远端 tenkaassist/js/ 已无此二文件（404）。
# 本地 assets/js/ 已存有可用副本，作为打桩核心引擎保留。
# 同步时仍尝试更新（若远端恢复即可拿回新版），失败则静默保留本地，不再刷日志噪音。
TENKA_JS_OPTIONAL = {
    "calculator.v3.js": f"{TENKA_BASE}/js/calculator.v3.js",
    "autocalc.v3.js": f"{TENKA_BASE}/js/autocalc.v3.js",
}
COMP_URLS = [
    "https://cdn.jsdelivr.net/gh/inittt/tenkaassist_data@main/data/data.json",
    "https://raw.githubusercontent.com/inittt/tenkaassist_data/main/data/data.json",
    "https://raw.gitmirror.com/inittt/tenkaassist_data/main/data/data.json",
]

_sync_lock = threading.Lock()
UA = "dazhuang-sync/1.0"


def log(msg: str) -> None:
    print(msg, flush=True)


def load_config() -> dict:
    defaults = {
        "enabled": True,
        "interval_hours": 6,
        "sync_on_startup": True,
        "sync_characters": True,
        "sync_compdata": True,
    }
    if not SYNC_CONFIG_PATH.is_file():
        return defaults
    try:
        raw = json.loads(SYNC_CONFIG_PATH.read_text(encoding="utf-8"))
        return {**defaults, **raw}
    except Exception:
        return defaults


def load_meta() -> dict:
    if not SYNC_META_PATH.is_file():
        return {}
    try:
        return json.loads(SYNC_META_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_meta(meta: dict) -> None:
    SYNC_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    SYNC_META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def remote_fingerprint(url: str, timeout: int = 30, retries: int = 2) -> dict:
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return {
                        "etag": resp.headers.get("ETag"),
                        "last_modified": resp.headers.get("Last-Modified"),
                        "content_length": resp.headers.get("Content-Length"),
                    }
            except Exception:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    chunk = resp.read(65536)
                    return {
                        "etag": None,
                        "last_modified": resp.headers.get("Last-Modified"),
                        "content_length": resp.headers.get("Content-Length"),
                        "sample_hash": hashlib.sha256(chunk).hexdigest()[:16],
                    }
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    raise last_err  # type: ignore[misc]


def fingerprint_changed(stored: dict | None, remote: dict) -> bool:
    if not stored:
        return True
    for key in ("etag", "last_modified", "content_length", "sample_hash"):
        a, b = stored.get(key), remote.get(key)
        if a and b and a != b:
            return True
    if not any(stored.get(k) for k in ("etag", "last_modified", "content_length")):
        return True
    return False


def download(url: str, dest: Path | None = None, timeout: int = 120, retries: int = 2) -> bytes:
    """下载到内存；dest 不为 None 时写盘。瞬断（10054 等）自动重试。"""
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            break
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    else:
        raise last_err  # type: ignore[misc]
    if dest is not None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return data


def parse_character_total(js_path: Path) -> int:
    text = js_path.read_text(encoding="utf-8")
    ids = re.findall(r"\bid\s*:\s*(\d+)", text)
    return len(set(ids))


def sync_characters(force: bool = False) -> dict:
    result = {"updated": False, "skipped": False, "error": None}
    url = TENKA_JS["characterJson.js"]
    dest = ROOT / "characterJson.js"
    meta = load_meta()
    try:
        remote_fp = remote_fingerprint(url)
        if not force and dest.is_file() and not fingerprint_changed(meta.get("characters_remote"), remote_fp):
            result["skipped"] = True
            return result
        # 原子化：先全部下载到内存，全部成功后才写盘，
        # 避免中途断线留下新 characterJson + 旧 common.js 的不一致状态
        blobs: dict[Path, bytes] = {}
        blobs[dest] = download(url)
        blobs[ROOT / "common.js"] = download(TENKA_JS["common.js"])
        for name, calc_url in TENKA_JS_OPTIONAL.items():
            calc_dest = ROOT / "assets" / "js" / name
            try:
                blobs[calc_dest] = download(calc_url)
            except Exception:
                if not calc_dest.is_file():
                    raise
                # 远端不可用时静默保留本地副本，避免每次同步刷 404 噪音
        for path, data in blobs.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        subprocess.run(
            [sys.executable, str(ROOT / "parse_characters.py")],
            cwd=str(ROOT),
            check=True,
            capture_output=True,
        )
        parsed = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
        meta["characters_remote"] = remote_fp
        meta["character_total"] = parsed.get("total", parse_character_total(dest))
        meta["characters_updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        meta["revision"] = int(time.time())
        save_meta(meta)
        result["updated"] = True
        result["character_total"] = meta["character_total"]
        log(f"角色已同步: {meta['character_total']} 名")
    except Exception as e:
        result["error"] = str(e)
        log(f"角色同步失败: {e}")
    return result


def sync_compdata(force: bool = False) -> dict:
    result = {"updated": False, "skipped": False, "error": None}
    dest = ROOT / "data" / "compdata.json"
    meta = load_meta()
    last_err = None
    for url in COMP_URLS:
        try:
            remote_fp = remote_fingerprint(url)
            if not force and dest.is_file() and not fingerprint_changed(meta.get("compdata_remote"), remote_fp):
                result["skipped"] = True
                return result
            data = download(url, dest)
            meta["compdata_remote"] = remote_fp
            meta["compdata_bytes"] = len(data)
            meta["compdata_updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            meta["revision"] = int(time.time())
            save_meta(meta)
            result["updated"] = True
            result["compdata_bytes"] = len(data)
            log(f"配队库已同步: {len(data) / 1024 / 1024:.1f} MB")
            return result
        except Exception as e:
            last_err = e
    result["error"] = str(last_err or "配队库下载失败")
    log(f"配队库同步失败: {result['error']}")
    return result


def sync_remote(force: bool = False, chars: bool = True, comps: bool = True) -> dict:
    """线程安全：与 TenkaAssist 同步。返回汇总结果。"""
    if not _sync_lock.acquire(blocking=False):
        return {"ok": False, "busy": True, "message": "同步正在进行中"}
    try:
        cfg = load_config()
        if not cfg.get("enabled", True) and not force:
            return {"ok": False, "disabled": True}
        out = {
            "ok": True,
            "force": force,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "characters": None,
            "compdata": None,
        }
        if chars and cfg.get("sync_characters", True):
            out["characters"] = sync_characters(force=force)
        if comps and cfg.get("sync_compdata", True):
            out["compdata"] = sync_compdata(force=force)
        meta = load_meta()
        meta["last_sync_at"] = out["started_at"]
        char_res = out.get("characters") or {}
        comp_res = out.get("compdata") or {}
        meta["characters_ok"] = not char_res.get("error")
        meta["compdata_ok"] = not comp_res.get("error")
        meta["characters_error"] = char_res.get("error")
        meta["compdata_error"] = comp_res.get("error")
        meta["last_sync_ok"] = meta["characters_ok"] or meta["compdata_ok"]
        save_meta(meta)
        out["meta"] = public_status(meta)
        return out
    finally:
        _sync_lock.release()


def is_syncing() -> bool:
    return _sync_lock.locked()


def public_status(meta: dict | None = None) -> dict:
    meta = meta or load_meta()
    return {
        "revision": meta.get("revision"),
        "last_sync_at": meta.get("last_sync_at"),
        "last_sync_ok": meta.get("last_sync_ok", False),
        "characters_ok": meta.get("characters_ok", meta.get("characters_updated_at") is not None),
        "compdata_ok": meta.get("compdata_ok", meta.get("compdata_updated_at") is not None),
        "characters_error": meta.get("characters_error"),
        "compdata_error": meta.get("compdata_error"),
        "character_total": meta.get("character_total"),
        "characters_updated_at": meta.get("characters_updated_at"),
        "compdata_updated_at": meta.get("compdata_updated_at"),
        "compdata_bytes": meta.get("compdata_bytes"),
        "syncing": is_syncing(),
        "source": TENKA_BASE,
    }


def is_stale(hours: float | None = None) -> bool:
    cfg = load_config()
    hours = hours if hours is not None else float(cfg.get("interval_hours", 6))
    meta = load_meta()
    rev = meta.get("revision")
    if not rev:
        return True
    if not (ROOT / "characters_parsed.json").is_file():
        return True
    if not (ROOT / "data" / "compdata.json").is_file():
        return True
    last = meta.get("last_sync_at")
    if not last:
        return True
    try:
        from datetime import datetime, timezone

        t = datetime.strptime(last, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() > hours * 3600
    except Exception:
        return True


def start_background_scheduler(on_compdata_updated=None) -> None:
    """守护线程：启动时与每隔 interval_hours 自动同步。"""
    cfg = load_config()
    if not cfg.get("enabled", True):
        log("自动同步已禁用（data/sync_config.json enabled=false）")
        return

    interval = max(1.0, float(cfg.get("interval_hours", 6))) * 3600

    def _run(force: bool = False) -> None:
        try:
            res = sync_remote(force=force)
            comp = res.get("compdata") or {}
            if comp.get("updated") and callable(on_compdata_updated):
                on_compdata_updated()
        except Exception as e:
            log(f"后台同步异常: {e}")

    if cfg.get("sync_on_startup", True) and is_stale():
        threading.Thread(target=lambda: _run(False), daemon=True, name="tenka-sync-start").start()

    def _loop() -> None:
        while True:
            time.sleep(interval)
            _run(False)

    threading.Thread(target=_loop, daemon=True, name="tenka-sync-loop").start()
    log(f"自动同步已启用：每 {cfg.get('interval_hours', 6)} 小时检查 TenkaAssist 更新")
