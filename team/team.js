const TEAM_SIZE = 5;
let team = [];

document.addEventListener("DOMContentLoaded", () => {
  bootPage({
    activePage: "team",
    userInfoId: "userInfo",
    gridId: "charGrid",
    onReady: () => {
      team = normalizeTeam(getTeam());
      setupFilterChips("filters", [], refreshGrid);
      document.getElementById("searchInput").addEventListener("input", refreshGrid);
      document.getElementById("ownedOnly").addEventListener("change", refreshGrid);
      renderTeam();
      refreshGrid();
    },
  }).catch((e) => console.error("bootPage", e));
});

function normalizeTeam(raw) {
  const result = Array(TEAM_SIZE).fill(null);
  raw.forEach((slot, i) => {
    if (i < TEAM_SIZE && slot && slot.id) result[i] = { id: slot.id, bond: slot.bond || 1 };
  });
  return result;
}

function saveTeam() {
  setTeam(team.filter(Boolean));
}

function renderTeam() {
  const container = document.getElementById("teamSlots");
  container.innerHTML = team
    .map((slot, i) => {
      if (!slot) {
        return `<div class="team-slot" data-index="${i}" draggable="false">
          <div class="slot-num">${i + 1} 号位</div>
          <div class="slot-frame"><span style="color:var(--text-muted);font-size:0.8rem">空</span></div>
        </div>`;
      }
      const ch = getCharacter(slot.id);
      if (!ch) return "";
      const name = charDisplayName(ch);
      return `<div class="team-slot filled" data-index="${i}" draggable="true">
        <div class="slot-num">${i + 1} 号位 · ${name}</div>
        <div class="slot-frame" onclick="removeFromTeam(${i})">
          <img src="${charImageUrl(ch.id)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">
        </div>
        <select class="bond-select" onchange="setBond(${i}, this.value)">
          ${[1, 2, 3, 4, 5].map((b) => `<option value="${b}" ${slot.bond === b ? "selected" : ""}>羁绊 ${b}</option>`).join("")}
        </select>
      </div>`;
    })
    .join("");

  setupDragDrop();
}

function setupDragDrop() {
  const slots = document.querySelectorAll(".team-slot.filled");
  slots.forEach((slot) => {
    slot.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", slot.dataset.index);
      slot.classList.add("dragging");
    });
    slot.addEventListener("dragend", () => slot.classList.remove("dragging"));
  });

  document.querySelectorAll(".team-slot").forEach((slot) => {
    slot.addEventListener("dragover", (e) => e.preventDefault());
    slot.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData("text/plain"));
      const to = Number(slot.dataset.index);
      if (from === to) return;
      const tmp = team[from];
      team[from] = team[to];
      team[to] = tmp;
      saveTeam();
      renderTeam();
    });
  });
}

function addToTeam(id) {
  if (team.some((s) => s && s.id === id)) {
    removeById(id);
    return;
  }
  const emptyIdx = team.findIndex((s) => !s);
  if (emptyIdx === -1) {
    showToast("队伍已满（5 人）", "info");
    return;
  }
  const owned = getOwned();
  const ownedEntry = owned.find((o) => o.id === id);
  team[emptyIdx] = { id, bond: ownedEntry ? ownedEntry.bond : 5 };
  saveTeam();
  renderTeam();
  refreshGrid();
}

function removeFromTeam(index) {
  team[index] = null;
  saveTeam();
  renderTeam();
  refreshGrid();
}

function removeById(id) {
  const idx = team.findIndex((s) => s && s.id === id);
  if (idx !== -1) removeFromTeam(idx);
}

function setBond(index, bond) {
  if (team[index]) {
    team[index].bond = Number(bond);
    saveTeam();
  }
}

function setAllBond(bond) {
  team.forEach((s) => { if (s) s.bond = bond; });
  saveTeam();
  renderTeam();
}

function clearTeam() {
  team = Array(TEAM_SIZE).fill(null);
  saveTeam();
  renderTeam();
  refreshGrid();
}

function refreshGrid() {
  const ownedOnly = document.getElementById("ownedOnly").checked;
  const ownedIds = new Set(getOwned().map((o) => o.id));
  const teamIds = new Set(team.filter(Boolean).map((s) => s.id));
  const grid = document.getElementById("charGrid");

  if (ownedOnly && ownedIds.size === 0) {
    grid.innerHTML = renderEmptyState({
      icon: "📋",
      title: "暂无持有角色",
      desc: "请先在持有页添加角色，或取消勾选「仅显示持有」。",
      actionLabel: "去添加持有",
      actionHref: siteUrl("have/index.html"),
    });
    return;
  }

  let chars = characterData.data.filter((c) => c.ok);
  if (ownedOnly) chars = chars.filter((c) => ownedIds.has(c.id));

  chars = filterCharacters(chars, {
    element: getActiveFilter("filters", "element"),
    search: document.getElementById("searchInput").value.trim(),
    okOnly: false,
  });

  if (!chars.length) {
    grid.innerHTML = renderEmptyState({
      icon: "🔍",
      title: "没有匹配的角色",
      desc: "试试调整搜索关键词或属性筛选。",
    });
    return;
  }

  grid.innerHTML = chars
    .map((ch) =>
      renderCharCard(ch, {
        selected: teamIds.has(ch.id),
        bond: team.find((s) => s && s.id === ch.id)?.bond || 0,
        onclick: `addToTeam(${ch.id})`,
      })
    )
    .join("");
}

function startCalc() {
  const filled = team.filter(Boolean);
  if (filled.length < 5) {
    showToast(`请先选满 5 名角色（当前 ${filled.length}/5）`, "info");
    return;
  }
  saveTeam();
  location.href = siteUrl("calc/index.html");
}
