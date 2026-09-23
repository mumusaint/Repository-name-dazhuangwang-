import re
import json
import csv
from collections import Counter
from pathlib import Path

BASE = Path(__file__).parent
JS_PATH = BASE / "characterJson.js"
COMMON_PATH = BASE / "common.js"
JSON_PATH = BASE / "characters_parsed.json"
CSV_PATH = BASE / "characters_parsed.csv"
MANUAL_PATH = BASE / "data" / "manual_characters.json"
NAME_OVERRIDES_PATH = BASE / "data" / "character_name_overrides.json"

ELEMENT = {0: "火", 1: "水", 2: "风", 3: "光", 4: "暗"}
ROLE = {0: "输出", 1: "治疗", 2: "坦克", 3: "辅助", 4: "干扰"}
RARITY = {0: "N", 1: "R", 2: "SR", 3: "SSR"}


def parse_js_array(text: str, name: str) -> list:
    match = re.search(rf"const {name} = (\[[^\]]*\]);", text)
    if not match:
        return []
    return json.loads(match.group(1))


def parse_characters(text: str) -> list:
    data_match = re.search(r"const chJSON = \{ data : \[(.*?)\]\};", text, re.S)
    if not data_match:
        raise ValueError("无法找到 chJSON.data")

    pattern = re.compile(
        r"(\w+)\s*:\s*(\"(?:\\.|[^\"])*\"|true|false|\d+(?:\.\d+)?)"
    )
    objs = []
    for line in data_match.group(1).split("\n"):
        line = line.strip().rstrip(",")
        if not line.startswith("{"):
            continue
        obj = {}
        for key, value in pattern.findall(line):
            if value in ("true", "false"):
                obj[key] = value == "true"
            elif value.startswith('"'):
                obj[key] = json.loads(value)
            elif "." in value:
                obj[key] = float(value)
            else:
                obj[key] = int(value)
        objs.append(obj)
    return objs


def parse_translate(text: str) -> dict:
    match = re.search(r"const translate = \{(.*?)\n\};", text, re.S)
    if not match:
        return {}

    pattern = re.compile(
        r'"([^"]+)"\s*:\s*\{([^}]+)\}'
    )
    translations = {}
    for key, body in pattern.findall(match.group(1)):
        entry = {}
        for lang, value in re.findall(r'(en|sc|tc|jp|ko)\s*:\s*"((?:\\.|[^"])*)"', body):
            entry[lang] = json.loads(f'"{value}"')
        translations[key] = entry
    return translations


def enrich(objs: list, liberation: list, eternal: list, translate: dict) -> list:
    for obj in objs:
        obj["elementName"] = ELEMENT.get(obj.get("element"), str(obj.get("element")))
        obj["roleName"] = ROLE.get(obj.get("role"), str(obj.get("role")))
        obj["rarityName"] = RARITY.get(obj.get("rarity"), str(obj.get("rarity")))
        obj["isLiberation"] = obj.get("name") in liberation
        obj["isEternal"] = obj.get("name") in eternal
        tr = translate.get(obj.get("name"), {})
        if not obj.get("nameSc"):
            obj["nameSc"] = tr.get("sc", "")
        if not obj.get("nameTc"):
            obj["nameTc"] = tr.get("tc", "")
        if not obj.get("nameEn"):
            obj["nameEn"] = tr.get("en", "")
        if not obj.get("nameJp"):
            obj["nameJp"] = tr.get("jp", "")
    return objs


def load_manual_characters() -> list:
    if not MANUAL_PATH.is_file():
        return []
    raw = json.loads(MANUAL_PATH.read_text(encoding="utf-8"))
    return list(raw.get("characters", []))


def merge_manual_characters(objs: list, manual: list) -> list:
    """仅追加 TenkaAssist 尚未收录的角色，不覆盖官方面板数据。"""
    if not manual:
        return objs
    by_id = {o["id"]: o for o in objs}
    for entry in manual:
        cid = entry.get("id")
        if cid is None or cid in by_id:
            continue
        by_id[cid] = dict(entry)
    return sorted(by_id.values(), key=lambda o: o["id"])


def load_name_overrides() -> list:
    if not NAME_OVERRIDES_PATH.is_file():
        return []
    raw = json.loads(NAME_OVERRIDES_PATH.read_text(encoding="utf-8"))
    return list(raw.get("overrides", []))


def apply_name_overrides(objs: list, overrides: list) -> list:
    if not overrides:
        return objs
    by_id = {o["id"]: o for o in objs}
    for entry in overrides:
        cid = entry.get("id")
        if cid is None or cid not in by_id:
            continue
        row = by_id[cid]
        for key in ("nameSc", "nameTc", "nameEn", "nameJp", "aliases", "title"):
            if entry.get(key) is not None:
                row[key] = entry[key]
    return objs


def main():
    text = JS_PATH.read_text(encoding="utf-8")
    translate = parse_translate(COMMON_PATH.read_text(encoding="utf-8"))
    liberation = parse_js_array(text, "liberationList")
    eternal = parse_js_array(text, "eternalList")
    objs = enrich(parse_characters(text), liberation, eternal, translate)
    manual = load_manual_characters()
    manual_only = []
    if manual:
        before_ids = {o["id"] for o in objs}
        objs = enrich(merge_manual_characters(objs, manual), liberation, eternal, translate)
        after_ids = {o["id"] for o in objs}
        manual_only = sorted(after_ids - before_ids)

    name_overrides = load_name_overrides()
    if name_overrides:
        objs = apply_name_overrides(objs, name_overrides)

    result = {
        "source": "https://inittt.github.io/tenkaassist/js/characterJson.js",
        "manual": manual_only,
        "liberationList": liberation,
        "eternalList": eternal,
        "total": len(objs),
        "data": objs,
    }
    JSON_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    fields = [
        "id", "name", "nameSc", "nameTc", "nameEn", "nameJp", "fullname",
        "rarity", "rarityName", "element", "elementName", "role", "roleName",
        "ok", "po", "hp", "atk", "cd", "atkMag", "ultMag", "hpUp",
        "isLiberation", "isEternal",
    ]
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(objs)

    stats = {
        "total": len(objs),
        "ok_true": sum(1 for o in objs if o.get("ok")),
        "ok_false": sum(1 for o in objs if not o.get("ok")),
        "by_rarity": dict(Counter(o["rarityName"] for o in objs)),
        "by_element": dict(Counter(o["elementName"] for o in objs)),
        "by_role": dict(Counter(o["roleName"] for o in objs)),
        "missing_translation": sum(1 for o in objs if not o.get("nameSc")),
    }
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"JSON: {JSON_PATH}")
    print(f"CSV: {CSV_PATH}")


if __name__ == "__main__":
    main()
