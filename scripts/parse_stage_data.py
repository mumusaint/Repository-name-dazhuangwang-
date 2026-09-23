"""从 maindata Stage_C / EventStage_C 启发式提取 TStageData 字段（battleLevel / battleRare / battle）。

用法（项目根目录）：
    python scripts/parse_stage_data.py

说明：
- 表体为 C 混淆流式编码，无法 100% 还原 Obscured 字段；以 u16 stageId 锚点 + 邻近 u8 候选匹配。
- battleRare 限制 0–5（与游戏内敌人稀有/羁绊档位一致）。
"""
from __future__ import annotations

import json
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
RAW = SCRIPTS / "game_dump" / "extracted" / "maindata_raw"
OUT_EXTRACTED = SCRIPTS / "game_dump" / "extracted" / "stages_parsed.json"
OUT_SITE = ROOT / "data" / "stage_overlay.json"

sys.path.insert(0, str(SCRIPTS))
from maindata_reader import decode_stream  # noqa: E402


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_stage_blob(
    blob: bytes,
    *,
    source: str,
    id_max: int = 20000,
    rare_max: int = 5,
) -> list[dict]:
    if len(blob) < 8:
        return []
    hdr = struct.unpack_from("<I", blob, 0)[0]
    body = blob[hdr:] if hdr < len(blob) else blob
    best: dict[int, dict] = {}

    i = 0
    while i < len(body) - 16:
        sid = struct.unpack_from("<H", body, i)[0]
        if 1 <= sid <= id_max:
            stream = decode_stream(body[i : i + 96], 96)
            byte_vals = [x["v"] for x in stream if x["k"] == "u8" and isinstance(x["v"], int)]
            lv_cands = [v for v in byte_vals if 1 <= v <= 200]
            rare_cands = [v for v in byte_vals if 0 <= v <= rare_max]
            battle_cands = [
                x["v"]
                for x in stream
                if x["k"] in ("u32", "c32", "id")
                and isinstance(x["v"], int)
                and 100 <= x["v"] <= 60000
            ]
            if lv_cands and rare_cands:
                row = {
                    "stageId": sid,
                    "battleLevel": max(lv_cands),
                    "battleRare": max(rare_cands),
                    "battle": battle_cands[0] if battle_cands else None,
                    "source": source,
                    "offset": i,
                    "confidence": "heuristic",
                }
                prev = best.get(sid)
                if not prev or prev["offset"] > i:
                    best[sid] = row
        i += 2

    return sorted(best.values(), key=lambda r: r["stageId"])


def build_overlay(main_rows: list[dict], event_rows: list[dict]) -> dict:
    by_id: dict[str, dict] = {}
    for row in main_rows:
        sid = row["stageId"]
        by_id[str(sid)] = {
            "stageId": sid,
            "battleLevel": row["battleLevel"],
            "battleRare": row["battleRare"],
            "battle": row.get("battle"),
            "table": "Stage_C",
            "confidence": row["confidence"],
        }
    for row in event_rows:
        sid = row["stageId"]
        key = str(sid)
        entry = {
            "stageId": sid,
            "battleLevel": row["battleLevel"],
            "battleRare": row["battleRare"],
            "battle": row.get("battle"),
            "table": "EventStage_C",
            "confidence": row["confidence"],
        }
        if key not in by_id:
            by_id[key] = entry
        else:
            by_id[key]["eventStage"] = entry

    levels = [r["battleLevel"] for r in by_id.values()]
    return {
        "source": "maindata.bundle / Stage_C.bytes + EventStage_C.bytes",
        "updated": utc_now(),
        "schema": "TStageData.battleLevel / battleRare / battle（启发式）",
        "summary": {
            "stage_main": len(main_rows),
            "stage_event": len(event_rows),
            "by_id_total": len(by_id),
            "battle_level_min": min(levels) if levels else None,
            "battle_level_max": max(levels) if levels else None,
        },
        "byId": by_id,
        "highLevelSamples": sorted(
            [
                {
                    "stageId": r["stageId"],
                    "battleLevel": r["battleLevel"],
                    "battleRare": r["battleRare"],
                    "battle": r.get("battle"),
                }
                for r in main_rows
                if r["battleLevel"] >= 80
            ],
            key=lambda x: -x["battleLevel"],
        )[:12],
    }


def main() -> int:
    stage_path = RAW / "Stage_C.bin"
    event_path = RAW / "EventStage_C.bin"
    if not stage_path.is_file():
        print(f"缺少 {stage_path}，请先运行: python scripts/parse_maindata_tables.py")
        return 1

    main_rows = parse_stage_blob(stage_path.read_bytes(), source="Stage_C", id_max=20000)
    event_rows = []
    if event_path.is_file():
        event_rows = parse_stage_blob(event_path.read_bytes(), source="EventStage_C", id_max=8000)

    overlay = build_overlay(main_rows, event_rows)
    extracted = {
        "updated": overlay["updated"],
        "main": main_rows,
        "event": event_rows,
        "summary": overlay["summary"],
    }

    OUT_EXTRACTED.parent.mkdir(parents=True, exist_ok=True)
    OUT_EXTRACTED.write_text(json.dumps(extracted, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_SITE.parent.mkdir(parents=True, exist_ok=True)
    OUT_SITE.write_text(json.dumps(overlay, ensure_ascii=False, indent=2), encoding="utf-8")

    s = overlay["summary"]
    print(json.dumps(s, ensure_ascii=False, indent=2))
    print(f"extracted: {OUT_EXTRACTED}")
    print(f"site: {OUT_SITE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
