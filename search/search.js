let mode = "must";
const mustList = [];
const banList = [];
let sort = 1;
let page = 0;
let rank = 0;
let loading = false;
let ended = false;
let searched = false;

document.addEventListener("DOMContentLoaded", () => {
  bootPage({
    activePage: "search",
    gridId: "charGrid",
    onReady: () => {
      setupFilterChips("filters", [], refreshGrid);
      document.getElementById("searchInput").addEventListener("input", refreshGrid);
      setupSortDropdown("sortSelect", (s) => {
        sort = s;
        if (searched) {
          resetResults();
          loadResults();
        }
      });
      setupInfiniteScroll("loadTrigger", loadResults);
      const mustParam = new URLSearchParams(location.search).get("must");
      if (mustParam) {
        Number(mustParam) && mustList.push(Number(mustParam));
        renderTags();
      }
      refreshGrid();
    },
  }).catch((e) => console.error("bootPage", e));
});

function setMode(m) {
  mode = m;
  document.getElementById("modeMust").classList.toggle("active", m === "must");
  document.getElementById("modeBan").classList.toggle("active", m === "ban");
}

function toggleChar(id) {
  const inMust = mustList.indexOf(id);
  const inBan = banList.indexOf(id);
  if (inMust !== -1) { mustList.splice(inMust, 1); renderTags(); refreshGrid(); return; }
  if (inBan !== -1) { banList.splice(inBan, 1); renderTags(); refreshGrid(); return; }
  if (mode === "must") {
    if (mustList.length >= 5) { showToast("最多选择 5 名必须包含的角色", "info"); return; }
    mustList.push(id);
  } else {
    banList.push(id);
  }
  renderTags();
  refreshGrid();
}

function removeMust(id) {
  const i = mustList.indexOf(id);
  if (i !== -1) mustList.splice(i, 1);
  renderTags(); refreshGrid();
}

function removeBan(id) {
  const i = banList.indexOf(id);
  if (i !== -1) banList.splice(i, 1);
  renderTags(); refreshGrid();
}

function renderTags() {
  const el = document.getElementById("selectedTags");
  if (!mustList.length && !banList.length) {
    el.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem">点击角色添加筛选条件</span>`;
    return;
  }
  const mustHtml = mustList.map((id) => {
    const ch = getCharacter(id);
    const n = charDisplayName(ch) || id;
    return `<span class="char-tag must">${n} <button onclick="removeMust(${id})">×</button></span>`;
  }).join("");
  const banHtml = banList.map((id) => {
    const ch = getCharacter(id);
    const n = charDisplayName(ch) || id;
    return `<span class="char-tag ban">排除 ${n} <button onclick="removeBan(${id})">×</button></span>`;
  }).join("");
  el.innerHTML = mustHtml + banHtml;
}

function refreshGrid() {
  const filtered = filterCharacters(characterData.data, {
    rarity: getActiveFilter("filters", "rarity"),
    search: document.getElementById("searchInput").value.trim(),
    okOnly: true,
  });
  document.getElementById("charGrid").innerHTML = filtered.map((ch) => {
    const isMust = mustList.includes(ch.id);
    const isBan = banList.includes(ch.id);
    const mark = isMust ? `<span class="check-mark">✓</span>`
      : isBan ? `<span class="ban-mark">✕</span>` : "";
    const cls = isBan ? "banned" : isMust ? "selected" : "";
    return `<div class="char-card ${cls}" onclick="toggleChar(${ch.id})" title="${charDisplayName(ch)}">
      <span class="element-dot element-${ch.element}"></span>
      ${mark}
      <img src="${charImageUrl(ch.id)}" alt="${charDisplayName(ch)}" loading="lazy">
      <span class="char-name">${charDisplayName(ch)}</span>
    </div>`;
  }).join("");
}

function doSearch() {
  if (!mustList.length && !banList.length) {
    showToast("请至少选择一个必须包含或排除的角色", "info");
    return;
  }
  searched = true;
  document.getElementById("resultsSection").style.display = "block";
  resetResults();
  loadSearchCount();
  loadResults();
  document.getElementById("resultsSection").scrollIntoView({ behavior: "smooth" });
}

function resetResults() {
  page = 0;
  rank = 0;
  ended = false;
  document.getElementById("compList").innerHTML = "";
}

async function loadSearchCount() {
  try {
    const res = await searchCompCount({ chIds: mustList, banList });
    if (res.success) {
      document.getElementById("searchCount").textContent = `匹配 ${res.data.toLocaleString()} 套`;
    }
  } catch {
    document.getElementById("searchCount").textContent = "计数失败";
  }
}

async function loadResults() {
  if (loading || ended || !searched) return;
  loading = true;
  const list = document.getElementById("compList");
  if (page === 0) list.innerHTML = renderSkeletonCards(5);

  try {
    const res = await searchComps({ sort, page, chIds: mustList, banList });
    if (!res.success) throw new Error(res.msg || "搜索失败");
    const items = res.data || [];
    if (page === 0) list.innerHTML = "";
    let hasData = false;
    for (let i = 0; i < 20; i++) {
      const comp = items[i];
      if (!comp) { ended = true; break; }
      hasData = true;
      rank++;
      list.insertAdjacentHTML("beforeend", renderCompCard(comp, sort, rank));
    }
    if (!hasData && rank === 0) {
      list.innerHTML = renderEmptyState({
        icon: "🔍",
        title: "没有匹配的配队",
        desc: "尝试减少筛选条件或更换角色组合。",
      });
      ended = true;
    } else {
      bindCompCardClicks(list, (id) => {
        location.href = `../comp/index.html?id=${id}`;
      });
      page++;
    }
  } catch (e) {
    if (page === 0) {
      list.innerHTML = renderEmptyState({
        icon: "⚠️",
        title: "搜索失败",
        desc: `${formatErrorMessage(e)}。请运行本地服务（python server.py）。`,
        actionLabel: "返回首页",
        actionHref: siteUrl("index.html"),
      });
    }
    ended = true;
  } finally {
    loading = false;
  }
}
