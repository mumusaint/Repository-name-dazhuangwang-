"""解析 LvUp / RankUp / NPCLvUp 二进制表（C-stream 格式）。"""
from __future__ import annotations

import json
import struct
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(__file__).parent / "game_dump" / "extracted" / "maindata_raw"
OUT = Path(__file__).parent / "game_dump" / "extracted" / "lvup_rankup_parsed.json"

KEY = 0x279BB3ED
MARKER = bytes.fromhex("edb29600")
BLOCK_SIZE = 21


def c32(raw: int) -> int:
    if raw in (0, KEY):
        return 0
    if (raw & 0xFF) == 0xED or ((raw >> 8) & 0xFF) in (0xB2, 0xB3):
        return raw ^ KEY
    return raw


def pick_need_exp(chunk: bytes) -> int | None:
    cands: list[int] = []
    for off in range(8, min(len(chunk) - 1, 20)):
        v = struct.unpack_from("<H", chunk, off)[0]
        if 350 <= v <= 30_000 and (v & 0xFF) != 0xED and (v >> 8) not in (0xB2, 0xB3):
            cands.append(v)
    for off in range(8, min(len(chunk) - 3, 20)):
        v = struct.unpack_from("<I", chunk, off)[0]
        if 350 <= v <= 300_000 and ((v >> 16) & 0xFFFF) != 0x14:
            cands.append(v)
    if not cands:
        return None
    u16s = [v for v in cands if v <= 30_000]
    return min(u16s) if u16s else min(cands)


@dataclass
class CharLvUpRow:
    lv: int
    need_exp: int | None
    stat_pct: int = 100


def find_markers(blob: bytes) -> list[int]:
    return [i for i in range(len(blob)) if blob.startswith(MARKER, i)]


def parse_char_lvup_table(blob: bytes, name: str) -> dict[str, Any]:
    if len(blob) < 16:
        return {"error": "too small", "name": name}
    count = struct.unpack_from("<I", blob, 0)[0]
    ver, max_lv = struct.unpack_from("<HH", blob, 4)
    markers = find_markers(blob)
    rows: list[CharLvUpRow] = []

    for lv in range(1, min(count, len(markers)) + 1):
        start = markers[lv - 1]
        end = markers[lv] if lv < len(markers) else len(blob)
        chunk = blob[start:end]
        stat = struct.unpack_from("<I", chunk, 4)[0] if len(chunk) >= 8 else 100
        need = pick_need_exp(chunk)
        rows.append(CharLvUpRow(lv=lv, need_exp=need, stat_pct=stat if stat == 100 else 100))

    return {
        "name": name,
        "count": count,
        "version": ver,
        "max_lv": max_lv,
        "block_marker": MARKER.hex(),
        "block_size_hint": BLOCK_SIZE,
        "parsed_rows": len(rows),
        "rows": [asdict(r) for r in rows],
    }


def stream_fields(data: bytes, start: int = 0, limit: int = 20_000) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pos = start
    while pos < min(len(data), start + limit):
        p0 = pos
        b = data[pos]
        if b == 0:
            out.append({"pos": p0, "kind": "zero", "value": 0})
            pos += 1
            continue
        if b == 0xED and pos + 4 <= len(data):
            out.append({"pos": p0, "kind": "c32", "value": c32(struct.unpack_from("<I", data, pos)[0])})
            pos += 4
            continue
        if pos + 4 <= len(data):
            out.append({"pos": p0, "kind": "u32", "value": struct.unpack_from("<I", data, pos)[0]})
            pos += 4
            continue
        if pos + 2 <= len(data):
            out.append({"pos": p0, "kind": "u16", "value": struct.unpack_from("<H", data, pos)[0]})
            pos += 2
            continue
        pos += 1
    return out


def parse_rankup_table(blob: bytes) -> dict[str, Any]:
    count = struct.unpack_from("<I", blob, 0)[0]
    fields = stream_fields(blob, 4)
    # 按 c32(0) 切分（edb39b27 = KEY）
    rows: list[list[dict[str, Any]]] = []
    cur: list[dict[str, Any]] = []
    for f in fields:
        if f["kind"] == "c32" and f["value"] == 0 and cur:
            rows.append(cur)
            cur = []
        cur.append(f)
    if cur:
        rows.append(cur)

    parsed = []
    for idx, rec in enumerate(rows[: min(count, 600)]):
        nums = [x["value"] for x in rec if x["kind"] in ("u32", "c32", "u16") and x["value"] != 0]
        parsed.append({"index": idx + 1, "nums": nums[:10]})

    return {
        "name": "RankUp",
        "count": count,
        "parsed_segments": len(rows),
        "sample_rows": parsed[:8],
        "note": "576 段 C-stream；字段待与 TRareUpData/RankUp 加载逻辑对齐",
    }


def main() -> int:
    lv = parse_char_lvup_table((RAW / "LvUp.bin").read_bytes(), "LvUp")
    npc = parse_char_lvup_table((RAW / "NPCLvUp.bin").read_bytes(), "NPCLvUp")
    rk = parse_rankup_table((RAW / "RankUp.bin").read_bytes())

    result = {
        "schema": {
            "loaders": "LoadLvUpData | LoadCharLvUpData | LoadRareUpData | LoadPotentialUpData",
            "TLvUpData": ["playerLv", "needExp", "energyMax", "femdomMax", "subscribeEnergyBonus", "subscribeFemdomBonus", "alchemy", "dispatch", "hire"],
            "TCharLvUpData": ["lv", "needExp"],
            "TRareUpData": ["charID", "rare", "cost", "itemID", "itemNum", "lv", "cost"],
            "TPotentialParmData": ["hp", "atk", "skill", "kind", "val"],
            "LvUp_bin": "u32 count + u16 ver + u16 maxLv + 60×(marker edb29600 + stat100 + needExp u16 + tail)",
            "RankUp_bin": "u32 count + C-stream 576 segments",
        },
        "LvUp": lv,
        "NPCLvUp": npc,
        "RankUp": rk,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    exps = [r["need_exp"] for r in lv["rows"] if r.get("need_exp")]
    print(f"LvUp: {lv['parsed_rows']}/{lv['count']} rows, needExp[0:5]={exps[:5]}")
    print(f"NPCLvUp: {npc['parsed_rows']}/{npc['count']} rows")
    print(f"RankUp: {rk['parsed_segments']} segments / {rk['count']}")
    print(f"-> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
