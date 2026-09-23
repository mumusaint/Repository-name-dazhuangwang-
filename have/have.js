let owned = [];

document.addEventListener("DOMContentLoaded", () => {
  bootPage({
    activePage: "have",
    userInfoId: "userInfo",
    gridId: "charGrid",
    onReady: () => {
      owned = getOwned();
      setupFilterChips("filters", [], refreshGrid);
      document.getElementById("searchInput").addEventListener("input", refreshGrid);
      renderSelected();
      refreshGrid();
    },
  }).catch((e) => console.error("bootPage", e));
});

function getOwnedMap() {
  const map = new Map();
  owned.forEach((o) => map.set(o.id, o.bond));
  return map;
}

function renderSelected() {
  const bar = document.getElementById("selectedBar");
  if (owned.length === 0) {
    bar.innerHTML = '<div class="empty-hint">请选择你持有的角色</div>';
    return;
  }
  bar.innerHTML = owned
    .map((o) => {
      const ch = getCharacter(o.id);
      if (!ch) return "";
      return `<div class="selected-slot">
        ${renderCharCard(ch, { selected: true, bond: o.bond, showName: true, onclick: `toggleOwned(${o.id})` })}
        <div class="slot-label">${charDisplayName(ch)}</div>
      </div>`;
    })
    .join("");
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
  renderSelected();
  refreshGrid();
}

function refreshGrid() {
  const data = characterData.data;
  const map = getOwnedMap();
  const filtered = filterCharacters(data, {
    element: getActiveFilter("filters", "element"),
    role: getActiveFilter("filters", "role"),
    rarity: getActiveFilter("filters", "rarity"),
    search: document.getElementById("searchInput").value.trim(),
    okOnly: true,
    excludeNew: true,
    eternalOnly: isToggleActive("filters", "toggle"),
  });

  document.getElementById("charGrid").innerHTML = filtered
    .map((ch) =>
      renderCharCard(ch, {
        selected: map.has(ch.id),
        bond: map.get(ch.id) || 0,
        onclick: `toggleOwned(${ch.id})`,
      })
    )
    .join("");
}

function exportOwned() {
  const code = encodeOwned(owned);
  copyText(code, "分享码已复制");
}

async function importOwned() {
  const input = await showPrompt(
    "导入持有角色",
    "粘贴 TenkaAssist「复制代码」或本站分享码…"
  );
  if (!input) return;
  try {
    owned = parseOwnedImport(input);
    setOwned(owned);
    refreshUserInfoBar("userInfo");
    renderSelected();
    refreshGrid();
    showToast(`成功导入 ${owned.length} 名角色`, "success");
  } catch (e) {
    showToast(`导入失败：${formatErrorMessage(e)}`, "error");
  }
}

async function importTenkaAssist() {
  let clip = "";
  try {
    clip = (await navigator.clipboard.readText()).trim();
  } catch {
    /* clipboard blocked */
  }
  const pasted = await showPrompt(
    "TenkaAssist 导入",
    clip || "在 TenkaAssist 已拥有页点击「复制代码」，然后粘贴到此处…"
  );
  if (!pasted) return;
  try {
    owned = decodeTenkaAssistCode(pasted);
    setOwned(owned);
    refreshUserInfoBar("userInfo");
    renderSelected();
    refreshGrid();
    showToast(`已从 TenkaAssist 导入 ${owned.length} 名角色`, "success");
  } catch (e) {
    showToast(`导入失败：${formatErrorMessage(e)}`, "error");
  }
}

async function clearOwned() {
  if (!(await showConfirm("确定清空所有持有角色？"))) return;
  owned = [];
  setOwned(owned);
  refreshUserInfoBar("userInfo");
  renderSelected();
  refreshGrid();
  showToast("已清空持有列表", "info");
}

function goTeam() {
  location.href = siteUrl("team/index.html");
}
