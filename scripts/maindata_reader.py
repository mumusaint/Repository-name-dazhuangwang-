"""maindata *_C.bytes 二进制读取（Character_C 面板记录 + C 整型解码）。"""
from __future__ import annotations

import struct
from typing import Any

KEY = 0x279BB3ED
K_HP = 44.422
K_ATK = 442.8826
RECORD_SIZE = 61

CHAR_EDIT_TYPES = [5, 3, 6, 6, 2, 5, 1, 8]
CHAR_EDIT_NAMES = ["u16_a", "u8_b", "s32_hp", "s32_atk", "s8_c", "u16_d", "bool_e", "s64_f"]


def c32(raw: int) -> int:
    if raw in (0, KEY):
        return 0
    if (raw & 0xFF) == 0xED or ((raw >> 8) & 0xFF) in (0xB2, 0xB3):
        return raw ^ KEY
    return raw


def decode_stream(data: bytes, limit: int = 80) -> list[dict[str, Any]]:
    """从 ID 锚点起按字节流解码（0=padding，0xED*=C32，否则 u32）。"""
    out: list[dict[str, Any]] = []
    pos = 0
    while pos < min(len(data), limit):
        b = data[pos]
        if b == 0:
            out.append({"k": "zero", "v": 0, "pos": pos})
            pos += 1
            continue
        if b == 0xED and pos + 4 <= len(data):
            raw = struct.unpack_from("<I", data, pos)[0]
            out.append({"k": "c32", "v": c32(raw), "raw": raw, "pos": pos})
            pos += 4
            continue
        if pos + 4 <= len(data):
            raw = struct.unpack_from("<I", data, pos)[0]
            kind = "id" if 10000 <= raw <= 20000 else "u32"
            out.append({"k": kind, "v": raw, "pos": pos})
            pos += 4
        else:
            out.append({"k": "u8", "v": b, "pos": pos})
            pos += 1
    return out


def _numeric_candidates(rec: bytes, cid: int) -> list[tuple[str, int, int]]:
    """从 61 字节记录提取可用于基数匹配的 plain u32/u16。"""
    found: list[tuple[str, int, int]] = []
    seen: set[int] = set()

    stream = decode_stream(rec, RECORD_SIZE)
    for item in stream:
        if item["k"] not in ("u32", "id"):
            continue
        v = int(item["v"])
        if v == cid or v in seen:
            continue
        if 1 <= v <= 500_000:
            found.append(("u32", v, item["pos"]))
            seen.add(v)

    for pos in range(4, RECORD_SIZE - 1):
        if pos + 2 > len(rec):
            break
        v = struct.unpack_from("<H", rec, pos)[0]
        if v in seen or v == cid:
            continue
        if 50 <= v <= 5000:
            found.append(("u16", v, pos))
            seen.add(v)

    return found


def _pick_property(stream: list[dict[str, Any]], cid: int) -> int | None:
    for item in reversed(stream):
        if item["k"] == "u32" and item["v"] != cid and 0 < item["v"] < 20:
            return int(item["v"])
    return None


def find_panel_record(
    blob: bytes,
    cid: int,
    ref: dict | None = None,
) -> dict[str, Any] | None:
    """扫描所有 ID 锚点，匹配 atk≈sb×K_ATK，并尽量还原 hp≈sa×K_HP。"""
    pat = struct.pack("<I", cid)
    best: tuple[float, dict[str, Any]] | None = None
    start = 0
    ref_hp = ref.get("hp") if ref else None
    ref_atk = ref.get("atk") if ref else None

    while True:
        off = blob.find(pat, start)
        if off < 0:
            break
        if off + RECORD_SIZE > len(blob):
            start = off + 1
            continue

        rec = blob[off : off + RECORD_SIZE]
        stream = decode_stream(rec, RECORD_SIZE)
        cands = _numeric_candidates(rec, cid)
        prop = _pick_property(stream, cid)

        atk_cands = [(k, v, p) for k, v, p in cands if 50 <= v <= 5000]
        hp_cands = [(k, v, p) for k, v, p in cands if v >= 50]

        for _, sb, sb_pos in atk_cands:
            atk_val = round(sb * K_ATK)
            atk_err = abs(ref_atk - atk_val) if ref_atk else 0
            if ref_atk and atk_err > 1:
                continue

            best_sa: tuple[int, int, float] | None = None
            for _, sa, sa_pos in hp_cands:
                if sa == sb:
                    continue
                hp_plain = round(sa * K_HP)
                hp_err = abs(ref_hp - hp_plain) / max(ref_hp, 1) if ref_hp else 1.0
                if best_sa is None or hp_err < best_sa[2]:
                    best_sa = (sa, sa_pos, hp_err)

            sa = best_sa[0] if best_sa else None
            sa_pos = best_sa[1] if best_sa else None
            hp_plain = round(sa * K_HP) if sa else 0
            hp_err = best_sa[2] if best_sa else 1.0

            if ref_atk and atk_err <= 1:
                if ref_hp and sa and hp_err < 0.02:
                    score = atk_err + hp_err
                    status = "ok"
                    hp_val = hp_plain
                else:
                    score = atk_err + 0.5
                    status = "atk_ok"
                    hp_val = None
            elif not ref_atk and sa:
                score = 5.0
                status = "base_only"
                hp_val = hp_plain
            else:
                continue

            row: dict[str, Any] = {
                "offset": off,
                "hp_base": sa,
                "atk_base": sb,
                "hp_base_pos": sa_pos,
                "atk_base_pos": sb_pos,
                "property": prop,
                "hp": hp_val,
                "atk": atk_val,
                "parse_status": status,
                "score": score,
            }
            if ref_hp and status == "atk_ok" and hp_plain > 0:
                row["hp_scale"] = round(ref_hp / hp_plain, 4)

            if best is None or score < best[0]:
                best = (score, row)

        start = off + 1

    return best[1] if best else None


def extract_character_panels(
    blob: bytes,
    known_ids: set[int],
    known: dict[int, dict] | None = None,
) -> dict[int, dict[str, Any]]:
    """为每个角色 ID 解析最佳面板记录。"""
    known = known or {}
    out: dict[int, dict[str, Any]] = {}
    for cid in sorted(known_ids):
        ref = known.get(cid)
        panel = find_panel_record(blob, cid, ref)
        if panel:
            out[cid] = panel
    return out


def parse_character_edit_schema(blob: bytes) -> dict[str, Any]:
    if len(blob) < 6:
        return {"error": "too small"}
    return {
        "version": struct.unpack_from("<I", blob, 0)[0],
        "meta_byte": blob[4],
        "column_types": list(blob[6:]),
        "columns": dict(zip(CHAR_EDIT_NAMES, CHAR_EDIT_TYPES)),
    }


def discover_character_ids(blob: bytes) -> set[int]:
    """发现 Character_C 中出现的角色 ID（10000–20000）。"""
    hdr = struct.unpack_from("<I", blob, 0)[0] if len(blob) >= 4 else 0
    data = blob[hdr:]
    ids: set[int] = set()
    for i in range(0, len(data) - 3, 4):
        cid = struct.unpack_from("<I", data, i)[0]
        if 10000 <= cid <= 20000:
            ids.add(cid)
    return ids


def build_panel_rows(
    char_c: bytes,
    known: dict[int, dict],
) -> list[dict[str, Any]]:
    """导出角色行：从 Character_C 解析 hpBase/atkBase 并计算满配面板。"""
    ids = set(known) | discover_character_ids(char_c)
    panels = extract_character_panels(char_c, ids, known)
    rows: list[dict[str, Any]] = []

    for cid in sorted(ids):
        ref = known.get(cid, {})
        panel = panels.get(cid)
        row: dict[str, Any] = {
            "id": cid,
            "nameSc": ref.get("nameSc"),
            "hp": panel.get("hp") if panel else None,
            "atk": panel.get("atk") if panel else None,
            "cd": ref.get("cd"),
            "hp_panel_ref": ref.get("hp"),
            "atk_panel_ref": ref.get("atk"),
            "cd_ref": ref.get("cd"),
            "hp_base": panel.get("hp_base") if panel else None,
            "atk_base": panel.get("atk_base") if panel else None,
            "property": panel.get("property") if panel else None,
            "offset": panel.get("offset") if panel else None,
        }
        if panel:
            row["parse_status"] = panel.get("parse_status", "partial")
            if panel.get("hp_scale"):
                row["hp_scale"] = panel["hp_scale"]
            if row["parse_status"] == "ok":
                row["note"] = "hp=hp_base×44.422, atk=atk_base×442.8826"
            elif row["parse_status"] == "atk_ok":
                row["note"] = "atk 已从 maindata 解析；hp 需 LvUp/RankUp 倍率（见 hp_scale）"
            else:
                row["note"] = "仅提取基数，面板公式未完全匹配"
        else:
            row["parse_status"] = "not_found"
            row["note"] = "Character_C 中未找到可匹配的面板记录"

        rows.append(row)

    return rows
