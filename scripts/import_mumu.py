"""从截图解析 mumu 账号持有角色并写入 accounts.json"""
import json
from pathlib import Path

BASE = Path(__file__).parent.parent
DATA = json.loads((BASE / "characters_parsed.json").read_text(encoding="utf-8"))
BY_SC = {c["nameSc"]: c["id"] for c in DATA["data"] if c.get("nameSc")}

# 截图角色：简中昵称 -> 羁绊(1-5)
# 昵称与 TenkaAssist 简中译名对齐
MUMU_OWNED = [
    ("赤龙", 5), ("可巴", 5), ("法雅", 1), ("驯鹿", 1), ("花巴", 1), ("莫默", 1),
    ("风魁", 1), ("春剑", 1), ("托特拉", 5), ("凛月", 5), ("血魔", 1), ("千咒", 3),
    ("血族", 5), ("白熊", 1), ("夏黑", 1), ("现勇", 1), ("伊吹", 1), ("伊布力斯", 1),
    ("拉尤", 2), ("拉黑", 3), ("肥婆", 3), ("雪豹", 1), ("咪黑", 1), ("商狐", 1),
    ("春王", 2), ("兰儿", 1), ("赛露西亚", 1), ("夏娜", 2), ("堕龙", 1), ("大女仆", 4),
    ("煌星", 4), ("神无雪", 5), ("雷欧娜", 5), ("性鹿", 5), ("鯊魚", 5), ("夏狂", 1),
    ("觉勇", 5), ("铃兰", 5), ("机巴", 4), ("天美", 3), ("护琳", 1), ("沃沃", 1),
    ("优璃", 1), ("悠勇", 1), ("水军", 1), ("星紅", 1), ("仙子", 1), ("露媞", 1),
    ("仆王", 1), ("仆奈", 1), ("丧娜", 1), ("丧巴", 2), ("丧伊", 1), ("丧旦", 4),
    ("兔伊", 2), ("火机", 1), ("风蛇", 1), ("魔将", 1), ("花静", 1), ("勇妈", 2),
    ("神兔", 1), ("占星", 2), ("花伊", 2), ("小泱", 5), ("鬼厨", 2), ("毛毛", 4),
    ("奈奈美", 3), ("埃天", 1), ("副手", 5), ("娜莉", 1), ("兔妈", 1),
]

# 截图 OCR 别名 -> 数据库 nameSc
ALIASES = {
    "珂勇": "现勇", "赛莉西亚": "赛露西亚", "艾娜": "夏娜", "神咒雪": "神无雪",
    "蕾伊": "雷欧娜", "暴鹿": "性鹿", "鲨鱼": "鯊魚", "暴狂": "夏狂", "虫狐": "商狐",
    "春+": "春王", "优玻": "优璃", "水罪": "水军", "黑海": "露媞", "凉月": "凛月",
    "血虚": "血魔", "祈兔": "神兔", "小决": "小泱", "鬼园": "鬼厨", "刚手": "副手",
    "琳莉": "娜莉", "星红": "星紅", "霓侵": "仆王", "贪婪": "占星", "花嫁": "花伊",
    "黑海": "露媞",
}


def resolve(name_sc: str) -> int:
    key = ALIASES.get(name_sc, name_sc)
    if key not in BY_SC:
        raise KeyError(f"未找到角色: {name_sc} -> {key}")
    return BY_SC[key]


def main():
    owned = []
    missing = []
    for name, bond in MUMU_OWNED:
        try:
            owned.append({"id": resolve(name), "bond": bond})
        except KeyError as e:
            missing.append(str(e))

    if missing:
        print("缺失:", missing)
        raise SystemExit(1)

    from datetime import datetime, timezone

    accounts = {
        "mumu": {
            "owned": owned,
            "settings": {"hpUpMin": 20, "fit13tMin": 20},
            "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    }

    out = BASE / "accounts.json"
    out.write_text(json.dumps(accounts, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"账号 mumu: {len(owned)} 名角色 -> {out}")


if __name__ == "__main__":
    main()
