let owned = [];

document.addEventListener("DOMContentLoaded", () => {
  bootPage({
    activePage: "new",
    userInfoId: "userInfo",
    onReady: () => {
      owned = getOwned();
      document.getElementById("searchInput").addEventListener("input", refreshGrid);
      refreshGrid();
    },
  }).catch((e) => console.error("bootPage", e));
});

function getOwnedMap() {
  const map = new Map();
  owned.forEach((o) => map.set(o.id, o.bond));
  return map;
}

function toggleOwned(id) {
  const idx = owned.findIndex((o) => o.id === id);
  if (idx === -1) {
    owned.push({ id, bond: 1 });
  } else if (owned[idx].bond < 5) {
    owned[idx].bond += 1;
  } else {
    owned.splice(idx, 1);
  }
  setOwned(owned);
  refreshUserInfoBar("userInfo");
  refreshGrid();
}

function refreshGrid() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const map = getOwnedMap();
  let list = getNewCharacters();

  if (q) {
    list = list.filter((ch) => {
      const hay = [ch.id, ch.nameSc, ch.name, ch.note, ch.eventTag, ch.confidence]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q) || String(ch.id).includes(q);
    });
  }

  const countEl = document.getElementById("newCharCount");
  countEl.textContent = `共 ${list.length} 名 · 已持有 ${list.filter((c) => map.has(c.id)).length}`;

  const grid = document.getElementById("newCharGrid");
  if (!list.length) {
    grid.innerHTML = renderEmptyState({
      icon: "✨",
      title: "暂无新角色",
      desc: "在 data/manual_characters.json 添加后运行 parse_characters.py",
      actionLabel: "返回持有",
      actionHref: siteUrl("have/index.html"),
    });
    return;
  }

  grid.innerHTML = list
    .map((ch) =>
      renderNewCharCard(getCharacter(ch.id) || ch, {
        selected: map.has(ch.id),
        bond: map.get(ch.id) || 0,
        onclick: `toggleOwned(${ch.id})`,
      })
    )
    .join("");
}
