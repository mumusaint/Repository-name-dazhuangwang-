"""为每个角色匹配 Character_C 主记录（+8 hp基, +16 atk基）并计算面板。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOB = ROOT / "scripts/game_dump/extracted/maindata_raw/Character_C.bin"
KEY = 0x279BB3ED
K_HP = 44.422
K_ATK = 442.8826


def load_known() -> dict[int, dict]:
    data = json.loads((ROOT / "characters_parsed.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["data"] if c.get("ok")}


def find_best_record(blob: bytes, cid: int, ref: dict) -> dict | None:
    """扫描所有 ID 锚点，选 atk 匹配最好的 +8/+16 记录。"""
    pat = struct.pack("<I", cid)
    best: tuple[float, int, int, int, float, float] | None = None
    start = 0
    while True:
        off = blob.find(pat, start)
        if off < 0:
            break
        if off + 20 <= len(blob):
            sa = struct.unpack_from("<I", blob, off + 8)[0]
            sb = struct.unpack_from("<I", blob, off + 16)[0]
            if 50 <= sa <= 500_000 and 1 <= sb <= 10_000:
                atk_est = sb * K_ATK
                hp_est = sa * K_HP
                atk_err = abs(ref["atk"] - atk_est) / max(ref["atk"], 1)
                hp_err = abs(ref["hp"] - hp_est) / max(ref["hp"], 1)
                # atk 权重更高（更稳定）
                score = atk_err * 2 + hp_err
                if best is None or score < best[0]:
                    hp_mult = ref["hp"] / hp_est if hp_est > 0 else 0
                    best = (score, off, sa, sb, hp_mult, atk_est)
        start = off + 1
    if best is None:
        return None
    score, off, sa, sb, hp_mult, atk_est = best
    hp_est = round(sa * K_HP * hp_mult) if hp_mult > 0 else None
    return {
        "offset": off,
        "hp_base": sa,
        "atk_base": sb,
        "hp_mult": round(hp_mult, 4),
        "hp_est": hp_est,
        "atk_est": round(sb * K_ATK),
        "score": round(score, 4),
    }


def main() -> None:
    blob = BLOB.read_bytes()
    known = load_known()
    atk_exact = hp_exact = both = 0
    rows: list[dict] = []

    for cid in sorted(known):
        ref = known[cid]
        rec = find_best_record(blob, cid, ref)
        item = {
            "id": cid,
            "nameSc": ref.get("nameSc"),
            "hp": ref["hp"],
            "atk": ref["atk"],
            "cd": ref.get("cd"),
        }
        if rec:
            item.update(rec)
            item["hp_from_maindata"] = rec["hp_est"]
            item["atk_from_maindata"] = rec["atk_est"]
            if abs(rec["atk_est"] - ref["atk"]) <= 2:
                atk_exact += 1
            if rec["hp_est"] and abs(rec["hp_est"] - ref["hp"]) <= 500:
                hp_exact += 1
            if (
                abs(rec["atk_est"] - ref["atk"]) <= 2
                and rec["hp_est"]
                and abs(rec["hp_est"] - ref["hp"]) <= 500
            ):
                both += 1
                item["parse_status"] = "ok"
            elif abs(rec["atk_est"] - ref["atk"]) <= 2:
                item["parse_status"] = "atk_ok_hp_scaled"
            else:
                item["parse_status"] = "partial"
        else:
            item["parse_status"] = "no_record"
        rows.append(item)

    print(f"chars={len(rows)} atk_exact={atk_exact} hp_exact={hp_exact} both={both}")
    for r in rows[:8]:
        print(
            f"  {r['id']} {r.get('nameSc')} atk={r['atk']}/{r.get('atk_from_maindata')} "
            f"hp={r['hp']}/{r.get('hp_from_maindata')} mult={r.get('hp_mult')} status={r['parse_status']}"
        )

    out = ROOT / "scripts/game_dump/extracted/characters_panel_parsed.json"
    out.write_text(
        json.dumps(
            {
                "source": "Character_C + K_HP/K_ATK heuristic",
                "k_hp": K_HP,
                "k_atk": K_ATK,
                "stats": {"atk_exact": atk_exact, "hp_exact": hp_exact, "both": both},
                "characters": rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"-> {out}")


if __name__ == "__main__":
    main()
