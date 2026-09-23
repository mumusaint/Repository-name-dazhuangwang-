let running = false;
let investRunning = false;
let investActiveTab = "pull";
let pullCompactPage = 1;
let pullCompactExpandedMissId = null;
let mustInclude = [];
let smartViewMode = localStorage.getItem("smartViewMode") || "compact";
let smartParallelCount = Number(localStorage.getItem("smartParallelCount")) || 4;
let smartCompactPage = 1;
let smartBatchSort = localStorage.getItem("smartBatchSort") || "batchTotal";
if (localStorage.getItem("smartBatchSort") === "rank") {
  smartBatchSort = "batchTotal";
  localStorage.setItem("smartBatchSort", "batchTotal");
}

let smartEngineReady = null;

document.addEventListener("DOMContentLoaded", async () => {
  renderHeader("smart");
  applySmartUrlParams();
  try {
    await loadCharacters();
  } catch (e) {
    showToast(`数据加载失败：${formatErrorMessage(e)}`, "error", 5000);
    document.getElementById("startBtn").disabled = true;
    document.getElementById("investBtn")?.setAttribute("disabled", "disabled");
    document.getElementById("userInfo").innerHTML =
      `<span style="color:var(--danger)">角色数据加载失败，请运行 python server.py 后刷新</span>`;
    return;
  }
  await initAccounts();
  renderAccountBadge();
  refreshUserInfo();
  if (typeof migrateUserDataDisplayNames === "function") migrateUserDataDisplayNames();
  if (mustInclude.length) renderMustIncludePicker();
  updateSmartViewToolbar();
  renderPinnedTeamsPanel();
  if (investActiveTab === "bond") switchInvestTab("bond");
});

function applySmartUrlParams() {
  const params = new URLSearchParams(location.search);
  const must = params.get("must");
  if (must) {
    must.split(",").map(Number).filter(Boolean).forEach((id) => {
      if (!mustInclude.includes(id) && mustInclude.length < 5) mustInclude.push(id);
    });
  }
  if (params.get("tab") === "bond") investActiveTab = "bond";
}

function renderPinnedTeamsPanel() {
  const el = document.getElementById("pinnedTeamsPanel");
  if (!el || typeof getPinnedTeams !== "function") return;
  const teams = getPinnedTeams();
  if (!teams.length) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.innerHTML = `
    <div class="block-title">我的主力四队 <button type="button" class="btn btn-sm" onclick="refreshPinnedFromResults()" style="margin-left:0.5rem">从当前结果刷新</button></div>
    <div class="pinned-teams-grid">
      ${teams
        .map((t, i) => {
          const chars = (t.compstr || [])
            .map((id) => `<img src="${charImageUrl(id)}" alt="${charDisplayName(getCharacter(id)) || id}" class="pinned-char" title="${escapeHtml(charDisplayName(getCharacter(id)) || id)}">`)
            .join("");
          const fitYi = t.fit13t > 0 ? (t.fit13t / 1e8).toFixed(2) : "-";
          const official = t.recommend > 0 ? (t.recommend / 1e8).toFixed(2) : "-";
          const bonds = (t.bonds || []).join(",");
          const calcHref = siteUrl(`calc/index.html?comp=${t.id}&bond=${bonds}`);
          return `<div class="pinned-team-card">
            <div class="pinned-team-head">
              <span><strong>队 ${i + 1}</strong> · ${escapeHtml(compDisplayName(t))}</span>
              <span class="pinned-team-dmg">${fitYi}<span style="font-size:0.75em;font-weight:400">亿</span></span>
            </div>
            <div class="pinned-team-meta">官方 ${official} 亿</div>
            <div class="pinned-team-chars">${chars}</div>
            <div class="pinned-team-actions">
              <a href="${calcHref}" class="btn btn-primary btn-sm">精确打桩</a>
              <a href="${siteUrl(`comp/index.html?id=${t.id}`)}" class="btn btn-sm">详情</a>
            </div>
          </div>`;
        })
        .join("")}
    </div>`;
}

function refreshPinnedFromResults() {
  if (!window.smartResults?.length) {
    showToast("请先运行智能分析", "info");
    return;
  }
  if (typeof setPinnedTeamsFromSmart !== "function") return;
  setPinnedTeamsFromSmart(window.smartResults, window.smartResultsPool, smartParallelCount, smartBatchSort);
  renderPinnedTeamsPanel();
  showToast("已更新主力四队", "success");
}

function exportSmartReport() {
  if (typeof exportSmartReportMarkdown === "function") {
    exportSmartReportMarkdown();
  }
}

function openCompCompareModal() {
  const favs = typeof getFavComps === "function" ? getFavComps() : [];
  if (favs.length < 2) {
    showToast("请先在结果中收藏至少 2 套配队", "info");
    return;
  }
  const opts = favs
    .slice(0, 10)
    .map((c) => `<option value="${c.id}">${escapeHtml(compDisplayName(c))}</option>`)
    .join("");
  window.__cmpFavs = favs;
  showModal({
    title: "配队对比",
    body: `<label style="font-size:0.85rem">A 队<select id="cmpA" class="sort-select" style="margin:0.35rem">${opts}</select></label>
      <label style="font-size:0.85rem;margin-left:0.75rem">B 队<select id="cmpB" class="sort-select" style="margin:0.35rem">${opts}</select></label>
      <button type="button" class="btn btn-primary btn-sm" style="margin-top:0.5rem" onclick="runCompCompare()">生成对比表</button>
      <div id="cmpTableWrap" style="margin-top:0.75rem"></div>`,
    confirmText: "关闭",
    cancelText: "",
    onConfirm: () => {},
  });
  const selB = document.getElementById("cmpB");
  if (selB && favs.length > 1) selB.selectedIndex = 1;
}

function runCompCompare() {
  const favs = window.__cmpFavs || (typeof getFavComps === "function" ? getFavComps() : []);
  const idA = Number(document.getElementById("cmpA")?.value);
  const idB = Number(document.getElementById("cmpB")?.value);
  const compA = favs.find((c) => c.id === idA);
  const compB = favs.find((c) => c.id === idB);
  const wrap = document.getElementById("cmpTableWrap");
  if (wrap && typeof renderCompCompareTable === "function") {
    wrap.innerHTML = renderCompCompareTable(compA, compB, getOwned());
  }
}

function toggleSmartFav(id) {
  const comp =
    (window.smartResults || []).find((c) => c.id === id) ||
    (window.smartResultsPool || []).find((c) => c.id === id);
  if (!comp || typeof toggleFavComp !== "function") return;
  const added = toggleFavComp(comp);
  showToast(added ? "已收藏配队" : "已取消收藏", "success", 2000);
  renderSmartResults(window.smartResults);
}

function ensureSmartEngineLoaded() {
  if (smartEngineReady) return smartEngineReady;
  const base = getSiteBase();
  const scripts = [
    `${base}/assets/js/vendor/pako.min.js`,
    `${base}/characterJson.js`,
    `${base}/assets/js/calculator.v3.js`,
    `${base}/assets/js/autocalc.v3.js`,
    `${base}/assets/js/calcengine.js`,
    `${base}/assets/js/api.js`,
    `${base}/assets/js/command.js`,
    `${base}/assets/js/compdata.js?v=20260604c`,
  ];
  smartEngineReady = (async () => {
    for (const src of scripts) await loadScriptOnce(src);
    if (typeof CalcEngine !== "undefined") await CalcEngine.waitUntilReady(20000);
  })();
  return smartEngineReady;
}

function refreshUserInfo() {
  refreshUserInfoBar("userInfo", {
    analyzeBtnIds: ["startBtn"],
    investBtnId: "investBtn",
    showAvgBond: true,
    afterRender: renderMustIncludePicker,
  });
}

function switchInvestTab(tab) {
  investActiveTab = tab;
  document.querySelectorAll("#investTabs .advice-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  const pullSec = document.getElementById("pullResultsSection");
  const bondSec = document.getElementById("bondResultsSection");
  if (pullSec?.style.display !== "none" || bondSec?.style.display !== "none") {
    pullSec.style.display = tab === "pull" ? "block" : "none";
    bondSec.style.display = tab === "bond" ? "block" : "none";
  }
}

function renderMustIncludePicker() {
  const el = document.getElementById("mustIncludeBar");
  if (!el) return;
  const owned = getOwned();
  if (!owned.length) {
    el.innerHTML = `<span class="empty-hint">请先在持有角色页添加角色</span>`;
    return;
  }
  el.innerHTML = owned
    .map((o) => {
      const ch = getCharacter(o.id);
      if (!ch) return "";
      const n = charDisplayName(ch);
      const active = mustInclude.includes(o.id) ? "active" : "";
      return `<button type="button" class="must-chip ${active}" onclick="toggleMustInclude(${o.id})" title="羁绊 ${o.bond}">
        <img src="${charImageUrl(o.id)}" alt="${n}">
        <span>${n}</span>
      </button>`;
    })
    .join("");
  document.getElementById("mustIncludeHint").textContent = mustInclude.length
    ? `已指定 ${mustInclude.length} 名必带角色${
        mustInclude.some((id) => id >= 10203)
          ? "（含社区库尚未收录的新角色，将自动生成本地组合）"
          : ""
      }`
    : "可选：点击角色设为必带；持有但未入库的新角色也会自动参与本地组合搜索";
}

function toggleMustInclude(id) {
  const idx = mustInclude.indexOf(id);
  if (idx === -1) {
    if (mustInclude.length >= 5) {
      showToast("必带角色最多 5 名", "info");
      return;
    }
    mustInclude.push(id);
  } else {
    mustInclude.splice(idx, 1);
  }
  renderMustIncludePicker();
}

function clearMustInclude() {
  mustInclude = [];
  renderMustIncludePicker();
}

function smartSetCompBond(compId, slotIndex, bond) {
  const comp = typeof findSmartCompById === "function" ? findSmartCompById(compId) : (window.smartResults || []).find((c) => c.id === compId);
  if (!comp) return;
  comp.bonds[slotIndex] = Number(bond);
  recalcSmartCompBonds(comp);
  refreshSmartCompCard(compId);
}

function smartResetCompBonds(compId) {
  const comp = typeof findSmartCompById === "function" ? findSmartCompById(compId) : (window.smartResults || []).find((c) => c.id === compId);
  if (!comp) return;
  const { bondMap } = buildOwnedMaps(getOwned());
  comp.bonds = comp.compstr.map((id) => bondMap.get(id) || 1);
  recalcSmartCompBonds(comp);
  refreshSmartCompCard(compId);
  showToast("已恢复为持有花数", "info");
}

function refreshSmartCompCard(compId) {
  if (smartViewMode === "compact") {
    window.smartCompactExpandedId = compId;
    renderSmartResults(window.smartResults || []);
    return;
  }
  const results = window.smartResults || [];
  const idx = results.findIndex((c) => c.id === compId);
  if (idx === -1) return;
  const comp = results[idx];
  const card = document.querySelector(`.smart-card[data-id="${compId}"]`);
  if (!card) return;
  const expanded = smartViewMode === "grid" || card.classList.contains("expanded");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderSmartCompCard(comp, idx + 1, smartViewMode);
  const newCard = wrapper.firstElementChild;
  if (expanded) newCard.classList.add("expanded");
  card.replaceWith(newCard);
}

function refreshNearMissList() {
  const section = document.getElementById("nearMissSection");
  const list = document.getElementById("nearMissList");
  if (!section || !list || section.style.display === "none") return;
  const raw = window.smartNearMissList || [];
  let filtered = raw;
  if (smartViewMode === "compact" && window.smartResults?.length) {
    const charIds = getSmartBatchCharIds(
      window.smartResults,
      smartCompactPage,
      smartParallelCount,
      window.smartResultsPool,
      smartBatchSort
    );
    filtered = filterNearMissByChars(raw, charIds);
  }
  if (!filtered.length) {
    list.innerHTML = renderEmptyState({
      icon: "✓",
      title: raw.length ? "当前屏推荐角色已占用" : "暂无差 1 人配队",
      desc: raw.length
        ? "换页或调整「队伍1–4」后，会显示与当前推荐不重复角色的缺口配队。"
        : "已可组成的高配队均需要缺少多名角色。",
    });
    return;
  }
  list.innerHTML = filtered.map((item) => renderNearMissCard(item)).join("");
}

function renderSmartResults(results) {
  const list = document.getElementById("resultList");
  if (!list) return;
  window.smartResults = results;
  bindSmartCardClicks(list, results);

  if (smartViewMode === "compact") {
    const batches = getSmartDisjointBatches(
      results,
      smartParallelCount,
      window.smartResultsPool,
      smartBatchSort
    );
    const pages = Math.max(1, batches.length);
    if (smartCompactPage > pages) smartCompactPage = pages;
    list.className = "smart-results-compact";
    list.innerHTML = renderSmartCompactPanel(
      results,
      smartCompactPage,
      smartParallelCount,
      window.smartCompactExpandedId ?? null,
      window.smartResultsPool,
      smartBatchSort,
      batches
    );
    refreshNearMissList();
  } else {
    list.className = smartViewMode === "grid" ? "smart-results-grid" : "smart-results-list";
    list.innerHTML = results.map((comp, i) => renderSmartCompCard(comp, i + 1, smartViewMode)).join("");
    if (smartViewMode === "list") {
      list.querySelector(".smart-card")?.classList.add("expanded");
    }
    refreshNearMissList();
  }
  updateSmartViewToolbar();
}

function setSmartViewMode(mode) {
  const allowed = ["compact", "grid", "list"];
  smartViewMode = allowed.includes(mode) ? mode : "compact";
  localStorage.setItem("smartViewMode", smartViewMode);
  if (window.smartResults?.length) {
    renderSmartResults(window.smartResults);
  } else {
    updateSmartViewToolbar();
  }
}

function setSmartParallelCount(n) {
  smartParallelCount = Math.min(4, Math.max(1, Number(n) || 4));
  localStorage.setItem("smartParallelCount", String(smartParallelCount));
  if (typeof invalidateSmartBatchCache === "function") invalidateSmartBatchCache();
  smartCompactPage = 1;
  window.smartCompactExpandedId = null;
  if (window.smartResults?.length) {
    renderSmartResults(window.smartResults);
  }
}

function setSmartBatchSort(mode) {
  smartBatchSort = mode === "batchTotal" ? "batchTotal" : "rank";
  localStorage.setItem("smartBatchSort", smartBatchSort);
  if (typeof invalidateSmartBatchCache === "function") invalidateSmartBatchCache();
  smartCompactPage = 1;
  window.smartCompactExpandedId = null;
  if (window.smartResults?.length) {
    renderSmartResults(window.smartResults);
  }
}

function setSmartCompactPage(page) {
  const pages = Math.max(
    1,
    getSmartDisjointBatches(
      window.smartResults || [],
      smartParallelCount,
      window.smartResultsPool,
      smartBatchSort
    ).length
  );
  smartCompactPage = Math.min(Math.max(1, page), pages);
  window.smartCompactExpandedId = null;
  if (window.smartResults?.length) {
    renderSmartResults(window.smartResults);
  }
}

function updateSmartViewToolbar() {
  document.querySelectorAll("[data-view-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.viewMode === smartViewMode);
  });
  const expandBtn = document.getElementById("expandAllBtn");
  const collapseBtn = document.getElementById("collapseAllBtn");
  const showListOnly = smartViewMode === "list";
  if (expandBtn) expandBtn.style.display = showListOnly ? "" : "none";
  if (collapseBtn) collapseBtn.style.display = showListOnly ? "" : "none";
}

function expandAllSmartCards() {
  document.querySelectorAll("#resultList .smart-card").forEach((c) => c.classList.add("expanded"));
}

function collapseAllSmartCards() {
  document.querySelectorAll("#resultList .smart-card").forEach((c) => c.classList.remove("expanded"));
}

function setProgress(text, ratio) {
  document.getElementById("progressPanel").style.display = "block";
  document.getElementById("progressText").textContent = text;
  if (ratio != null) {
    document.getElementById("progressBar").style.width = `${Math.min(100, ratio * 100)}%`;
  }
}

function renderInsightPanel(meta, relaxed) {
  const el = document.getElementById("insightPanel");
  if (!el || !meta) return;
  el.style.display = "block";
  el.innerHTML = `
    <div class="insight-grid">
      <div class="insight-item"><span class="insight-val">${meta.fullyOwnedCount.toLocaleString()}</span><span class="insight-lbl">可组成完整配队</span></div>
      <div class="insight-item"><span class="insight-val">${meta.roughMatches.toLocaleString()}</span><span class="insight-lbl">快速筛选命中</span></div>
      <div class="insight-item"><span class="insight-val">${meta.precisePool}</span><span class="insight-lbl">精确重算数量</span></div>
      ${meta.disjointPoolCount != null ? `<div class="insight-item"><span class="insight-val">${meta.disjointPoolCount.toLocaleString()}</span><span class="insight-lbl">同屏候选池</span></div>` : ""}
      ${meta.qualifiedCount != null ? `<div class="insight-item"><span class="insight-val">${meta.qualifiedCount.toLocaleString()}</span><span class="insight-lbl">达标配队总数</span></div>` : ""}
      ${meta.precision ? `<div class="insight-item"><span class="insight-val">${{ standard: "标准", high: "高", max: "最高" }[meta.precision] || meta.precision}</span><span class="insight-lbl">分析精度</span></div>` : ""}
    </div>
    ${relaxed ? `<p class="insight-note">已自动放宽伤害下限，建议补充角色或提升羁绊后再筛选。</p>` : ""}
    ${meta.localCompCount ? `<p class="insight-note">含 ${meta.localCompCount} 套<strong>本地组合</strong>（新角色尚未出现在社区配队库，出招顺序借自相似配队，精确伤害仅供参考）。</p>` : ""}
    ${meta.unindexedOwned?.length && !meta.localCompCount ? `<p class="insight-note">持有 ${meta.unindexedOwned.length} 名社区库未收录角色，但未生成有效本地组合；请确认已在「持有角色」页添加并刷新。</p>` : ""}
  `;
}

async function startSmart() {
  if (running) return;
  const owned = getOwned();
  if (!owned.length) {
    showToast("请先在持有角色页添加角色", "info");
    return;
  }

  running = true;
  setButtonLoading(document.getElementById("startBtn"), true, "分析中…");
  document.getElementById("resultsSection").style.display = "none";
  document.getElementById("nearMissSection").style.display = "none";
  document.getElementById("insightPanel").style.display = "none";
  document.getElementById("resultList").innerHTML = "";
  document.getElementById("nearMissList").innerHTML = "";
  setProgress("初始化…", 0);

  const hpUpMin = Number(document.getElementById("hpUpMin").value);
  const fit13tMin = Number(document.getElementById("fit13tMin").value) * 1e8;
  const topN = Number(document.getElementById("topN").value);
  const sortBy = document.getElementById("sortBy").value;
  const dedupe = document.getElementById("dedupeCheck").checked;
  const showNearMiss = document.getElementById("nearMissCheck").checked;
  const precision = document.getElementById("precisionMode")?.value || "high";

  const options = {
    hpUpMin,
    fit13tMin,
    topN,
    mustInclude: [...mustInclude],
    sortBy,
    dedupe,
    precision,
    autoRelax: true,
  };

  try {
    setProgress("加载分析引擎…", 0.01);
    await ensureSmartEngineLoaded();
    if (typeof CalcEngine !== "undefined") {
      setProgress("等待计算引擎…", 0.02);
      await CalcEngine.waitUntilReady();
    }
    const { results, pool, meta, relaxed } = await smartRecommend(
      owned,
      options,
      (text, ratio) => setProgress(text, ratio)
    );

    window.smartResultsPool = pool || results;
    if (typeof invalidateSmartBatchCache === "function") invalidateSmartBatchCache();

    renderInsightPanel(meta, relaxed);

    document.getElementById("resultsSection").style.display = "block";
    document.getElementById("resultSummary").textContent = results.length
      ? `共 ${results.length} 套${relaxed ? "（已放宽条件）" : ""}${meta.localCompCount ? ` · 本地 ${meta.localCompCount}` : ""}`
      : "无匹配结果";

    const list = document.getElementById("resultList");
    if (!results.length) {
      list.innerHTML = renderEmptyState({
        icon: "🔍",
        title: "没有找到符合条件的配队",
        desc: meta?.localCompCount
          ? "已尝试本地组合但仍未达标。可取消必带、降低伤害下限，或等新角色出现在社区配队库。"
          : meta?.unindexedMust?.length
            ? "必带的新角色尚未出现在社区配队库；系统已尝试本地组合，请降低伤害下限或取消部分必带。"
            : "可尝试降低伤害下限、取消必带角色，或补充更多持有角色。",
        actionLabel: "管理持有角色",
        actionHref: siteUrl("have/index.html"),
      });
    } else {
      smartCompactPage = 1;
      window.smartCompactExpandedId = null;
      renderSmartResults(results);
    }

    if (showNearMiss) {
      setProgress("分析差 1 人配队…", 0.95);
      const nearMiss = await smartNearMiss(owned, {
        topN: 12,
        mustInclude: [...mustInclude],
        hpUpMin,
      });
      if (nearMiss.length) {
        window.smartNearMissList = nearMiss;
        document.getElementById("nearMissSection").style.display = "block";
        refreshNearMissList();
      } else {
        window.smartNearMissList = [];
      }
    }

    setProgress(`分析完成 · 推荐 ${results.length} 套配队`, 1);
    if (typeof setPinnedTeamsFromSmart === "function" && results.length) {
      setPinnedTeamsFromSmart(
        results,
        window.smartResultsPool,
        smartParallelCount,
        smartBatchSort
      );
      renderPinnedTeamsPanel();
    }
  } catch (e) {
    setProgress(`失败：${formatErrorMessage(e)}`, 0);
    showToast(`分析失败：${formatErrorMessage(e)}`, "error", 4000);
  } finally {
    running = false;
    setButtonLoading(document.getElementById("startBtn"), false);
    refreshUserInfo();
  }
}

async function startInvestAdvice() {
  if (investRunning || running) return;
  const owned = getOwned();
  if (!owned.length) {
    showToast("请先在持有角色页添加角色", "info");
    return;
  }

  investRunning = true;
  setButtonLoading(document.getElementById("investBtn"), true, "分析中…");
  document.getElementById("pullResultsSection").style.display = "none";
  document.getElementById("bondResultsSection").style.display = "none";
  document.getElementById("pullCompactPanel").innerHTML = "";
  document.getElementById("pullList").innerHTML = "";
  document.getElementById("bondUpgradeList").innerHTML = "";
  setProgress("加载配队库…", 0);

  const minOfficial = Number(document.getElementById("investMinOfficial").value) * 1e8;
  const assumeBond = Number(document.getElementById("pullAssumeBond").value);
  const minTeamCount = Number(document.getElementById("pullMinTeams").value);
  const targetMode = document.getElementById("bondTargetMode").value;
  const minPreciseGain = Number(document.getElementById("bondMinGain").value) * 1e8;
  const topN = Number(document.getElementById("investTopN").value);
  const hpUpMin = Number(document.getElementById("hpUpMin")?.value || 0);

  try {
    setProgress("加载分析引擎…", 0.01);
    await ensureSmartEngineLoaded();
    if (typeof CalcEngine !== "undefined") {
      setProgress("等待计算引擎…", 0.02);
      await CalcEngine.waitUntilReady();
    }

    const { pull, bond } = await smartInvestAdvice(
      owned,
      {
        pull: {
          topN,
          assumeBond,
          minOfficial,
          minTeamCount,
          hpUpMin,
          mustInclude: [...mustInclude],
          precalcTop: Math.min(topN, 25),
        },
        bond: {
          topN,
          minOfficial,
          minPreciseGain,
          hpUpMin,
          mustInclude: [...mustInclude],
          precalcTop: Math.min(topN, 20),
          targetMode,
          contextComps: window.smartResultsPool || window.smartResults || [],
        },
      },
      (text, ratio) => setProgress(text, ratio)
    );

    renderPullResults(pull);
    renderBondResults(bond, owned);

    const pullCount = pull.results?.length || 0;
    const bondCount = bond.results?.length || 0;
    setProgress(`培养建议完成 · 抽取 ${pullCount} 名 · 升羁绊 ${bondCount} 名`, 1);

    switchInvestTab(investActiveTab);
    document.getElementById("pullResultsSection").style.display =
      investActiveTab === "pull" ? "block" : "none";
    document.getElementById("bondResultsSection").style.display =
      investActiveTab === "bond" ? "block" : "none";
    if (pullCount || bondCount) {
      if (!pullCount && bondCount) switchInvestTab("bond");
      document.getElementById("investAdviceBlock").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (e) {
    setProgress(`失败：${formatErrorMessage(e)}`, 0);
    showToast(`培养建议失败：${formatErrorMessage(e)}`, "error", 4000);
  } finally {
    investRunning = false;
    setButtonLoading(document.getElementById("investBtn"), false);
  }
}

function renderPullResults(pull) {
  const { results, totalCandidates, pool } = pull;
  window.pullResults = results;
  window.pullResultsPool = pool || results;
  pullCompactPage = 1;
  pullCompactExpandedMissId = null;

  document.getElementById("pullResultsSection").style.display = "block";
  document.getElementById("pullSummary").textContent = results.length
    ? `四队参考 · 共 ${results.length} 名 · 库内 ${totalCandidates} 名候选`
    : "无优先抽取";

  const compactEl = document.getElementById("pullCompactPanel");
  const list = document.getElementById("pullList");

  if (!results.length) {
    compactEl.innerHTML = "";
    list.innerHTML = renderEmptyState({
      icon: "🎴",
      title: "暂无优先抽取",
      desc: "当前持有已覆盖大部分高配队，或可降低参考伤害下限 / 最少解锁配队数后重试。",
    });
    return;
  }

  refreshPullCompactPanel();
  list.innerHTML = results.map((item, i) => renderPullSuggestCard(item, i + 1)).join("");
}

function refreshPullCompactPanel() {
  const results = window.pullResults || [];
  const pool = window.pullResultsPool || results;
  const el = document.getElementById("pullCompactPanel");
  if (!el || !results.length) return;
  el.innerHTML = renderPullCompactPanel(
    results,
    pullCompactPage,
    pullCompactExpandedMissId,
    pool,
    4
  );
}

function setPullCompactPage(page) {
  const results = window.pullResults || [];
  const pool = window.pullResultsPool || results;
  const pages = Math.max(1, buildDisjointPullBatches(results, 4, pool).length);
  pullCompactPage = Math.min(Math.max(1, page), pages);
  pullCompactExpandedMissId = null;
  refreshPullCompactPanel();
}

function togglePullCompactRow(uid) {
  const detail = document.getElementById(uid);
  if (!detail) return;
  const wrap = detail.closest(".pull-compact-row-wrap");
  const missId = wrap?.dataset.missId ? Number(wrap.dataset.missId) : null;
  const wasOpen = detail.classList.contains("open");
  document.querySelectorAll(".pull-compact-row-wrap .smart-compact-detail.open").forEach((el) => {
    el.classList.remove("open");
    el.closest(".pull-compact-row-wrap")?.querySelector(".pull-compact-row")?.classList.remove("expanded");
  });
  if (!wasOpen && missId) {
    detail.classList.add("open");
    wrap?.querySelector(".pull-compact-row")?.classList.add("expanded");
    pullCompactExpandedMissId = missId;
  } else {
    pullCompactExpandedMissId = null;
  }
}

function renderBondResults(bond, owned) {
  const bondResults = bond.results;
  const bondTotal = bond.totalCandidates;

  document.getElementById("bondResultsSection").style.display = "block";
  document.getElementById("bondUpgradeSummary").textContent = bond.engineMissing
    ? "计算引擎未就绪"
    : bondResults.length
      ? `共 ${bondResults.length} 名 · ${bondTotal} 名可升花 · ${({ auto: "自动路径", max: "拉到5花", step: "+1花" })[bond.targetMode] || bond.targetMode}`
      : owned.every((o) => (o.bond || 1) >= 5)
        ? "全部满花"
        : "无显著增益";

  const bondList = document.getElementById("bondUpgradeList");
  if (!bondResults.length) {
    bondList.innerHTML = renderEmptyState({
      icon: "🌸",
      title: bond.engineMissing
        ? "计算引擎未就绪"
        : owned.every((o) => (o.bond || 1) >= 5)
          ? "持有角色均已满花"
          : "暂无升羁绊推荐",
      desc: bond.engineMissing
        ? "请刷新页面等待计算器加载完成后再试。"
        : owned.every((o) => (o.bond || 1) >= 5)
          ? "所有持有角色花数已达 5。"
          : "可先运行「开始分析」生成配队，或调整升花策略 / 最低增益。",
    });
  } else {
    bondList.innerHTML = bondResults.map((item, i) => renderBondUpgradeCard(item, i + 1)).join("");
  }
}

/** @deprecated 使用 startInvestAdvice */
async function startPullAdvice() {
  return startInvestAdvice();
}

/** @deprecated 使用 startInvestAdvice */
async function startBondAdvice() {
  return startInvestAdvice();
}
