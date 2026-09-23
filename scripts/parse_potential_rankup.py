"""解析 PotentialUp / RankUp，并与 Character_C 字段拟合 hp_scale。"""
from __future__ import annotations

import json
import struct
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "scripts" / "game_dump" / "extracted" / "maindata_raw"
OUT = ROOT / "scripts" / "game_dump" / "extracted" / "hp_scale_analysis.json"

KEY = 0x279BB3ED
K_HP = 44.422
POT_MARKER = bytes.fromhex("edb38800")


def c32(raw: int) -> int:
    if raw in (0, KEY):
        return 0
    if (raw & 0xFF) == 0xED or ((raw >> 8) & 0xFF) in (0xB2, 0xB3):
        return raw ^ KEY
    return raw


@dataclass
class PotentialParm:
    potential_id: int
    hp: int
    atk: int
    skill: int
    kind: int
    val: int
    level: int


def parse_potential_up(blob: bytes) -> dict[str, Any]:
    """PotentialUp.bin：C-stream 块，hp=30000+potentialID。"""
    rows: list[PotentialParm] = []
    for m in range(len(blob)):
        if not blob.startswith(POT_MARKER, m) or m + 16 > len(blob):
            continue
        hp = struct.unpack_from("<H", blob, m + 4)[0]
        lv = struct.unpack_from("<H", blob, m + 6)[0]
        atk = struct.unpack_from("<H", blob, m + 8)[0]
        skill = struct.unpack_from("<H", blob, m + 12)[0]
        val = struct.unpack_from("<H", blob, m + 14)[0]
        if val in (46061, 0) or val > 50_000:
            # 46061=0xB38D 为流内标记噪声，真实 val 常在相邻块
            val = 0
        pid = hp - 30_000 if hp >= 30_000 else hp
        rows.append(
            PotentialParm(
                potential_id=pid,
                hp=hp,
                atk=atk,
                skill=skill,
                kind=skill,
                val=val,
                level=lv,
            )
        )

    by_pid: dict[int, list[PotentialParm]] = defaultdict(list)
    for r in rows:
        by_pid[r.potential_id].append(r)

    summary = {}
    for pid, items in sorted(by_pid.items()):
        lv1 = next((x for x in items if x.level == 1), items[0])
        summary[pid] = {
            "hp_permille": lv1.hp,
            "atk_permille": lv1.atk,
            "hp_mult_est": round(lv1.hp / 10_000, 4),
            "atk_mult_est": round(lv1.atk / 10_000, 4),
            "levels": sorted(set(x.level for x in items)),
            "val_samples": sorted(set(x.val for x in items if x.val))[:8],
        }

    return {
        "format": "C-stream marker edb38800; TPotentialParmData { hp, atk, skill, kind, val }",
        "header": {
            "version": struct.unpack_from("<I", blob, 0)[0],
            "hint_rows": blob[5] if len(blob) > 5 else None,
        },
        "markers": len(rows),
        "potential_ids": sorted(by_pid),
        "by_potential_id": summary,
        "rows_sample": [asdict(r) for r in rows[:12]],
    }


def parse_rankup_segments(blob: bytes) -> dict[str, Any]:
    count = struct.unpack_from("<I", blob, 0)[0]
    pos = 4
    segments: list[list[int]] = []
    cur: list[int] = []

    while pos < len(blob):
        b = blob[pos]
        if b == 0:
            pos += 1
            continue
        if b == 0xED and pos + 4 <= len(blob):
            v = c32(struct.unpack_from("<I", blob, pos)[0])
            if v == 0 and cur:
                segments.append(cur)
                cur = []
            else:
                cur.append(v)
            pos += 4
        elif pos + 4 <= len(blob):
            cur.append(struct.unpack_from("<I", blob, pos)[0])
            pos += 4
        else:
            pos += 1
    if cur:
        segments.append(cur)

    # 提取小整数候选（rank / cost / hp%）
    parsed = []
    for i, seg in enumerate(segments[:count]):
        small = [x for x in seg if 0 < x <= 50_000]
        parsed.append({"index": i + 1, "nums": small[:12]})

    return {
        "count": count,
        "segments_found": len(segments),
        "sample": parsed[:10],
        "note": "576 段 C-stream；未定型，需 dump.cs 中 TRareUpData/RankUp 加载逻辑",
    }


def load_char_scan() -> dict[int, list[dict]]:
    p = ROOT / "scripts/game_dump/extracted/character_c_scan.json"
    by_id: dict[int, list[dict]] = defaultdict(list)
    for row in json.loads(p.read_text(encoding="utf-8"))["rows"]:
        by_id[row["id"]].append(row)
    return by_id


def pick_scan(by_id: dict[int, list[dict]], cid: int, offset: int) -> dict | None:
    hits = by_id.get(cid)
    if not hits:
        return None
    return min(hits, key=lambda h: abs(h["offset"] - offset))


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def fit_hp_scale(char_rows: list[dict], pot: dict) -> dict[str, Any]:
    """用 property / rare / potentialID / RankUp 候选字段拟合 hp_scale。"""
    by_id = load_char_scan()
    known = load_known()
    samples = []

    for c in char_rows:
        if not c.get("hp_scale") or not c.get("offset"):
            continue
        scan = pick_scan(by_id, c["id"], c["offset"])
        ref = known.get(c["id"], {})
        if not scan:
            continue
        p24 = scan.get("f_p24", 0)
        p28 = scan.get("f_p28", 0)
        p64 = scan.get("f_p64", 0)
        # potentialID 候选：小 u32 或 p64 低范围
        pot_id = None
        for cand in (p64, p28, scan.get("f_p32", 0)):
            if isinstance(cand, int) and 1 <= cand <= 12:
                pot_id = cand
                break
        samples.append(
            {
                "id": c["id"],
                "nameSc": c.get("nameSc"),
                "hp_scale": c["hp_scale"],
                "property": c.get("property") or (p28 if 0 < p28 < 20 else None),
                "rarity": ref.get("rarity"),
                "potential_id_guess": pot_id,
                "f_p24": p24 if p24 < 10_000_000 else None,
                "f_p64": p64 if p64 < 10_000_000 else None,
                "f_p72": scan.get("f_p72"),
            }
        )

    # 按 property 分组统计
    by_prop: dict[Any, list[float]] = defaultdict(list)
    by_rare: dict[Any, list[float]] = defaultdict(list)
    for s in samples:
        if s["property"] is not None:
            by_prop[s["property"]].append(s["hp_scale"])
        if s["rarity"] is not None:
            by_rare[s["rarity"]].append(s["hp_scale"])

    prop_stats = {
        k: {"n": len(v), "mean": round(sum(v) / len(v), 3), "min": round(min(v), 3), "max": round(max(v), 3)}
        for k, v in sorted(by_prop.items(), key=lambda x: str(x[0]))
    }
    rare_stats = {
        k: {"n": len(v), "mean": round(sum(v) / len(v), 3)}
        for k, v in sorted(by_rare.items(), key=lambda x: str(x[0]))
    }

    # 尝试 hp_scale ≈ potential_mult * rank_factor（potential mult ~3.0x 不足以单独解释）
    pot_mult = {int(k): v["hp_mult_est"] for k, v in pot.get("by_potential_id", {}).items()}

    return {
        "sample_count": len(samples),
        "samples": samples,
        "property_stats": prop_stats,
        "rarity_stats": rare_stats,
        "potential_table_mult": pot_mult,
        "conclusion": (
            "rarity 多为 3，区分度不足；property 与 hp_scale 弱相关；"
            "PotentialUp 表内 hp≈3000x(1.000x) 仅 ~3 倍，无法单独解释 1.3~19x 的 hp_scale；"
            "更可能需 RankUp/满级等级系数或 diff 字段，待 Zygisk dump.cs 确认公式"
        ),
    }


def apply_potential_hp(char_rows: list[dict], pot: dict) -> list[dict]:
    """若 potentialID 已知，试算 hp = hp_base * K_HP * pot_mult。"""
    by_id = load_char_scan()
    out = []
    table = pot.get("by_potential_id", {})
    for c in char_rows:
        if c.get("parse_status") != "atk_ok" or not c.get("hp_base"):
            continue
        scan = pick_scan(by_id, c["id"], c.get("offset") or 0)
        if not scan:
            continue
        pid = None
        for cand in (scan.get("f_p64"), scan.get("f_p28"), scan.get("f_p32")):
            if isinstance(cand, int) and 1 <= cand <= 12:
                pid = str(cand)
                break
        mult = table.get(pid, {}).get("hp_mult_est") if pid else None
        if mult:
            est = round(c["hp_base"] * K_HP * mult)
            out.append(
                {
                    "id": c["id"],
                    "potential_id": int(pid),
                    "hp_est": est,
                    "hp_ref": c.get("hp_panel_ref"),
                    "hp_scale_ref": c.get("hp_scale"),
                    "pot_mult": mult,
                }
            )
    return out


def main() -> int:
    pot_blob = (RAW / "PotentialUp.bin").read_bytes()
    rk_blob = (RAW / "RankUp.bin").read_bytes()
    pot = parse_potential_up(pot_blob)
    rk = parse_rankup_segments(rk_blob)

    chars = json.loads(
        (ROOT / "scripts/game_dump/extracted/characters_maindata.json").read_text(encoding="utf-8")
    )["characters"]
    fit = fit_hp_scale(chars, pot)
    pot_try = apply_potential_hp(chars, pot)

    result = {
        "PotentialUp": pot,
        "RankUp": rk,
        "hp_scale_fit": fit,
        "potential_hp_trial": pot_try[:20],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"PotentialUp: {len(pot['potential_ids'])} ids, markers={pot['markers']}")
    for pid, info in pot["by_potential_id"].items():
        print(f"  pot{pid}: hp_mult~{info['hp_mult_est']} val={info['val_samples']}")
    print(f"RankUp: {rk['segments_found']} segments / {rk['count']}")
    print(f"hp_scale samples: {fit['sample_count']}")
    print(f"-> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
