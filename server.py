"""本地静态服务 + TenkaAssist API 代理（解决 CORS）+ 自动数据同步"""

import json

import os

import re

import sys

import threading

import urllib.request

import urllib.error

import zlib

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from pathlib import Path



API_BASE = "https://port-0-tenkafuma-assistant-server-1272llx2xidhk.sel5.cloudtype.app"

COMP_DATA_URL = "https://cdn.jsdelivr.net/gh/inittt/tenkaassist_data@main/data/data.json"

COMP_DATA_MIRROR = "https://raw.githubusercontent.com/inittt/tenkaassist_data/main/data/data.json"

COMP_DATA_MIRROR2 = "https://raw.gitmirror.com/inittt/tenkaassist_data/main/data/data.json"

PORT = 8080

ROOT = Path(__file__).resolve().parent

COMP_CACHE = ROOT / "data" / "compdata.json"

_comp_by_id_cache = None



sys.path.insert(0, str(ROOT / "scripts"))

try:

    from tenka_sync import is_syncing, load_meta, public_status, start_background_scheduler, sync_remote

except ImportError:

    is_syncing = load_meta = public_status = start_background_scheduler = sync_remote = None





def decompress_compdata(raw: bytes) -> list:

    if raw[:2] == b"\x1f\x8b":

        text = zlib.decompress(raw, 31).decode("utf-8")

    else:

        last_err = None

        for wbits in (-15, 15):

            try:

                text = zlib.decompress(raw, wbits).decode("utf-8")

                break

            except zlib.error as e:

                last_err = e

        else:

            raise last_err or zlib.error("无法解压配队库")

    return json.loads(text)





def clear_comp_index_cache() -> None:

    global _comp_by_id_cache

    _comp_by_id_cache = None





def load_comp_by_id_index() -> dict:

    global _comp_by_id_cache

    if _comp_by_id_cache is not None:

        return _comp_by_id_cache

    if not COMP_CACHE.is_file():

        raise FileNotFoundError("配队库未缓存，请先访问 /api/compdata 下载")

    raw = COMP_CACHE.read_bytes()

    data = decompress_compdata(raw)

    _comp_by_id_cache = {int(c["id"]): c for c in data if c.get("id") is not None}

    print(f"配队索引已加载: {len(_comp_by_id_cache):,} 套")

    return _comp_by_id_cache





class Handler(SimpleHTTPRequestHandler):

    def end_headers(self):

        self.send_header("Access-Control-Allow-Origin", "*")

        # 数据文件禁止浏览器缓存，确保同步后前端能拿到最新数据
        if self.path.endswith(".json") or self.path.endswith(".js"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")

        super().end_headers()



    def do_OPTIONS(self):

        self.send_response(204)

        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

        self.send_header("Access-Control-Allow-Headers", "Content-Type")

        self.end_headers()



    def do_GET(self):

        if self.path.startswith("/api/health"):

            return self.serve_health()

        if self.path.startswith("/api/sync/status"):

            return self.serve_sync_status()

        if self.path.startswith("/api/autofill/status"):

            return self.serve_autofill_status()

        if self.path.startswith("/api/compdata"):

            return self.serve_compdata()

        local_match = re.match(r"/api/comp/local/(\d+)", self.path.split("?", 1)[0])

        if local_match:

            return self.serve_comp_local(int(local_match.group(1)))

        if self.path.startswith("/api/"):

            return self.proxy_get()

        return super().do_GET()



    def send_json(self, status: int, payload: dict):

        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        self.send_response(status)

        self.send_header("Content-Type", "application/json; charset=utf-8")

        self.send_header("Cache-Control", "no-store")

        self.send_header("Content-Length", str(len(body)))

        self.end_headers()

        self.wfile.write(body)



    def serve_health(self):

        try:

            checks = {

                "characters_parsed": (ROOT / "characters_parsed.json").is_file(),

                "compdata": COMP_CACHE.is_file(),

                "characterJson": (ROOT / "characterJson.js").is_file(),

            }

            ok = all(checks.values())

            self.send_json(200 if ok else 503, {"ok": ok, "checks": checks})

        except Exception as e:

            self.send_json(500, {"ok": False, "error": str(e)})



    def serve_sync_status(self):

        try:

            if public_status is None:

                self.send_json(503, {"error": "sync module unavailable"})

                return

            status = public_status(load_meta())

            if is_syncing is not None:

                status["syncing"] = is_syncing()

            self.send_json(200, status)

        except Exception as e:

            self.send_json(502, {"error": str(e)})



    def do_POST(self):

        if self.path.startswith("/api/sync/run"):

            return self.serve_sync_run()

        if self.path.startswith("/api/autofill/run"):

            return self.serve_autofill_run()

        if self.path.startswith("/api/"):

            return self.proxy_post()

        self.send_error(404)



    def serve_sync_run(self):

        if sync_remote is None:

            self.send_error(503, "sync module unavailable")

            return

        try:

            length = int(self.headers.get("Content-Length", 0))

            raw = self.rfile.read(length) if length else b"{}"

            payload = json.loads(raw.decode("utf-8") or "{}")

            force = bool(payload.get("force"))

            result = sync_remote(force=force)

            if (result.get("compdata") or {}).get("updated"):

                clear_comp_index_cache()

            body = json.dumps(result, ensure_ascii=False).encode("utf-8")

            self.send_response(200)

            self.send_header("Content-Type", "application/json; charset=utf-8")

            self.send_header("Content-Length", str(len(body)))

            self.end_headers()

            self.wfile.write(body)

        except Exception as e:

            self.send_json(502, {"error": str(e)})



    def serve_autofill_status(self):
        """检查是否有 TenkaAssist 未收录的新角色可补全"""
        try:
            import subprocess, sys
            script = ROOT / "scripts" / "auto_fill_new_characters.py"
            if not script.is_file():
                self.send_json(503, {"error": "auto_fill script not found"})
                return
            r = subprocess.run(
                [sys.executable, str(script), "--dry-run"],
                cwd=str(ROOT), capture_output=True, text=True, timeout=30,
            )
            self.send_json(200, {
                "ok": r.returncode == 0,
                "output": r.stdout.strip(),
            })
        except Exception as e:
            self.send_json(502, {"error": str(e)})



    def serve_autofill_run(self):
        """执行自动补全：扫描新角色 → 写入 manual_characters.json → 刷新 parsed"""
        try:
            import subprocess, sys
            script = ROOT / "scripts" / "auto_fill_new_characters.py"
            if not script.is_file():
                self.send_json(503, {"error": "auto_fill script not found"})
                return
            r = subprocess.run(
                [sys.executable, str(script)],
                cwd=str(ROOT), capture_output=True, text=True, timeout=60,
            )
            ok = r.returncode == 0
            self.send_json(200 if ok else 500, {
                "ok": ok,
                "output": r.stdout.strip(),
                "error": r.stderr.strip() if r.stderr else None,
            })
        except Exception as e:
            self.send_json(502, {"error": str(e)})



    def serve_comp_local(self, comp_id: int):

        try:

            index = load_comp_by_id_index()

            hit = index.get(comp_id)

            if not hit:

                body = json.dumps({"success": False, "msg": "未找到该配队"}, ensure_ascii=False).encode("utf-8")

                self.send_response(404)

            else:

                body = json.dumps({"success": True, "data": hit}, ensure_ascii=False).encode("utf-8")

                self.send_response(200)

            self.send_header("Content-Type", "application/json; charset=utf-8")

            self.send_header("Content-Length", str(len(body)))

            self.end_headers()

            self.wfile.write(body)

        except Exception as e:

            self.send_error(502, str(e))



    def serve_compdata(self):

        try:

            body = self._load_compdata_bytes()

            self.send_response(200)

            self.send_header("Content-Type", "application/octet-stream")

            self.send_header("Content-Length", str(len(body)))

            self.end_headers()

            self.wfile.write(body)

        except Exception as e:

            self.send_error(502, str(e))



    def _load_compdata_bytes(self) -> bytes:

        if COMP_CACHE.is_file():

            return COMP_CACHE.read_bytes()

        body = self._download_compdata()

        COMP_CACHE.parent.mkdir(parents=True, exist_ok=True)

        COMP_CACHE.write_bytes(body)

        print(f"配队库已缓存 -> {COMP_CACHE} ({len(body) / 1024 / 1024:.1f} MB)")

        return body



    def _download_compdata(self) -> bytes:

        last_err = None

        for url in (COMP_DATA_URL, COMP_DATA_MIRROR, COMP_DATA_MIRROR2):

            try:

                print(f"正在下载配队库: {url}")

                req = urllib.request.Request(url, method="GET")

                with urllib.request.urlopen(req, timeout=120) as resp:

                    return resp.read()

            except Exception as e:

                last_err = e

                print(f"下载失败: {url} -> {e}")

        raise last_err or RuntimeError("配队库下载失败")



    def proxy_get(self):

        target = API_BASE + self.path[len("/api"):]

        try:

            req = urllib.request.Request(target, method="GET")

            with urllib.request.urlopen(req, timeout=30) as resp:

                body = resp.read()

                self.send_response(resp.status)

                self.send_header("Content-Type", "application/json; charset=utf-8")

                self.end_headers()

                self.wfile.write(body)

        except urllib.error.HTTPError as e:

            self.send_response(e.code)

            self.send_header("Content-Type", "application/json")

            self.end_headers()

            self.wfile.write(e.read())

        except Exception as e:

            self.send_error(502, str(e))



    def proxy_post(self):

        target = API_BASE + self.path[len("/api"):]

        length = int(self.headers.get("Content-Length", 0))

        body = self.rfile.read(length) if length else b""

        try:

            req = urllib.request.Request(

                target, data=body, method="POST",

                headers={"Content-Type": self.headers.get("Content-Type", "application/x-www-form-urlencoded")},

            )

            with urllib.request.urlopen(req, timeout=30) as resp:

                data = resp.read()

                self.send_response(resp.status)

                self.send_header("Content-Type", "application/json; charset=utf-8")

                self.end_headers()

                self.wfile.write(data)

        except urllib.error.HTTPError as e:

            self.send_response(e.code)

            self.send_header("Content-Type", "application/json")

            self.end_headers()

            self.wfile.write(e.read())

        except Exception as e:

            self.send_error(502, str(e))





if __name__ == "__main__":

    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    if start_background_scheduler is not None:

        start_background_scheduler(on_compdata_updated=clear_comp_index_cache)

    server = ThreadingHTTPServer(("", PORT), Handler)

    print(f"打桩网: http://localhost:{PORT}")

    print(f"API 代理: http://localhost:{PORT}/api/comps/...")

    print(f"数据同步: /api/sync/status · 自动每 6h（见 data/sync_config.json）")

    server.serve_forever()

