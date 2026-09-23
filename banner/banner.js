const BANNER_POOL_KEY = "dazhuang_banner_pool";
const BANNER_EVENT_KEY = "dazhuang_banner_event_id";
let bannerPool = [];
let bannerPresets = [];
let bannerEvents = null;
let running = false;
let pullCompactPage = 1;
let pullCompactExpandedMissId = null;
let bannerEngineReady = null;
let lastBannerReportData = null;

document.addEventListener("DOMContentLoaded", () => {
  bootBannerPage();
});

async function bootBannerPage() {
  renderHeader("banner");
  loadBannerPoolFromStorage();
  renderPoolUIShell();
  document.getElementById("poolSearch")?.addEventListener("input", refreshPoolGrid);

  try {
    await Promise.all([
      (async () => {
        await initAccounts();
        renderAccountBadge();
        refreshUserInfo();
      })(),
      (async () => {
        await loadCharacters();
        refreshPoolGrid();
      })(),
    ]);
  } catch (e) {
    showToast(`数据加载失败：${formatErrorMessage(e)}`, "error", 5000);
    document.getElementById("userInfo").innerHTML =
      `<span style="color:var(--danger)">${formatErrorMessage(e)} · 请运行 python server.py 后刷新</span>`;
    document.getElementById("poolCharGrid").innerHTML = renderEmptyState({
      icon: "⚠️",
      title: "角色数据未就绪",
      desc: formatErrorMessage(e),
      actionLabel: "返回首页",
      actionHref: siteUrl("index.html"),
    });
  }

  loadPresets();
  loadBannerEvents();
  bindBannerMechanicsInputs?.();
  configureBannerMechanicsForm?.();
}

/** 分析时再加载计算引擎与配队库，避免首屏卡住 */
function ensureBannerEngineLoaded() {
  if (bannerEngineReady) return bannerEngineReady;
  const base = getSiteBase();
  const scripts = [
    `${base}/assets/js/vendor/pako.min.js`,
    `${base}/characterJson.js`,
    `${base}/assets/js/calculator.v3.js`,
    `${base}/assets/js/autocalc.v3.js`,
    `${base}/assets/js/calcengine.js`,
    `${base}/assets/js/api.js`,
    `${base}/assets/js/command.js`,
    `${base}/assets/js/compdata.js?v=20260604b`,
  ];
  bannerEngineReady = (async () => {
    for (const src of scripts) {
      await loadScriptOnce(src);
    }
    if (typeof CalcEngine !== "undefined") {
      await CalcEngine.waitUntilReady(20000);
    }
  })().catch((e) => {
    bannerEngineReady = null;
    throw e;
  });
  return bannerEngineReady;
}

/** 分析 / 对比前：引擎 + compdata 函数就绪 */
async function ensureBannerAnalysisReady() {
  await ensureBannerEngineLoaded();
  if (typeof smartBannerPullSuggest !== "function") {
    throw new Error("配队分析模块未加载，请刷新页面并确认已用 python server.py 启动");
  }
}

function getRerunBanners() {
  const fromField = bannerEvents?.rerunBanners;
  if (Array.isArray(fromField) && fromField.length) return fromField;
  return (bannerEvents?.banners || []).filter((b) => b.kind === "rerun");
}

function getLimitedBanners() {
  return (bannerEvents?.banners || []).filter((b) => b.kind === "limited");
}

function getAllBanners() {
  const seen = new Set();
  const out = [];
  for (const b of [...getRerunBanners(), ...(bannerEvents?.banners || [])]) {
    if (!b?.id || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

function findBanner(bannerId) {
  return getAllBanners().find((b) => b.id === bannerId);
}

function getBannerCurrencyType(b) {
  if (b?.currencyType === "soul" || b?.currencyType === "crystal") return b.currencyType;
  const s = `${b?.currencySc || ""}${b?.nameSc || ""}`;
  if (/魂晶/.test(s)) return "soul";
  return "crystal";
}

function getBannersByCurrency(currencyType) {
  return getAllBanners().filter((b) => getBannerCurrencyType(b) === currencyType);
}

function getBannerSectionsConfig() {
  if (bannerEvents?.bannerSections?.length) return bannerEvents.bannerSections;
  return [
    { id: "crystal", labelSc: "魔晶 · 召唤契约" },
    { id: "soul", labelSc: "魂晶召唤" },
  ];
}

function getBannersForSection(sectionId) {
  return getAllBanners().filter((b) => getBannerCurrencyType(b) === sectionId);
}

const BANNER_KIND_LABEL = {
  rerun: "复刻",
  limited: "限定",
  step: "STEP",
  wish: "心愿",
};

const BANNER_CURRENCY_LABEL = {
  crystal: "魔晶",
  soul: "魂晶",
};

function renderBannerCard(b) {
  const ids = (b.ids || []).map(Number).filter(Boolean);
  const selected = ids.length && arraysEqual(bannerPool.slice().sort(), ids.slice().sort());
  const ups = (b.pickup || [])
    .map((p) => {
      const ch = getCharacter(p.id);
      const n = p.nameSc || charDisplayName(ch) || p.id;
      const rate = p.rate != null ? `<em>${(p.rate * 100).toFixed(1)}%</em>` : "";
      const img = p.id ? `<img src="${charImageUrl(p.id)}" alt="">` : "";
      return `<span class="banner-event-up">${img}${escapeHtml(n)} ${rate}</span>`;
    })
    .join("");
  const kindLabel = BANNER_KIND_LABEL[b.kind] || "";
  const curType = getBannerCurrencyType(b);
  const curLabel = BANNER_CURRENCY_LABEL[curType] || "";
  const tag = kindLabel ? `<span class="banner-tag-rerun banner-tag-${b.kind || "other"}">${kindLabel}</span>` : "";
  const curTag = curLabel
    ? `<span class="banner-tag-currency banner-tag-${curType}">${curLabel}</span>`
    : "";
  const range = b.startAt && b.endAt ? formatEventRange(b) : "";
  const costLine = b.currencySc
    ? `<p class="banner-card-cost">${escapeHtml(b.currencySc)}</p>`
    : "";
  return `<div class="banner-event-card${selected ? " selected" : ""}${b.kind === "rerun" ? " banner-event-rerun" : ""} banner-currency-${curType}">
    <div class="banner-event-card-head">
      <strong>${curTag}${tag}${escapeHtml(b.nameSc)}</strong>
      <button type="button" class="btn btn-sm${selected ? " btn-primary" : ""}" onclick="applyEventBanner('${b.id}')">${selected ? "已选" : "选此池"}</button>
    </div>
    ${range ? `<p class="banner-card-range">${escapeHtml(range)}</p>` : ""}
    ${costLine}
    <div class="banner-event-ups">${ups || `<span class="empty-hint" style="font-size:0.78rem">请在 banner_events.json 填写 pickup</span>`}</div>
    ${b.noteSc ? `<p class="banner-card-note">${escapeHtml(b.noteSc)}</p>` : ""}
  </div>`;
}

function renderPoolUIShell() {
  const hint = document.getElementById("poolHint");
  if (hint) {
    hint.textContent = bannerPool.length
      ? `已选 ${bannerPool.length} 名卡池角色 · 点击角色可取消`
      : "在下方点选本期限定 / UP 角色（可多选）";
  }
  const bar = document.getElementById("poolSelectedBar");
  if (bar) {
    bar.innerHTML = bannerPool.length
      ? bannerPool
          .map((id) => {
            const ch = getCharacter(id);
            const n = charDisplayName(ch) || id;
            return `<button type="button" class="must-chip active" onclick="toggleBannerChar(${id})" title="点击移除">
          <img src="${charImageUrl(id)}" alt="${n}"><span>${n}</span>
        </button>`;
          })
          .join("")
      : `<span class="empty-hint">尚未选择卡池角色</span>`;
  }
  const grid = document.getElementById("poolCharGrid");
  if (grid && !characterData?.data) {
    grid.innerHTML = `<p class="empty-hint" style="grid-column:1/-1">角色列表加载中…</p>`;
  }
}

function loadBannerPoolFromStorage() {
  try {
    const raw = localStorage.getItem(BANNER_POOL_KEY);
    bannerPool = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(bannerPool)) bannerPool = [];
    bannerPool = [...new Set(bannerPool.map(Number).filter(Boolean))];
  } catch {
    bannerPool = [];
  }
}

function saveBannerPool() {
  localStorage.setItem(BANNER_POOL_KEY, JSON.stringify(bannerPool));
}

async function loadBannerEvents() {
  const meta = document.getElementById("eventMeta");
  if (meta) meta.textContent = "正在加载公告…";
  try {
    bannerEvents = await fetchJsonWithTimeout(`${getSiteBase()}/data/banner_events.json`);
    renderBannerEventsPanel();
  if (!localStorage.getItem(BANNER_POOL_KEY) && bannerEvents?.banners?.length) {
    const first = getLimitedBanners()[0] || getRerunBanners()[0];
    if (first) applyEventBanner(first.id, false);
  }
  } catch (e) {
    bannerEvents = null;
    console.error("loadBannerEvents", e);
    if (meta) {
      meta.textContent = `公告加载失败：${formatErrorMessage(e)}。可手动点选下方角色。`;
    }
    document.getElementById("eventBannerCards").innerHTML = "";
  }
}

function parseEventTime(iso) {
  if (!iso) return null;
  return new Date(iso);
}

function isEventActive(ev) {
  if (!ev?.startAt || !ev?.endAt) return true;
  const now = Date.now();
  const start = parseEventTime(ev.startAt)?.getTime() ?? 0;
  const end = parseEventTime(ev.endAt)?.getTime() ?? Infinity;
  return now >= start && now <= end;
}

function formatEventRange(ev) {
  if (!ev?.startAt || !ev?.endAt) return "";
  const fmt = (iso) => {
    const d = parseEventTime(iso);
    if (!d) return iso;
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  return `${fmt(ev.startAt)} — ${fmt(ev.endAt)}`;
}

function renderBannerEventsPanel() {
  const meta = document.getElementById("eventMeta");
  const host = document.getElementById("bannerSectionsHost");
  const mech = document.getElementById("gachaMechanics");
  const compareBtn = document.getElementById("compareBtn");
  if (!meta || !host) return;

  const allBanners = getAllBanners();

  if (!allBanners.length) {
    meta.textContent = "暂无公告卡池数据，请使用下方快捷预设或手动点选。";
    host.innerHTML = "";
    if (compareBtn) compareBtn.disabled = true;
    if (mech) mech.style.display = "none";
    return;
  }

  const ev = bannerEvents.event || {};
  const active = isEventActive(ev);
  const sourceLink = bannerEvents.sourceUrl
    ? ` · <a href="${escapeHtml(bannerEvents.sourceUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">官方公告</a>`
    : "";
  meta.innerHTML =
    `<strong>${escapeHtml(ev.titleSc || "限定召唤")}</strong> · v${escapeHtml(bannerEvents.version || "?")}` +
    (active ? ` · <span style="color:var(--success)">进行中</span>` : ` · <span style="color:var(--warning)">已结束或未开始</span>`) +
    `<br><span style="font-size:0.78rem">${formatEventRange(ev)} · 契约：${escapeHtml(ev.currencySc || "召唤契约")}${sourceLink}</span>`;

  if (compareBtn) compareBtn.disabled = false;

  const sections = getBannerSectionsConfig();
  host.innerHTML = sections
    .map((sec) => {
      const list = getBannersForSection(sec.id);
      if (!list.length) return "";
      const sorted = list.slice().sort((a, b) => {
        const order = { limited: 0, rerun: 1, step: 2, wish: 3 };
        return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
      });
      return `<div class="banner-section-block banner-currency-section banner-currency-section-${sec.id}" style="margin-bottom:0.85rem">
        <div class="banner-section-label">${escapeHtml(sec.labelSc)}${sec.descSc ? `<span class="banner-section-desc">${escapeHtml(sec.descSc)}</span>` : ""}</div>
        <div class="banner-event-grid">${sorted.map(renderBannerCard).join("")}</div>
      </div>`;
    })
    .join("");

  configureBannerMechanicsForm();
  renderActiveBannerMechanicsPanel();
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function applyEventBanner(bannerId, toast = true) {
  const b = findBanner(bannerId);
  if (!b?.ids?.length) {
    applyPreset(bannerId);
    return;
  }
  bannerPool = [...b.ids];
  saveBannerPool();
  localStorage.setItem(BANNER_EVENT_KEY, bannerId);
  renderPoolUI();
  renderBannerEventsPanel();
  configureBannerMechanicsForm();
  renderActiveBannerMechanicsPanel();
  if (toast) showToast(`已选卡池：${b.nameSc}`, "success");
}

async function loadPresets() {
  const el = document.getElementById("presetChips");
  if (el) el.innerHTML = `<span class="stat-muted" style="font-size:0.8rem">预设加载中…</span>`;
  try {
    const data = await fetchJsonWithTimeout(`${getSiteBase()}/data/banner_presets.json`);
    bannerPresets = data.presets || [];
    if (!el) return;
    if (!bannerPresets.length) {
      el.innerHTML = `<span class="stat-muted" style="font-size:0.8rem">无预设 · 请点选下方角色</span>`;
      return;
    }
    el.innerHTML = bannerPresets
      .map(
        (p) =>
          `<button type="button" class="btn btn-sm" onclick="applyPreset('${p.id}')">${escapeHtml(p.name)}</button>`
      )
      .join(" ");
  } catch (e) {
    bannerPresets = [];
    console.error("loadPresets", e);
    if (el) {
      el.innerHTML = `<span class="stat-muted" style="font-size:0.8rem;color:var(--danger)">预设加载失败</span>`;
    }
  }
}

function applyPreset(id) {
  const fromEvent = findBanner(id);
  if (fromEvent) {
    applyEventBanner(id);
    return;
  }
  const preset = bannerPresets.find((p) => p.id === id);
  if (!preset?.ids?.length) return;
  bannerPool = [...new Set(preset.ids.map(Number))];
  saveBannerPool();
  renderPoolUI();
  renderBannerEventsPanel();
  showToast(`已载入预设：${preset.name}`, "success");
}

function refreshUserInfo() {
  refreshUserInfoBar("userInfo", { analyzeBtnIds: ["analyzeBtn"] });
}

function toggleBannerChar(id) {
  const idx = bannerPool.indexOf(id);
  if (idx === -1) bannerPool.push(id);
  else bannerPool.splice(idx, 1);
  saveBannerPool();
  renderPoolUI();
  renderBannerEventsPanel();
}

function clearBannerPool() {
  bannerPool = [];
  saveBannerPool();
  renderPoolUI();
  renderBannerEventsPanel();
}

function renderPoolUI() {
  renderPoolUIShell();
  refreshPoolGrid();
  renderBannerEventsPanel();
}

function refreshPoolGrid() {
  const grid = document.getElementById("poolCharGrid");
  if (!grid) return;
  if (!characterData?.data) {
    grid.innerHTML = `<p class="empty-hint" style="grid-column:1/-1">角色列表加载中…</p>`;
    return;
  }
  const search = document.getElementById("poolSearch")?.value.trim() || "";
  const filtered = filterCharacters(characterData.data, {
    search,
    okOnly: true,
  });
  grid.innerHTML = filtered
    .map((ch) => {
      const inPool = bannerPool.includes(ch.id);
      return renderCharCard(ch, {
        selected: inPool,
        onclick: `toggleBannerChar(${ch.id})`,
        showName: true,
      });
    })
    .join("");
}

function setProgress(text, ratio) {
  document.getElementById("progressPanel").style.display = "block";
  document.getElementById("progressText").textContent = text;
  if (ratio != null) {
    document.getElementById("progressBar").style.width = `${Math.min(100, ratio * 100)}%`;
  }
}

function getAnalysisOptions(poolIds) {
  return {
    poolIds: poolIds || [...bannerPool],
    topN: (poolIds || bannerPool).length,
    precalcTop: (poolIds || bannerPool).length,
    assumeBond: Number(document.getElementById("assumeBond").value),
    minOfficial: Number(document.getElementById("minOfficial").value) * 1e8,
    minTeamCount: Number(document.getElementById("minTeams").value),
    hpUpMin: Number(document.getElementById("hpUpMin").value),
  };
}

function scoreBannerAnalysis(data) {
  if (!data?.results?.length) return 0;
  const r = data.results[0];
  return (r.preciseDmg || r.avgOfficial || 0) + r.teamCount * 1.2e9;
}

function renderGachaPullHint() {
  if (typeof renderBannerPullProgressHint === "function") {
    return renderBannerPullProgressHint();
  }
  return "";
}

async function pickBestBannerRoi(owned, banners, onProgress) {
  let best = null;
  for (let i = 0; i < banners.length; i++) {
    const b = banners[i];
    onProgress?.(`分析 ${b.nameSc}…`, i, banners.length);
    const data = await smartBannerPullSuggest(owned, getAnalysisOptions(b.ids));
    const score = scoreBannerAnalysis(data);
    if (!best || score > best.score) best = { banner: b, data, score };
  }
  return best;
}

function rowFromBestBest(best, label, kind) {
  if (!best) return null;
  const top = best.data.results[0];
  return {
    kind,
    label,
    sub: best.banner.nameSc,
    pick: top?.missId,
    pickName: top ? charDisplayName(getCharacter(top.missId)) || top.missId : "—",
    teams: top?.teamCount ?? 0,
    dmg: top?.preciseDmg ? formatNumber(top.preciseDmg) : "—",
    score: best.score,
    bannerId: best.banner.id,
  };
}

async function compareThreeWayBanners() {
  if (running) return;
  const owned = getOwned();
  if (!owned.length) {
    showToast("请先添加持有角色", "info");
    return;
  }
  running = true;
  setButtonLoading(document.getElementById("compareBtn"), true, "对比中…");
  document.getElementById("comparePanel").style.display = "none";
  setProgress("加载分析引擎…", 0);

  try {
    await ensureBannerAnalysisReady();
    const opts = getAnalysisOptions();
    const rows = [];

    const crystalList = getBannersByCurrency("crystal");
    if (crystalList.length) {
      setProgress("分析魔晶池…", 0.15);
      const bestCrystal = await pickBestBannerRoi(owned, crystalList, (msg) => setProgress(msg, 0.2));
      const row = rowFromBestBest(bestCrystal, "魔晶 / 契约池", "crystal");
      if (row) rows.push(row);
    }

    const soulList = getBannersByCurrency("soul");
    if (soulList.length) {
      setProgress("分析魂晶池…", 0.45);
      const bestSoul = await pickBestBannerRoi(owned, soulList, (msg) => setProgress(msg, 0.5));
      const row = rowFromBestBest(bestSoul, "魂晶池", "soul");
      if (row) rows.push(row);
    }

    setProgress("分析全库优先抽取…", 0.65);
    const fullPull = await smartPullSuggest(owned, {
      topN: 5,
      precalcTop: 5,
      assumeBond: opts.assumeBond,
      minOfficial: opts.minOfficial,
      minTeamCount: opts.minTeamCount,
      hpUpMin: opts.hpUpMin,
    });
    const fullTop = fullPull.results[0];
    rows.push({
      kind: "full",
      label: "全库（不限池）",
      sub: "任意 SSR",
      pick: fullTop?.missId,
      pickName: fullTop ? charDisplayName(getCharacter(fullTop.missId)) || fullTop.missId : "—",
      teams: fullTop?.teamCount ?? 0,
      dmg: fullTop?.preciseDmg ? formatNumber(fullTop.preciseDmg) : "—",
      score: scoreBannerAnalysis({ results: fullPull.results }),
      bannerId: null,
    });

    rows.sort((a, b) => b.score - a.score);
    renderThreeWayComparePanel(rows);
    lastBannerReportData = { ...(lastBannerReportData || {}), tripleCompare: rows };
    setProgress("三向对比完成", 1);
  } catch (e) {
    showToast(formatErrorMessage(e), "error", 4000);
  } finally {
    running = false;
    setButtonLoading(document.getElementById("compareBtn"), false);
  }
}

function renderThreeWayComparePanel(rows) {
  const panel = document.getElementById("comparePanel");
  const el = document.getElementById("compareContent");
  panel.style.display = "block";
  const best = rows[0];
  el.innerHTML = `
    <p style="font-size:0.88rem;color:var(--text-muted);margin-top:0">
      综合解锁与重算，当前 ROI 最高：<strong style="color:var(--accent)">${escapeHtml(best.label)}</strong>
      ${best.sub ? `（${escapeHtml(best.sub)}）` : ""} · 首推 <strong>${escapeHtml(best.pickName)}</strong>
    </p>
    <div class="banner-compare-grid">
      ${rows
        .map((row, i) => {
          return `<div class="banner-compare-card${i === 0 ? " best" : ""}">
            <div class="banner-compare-rank">${i === 0 ? "ROI 最高" : row.label}</div>
            <strong>${escapeHtml(row.label)}</strong>
            <p style="font-size:0.78rem">${escapeHtml(row.sub || "")}</p>
            <p>首推 <strong>${escapeHtml(row.pickName)}</strong></p>
            <p>解锁 <strong>${row.teams}</strong> 套 · ${row.dmg}</p>
            ${row.bannerId ? `<button type="button" class="btn btn-sm" onclick="applyEventBanner('${row.bannerId}');startBannerAnalysis()">选此池并分析</button>` : `<a href="${siteUrl("smart/index.html")}" class="btn btn-sm">去智能打桩</a>`}
          </div>`;
        })
        .join("")}
    </div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** @deprecated 使用 compareThreeWayBanners */
async function compareEventBanners() {
  return compareThreeWayBanners();
}

async function startBannerAnalysis() {
  if (running) return;
  if (!bannerPool.length) {
    showToast("请先选择卡池 UP 角色", "info");
    return;
  }
  const owned = getOwned();
  if (!owned.length) {
    showToast("请先在持有角色页添加角色", "info");
    return;
  }

  running = true;
  setButtonLoading(document.getElementById("analyzeBtn"), true, "分析中…");
  document.getElementById("resultsSection").style.display = "none";
  document.getElementById("summaryPanel").style.display = "none";
  document.getElementById("ownedPoolSection").style.display = "none";
  document.getElementById("pullSimPanel").style.display = "none";
  document.getElementById("pullVsBondPanel").style.display = "none";
  setProgress("加载配队库…", 0);

  const options = getAnalysisOptions();

  try {
    setProgress("加载分析引擎…", 0.05);
    await ensureBannerAnalysisReady();

    const data = await smartBannerPullSuggest(owned, options, (text, ratio) =>
      setProgress(text, ratio)
    );

    let simRows = [];
    let pullVsBond = null;
    try {
      setProgress("模拟再抽…", 0.92);
      const simCounts =
        typeof getSimCountsForActiveBanner === "function" ? getSimCountsForActiveBanner() : [1, 3, 10];
      const sim = await simulatePoolPulls(owned, options, simCounts);
      simRows = sim.rows;
      renderPullSimPanel(simRows, getActiveBannerMechanics?.());
    } catch (e) {
      console.warn("pull sim", e);
    }

    if (data.ownedInPool?.length) {
      try {
        setProgress("分析已持有 UP 升羁绊…", 0.96);
        const poolBond = await smartBondUpgradeForPool(
          owned,
          data.ownedInPool.map((o) => o.id),
          options
        );
        const topBond = poolBond.results[0];
        const topPull = data.results[0];
        const advice = comparePullVsBondAdvice(topPull, topBond);
        pullVsBond = advice.text;
        renderPullVsBondPanel(advice, data.ownedInPool, topBond);
      } catch (e) {
        console.warn("bond advice", e);
      }
    }

    lastBannerReportData = {
      results: data.results,
      ownedInPool: data.ownedInPool,
      bestPick: data.bestPick,
      simRows,
      pullVsBond,
      mechanics: typeof getActiveBannerMechanics === "function" ? getActiveBannerMechanics() : null,
      mechanicsState:
        typeof computeMechanicsState === "function"
          ? computeMechanicsState(getActiveBannerMechanics(), readBannerMechanicsInputs())
          : null,
    };
    document.getElementById("exportBannerBtn").style.display = "inline-flex";

    renderBannerResults(data, pullVsBond);
    setProgress(`分析完成 · 卡池 ${bannerPool.length} 名`, 1);
  } catch (e) {
    setProgress(`失败：${formatErrorMessage(e)}`, 0);
    showToast(`分析失败：${formatErrorMessage(e)}`, "error", 4000);
  } finally {
    running = false;
    setButtonLoading(document.getElementById("analyzeBtn"), false);
  }
}

function renderBannerResults(data, pullVsBondText) {
  const { results, ownedInPool, bestPick } = data;
  window.pullResults = results;
  window.pullResultsPool = data.pool || results;
  pullCompactPage = 1;
  pullCompactExpandedMissId = null;

  const summaryEl = document.getElementById("summaryPanel");
  summaryEl.style.display = "block";

  if (bestPick) {
    const ch = getCharacter(bestPick);
    const name = charDisplayName(ch) || bestPick;
    const top = results[0];
    summaryEl.innerHTML = `
      <div class="banner-summary-inner">
        <img src="${charImageUrl(bestPick)}" alt="${name}" class="banner-summary-img">
        <div>
          <div class="banner-summary-label">当前卡池首推</div>
          <div class="banner-summary-name">${escapeHtml(name)}</div>
          <p class="banner-summary-desc">
            抽到后可解锁约 <strong>${top?.teamCount ?? 0}</strong> 套高配队
            ${top?.preciseDmg ? ` · 代表队重算约 <strong>${formatNumber(top.preciseDmg)}</strong>` : ""}
          </p>
          ${renderGachaPullHint()}
        </div>
      </div>`;
  } else if (ownedInPool?.length && ownedInPool.length >= bannerPool.length) {
    summaryEl.innerHTML = `
      <div class="banner-summary-inner">
        <div>
          <div class="banner-summary-label">卡池角色已齐</div>
          <p class="banner-summary-desc">所选 UP 均已持有，<strong>建议升羁绊</strong>而非再抽。${pullVsBondText ? `<br>${escapeHtml(pullVsBondText)}` : ""}</p>
          <div class="btn-group" style="margin-top:0.5rem">
            <a href="${siteUrl("smart/index.html")}?tab=bond" class="btn btn-primary btn-sm">升羁绊分析</a>
            <a href="${siteUrl("smart/index.html")}" class="btn btn-sm">智能打桩</a>
          </div>
        </div>
      </div>`;
  } else {
    summaryEl.innerHTML = `
      <div class="banner-summary-inner">
        <p class="banner-summary-desc">当前条件下卡池角色较难组成达标高配队，可降低伤害下限或补充持有后再试。</p>
      </div>`;
  }

  if (ownedInPool?.length) {
    document.getElementById("ownedPoolSection").style.display = "block";
    document.getElementById("ownedPoolList").innerHTML = ownedInPool
      .map((o) => {
        const n = charDisplayName(o.char) || o.id;
        const lowBond = (o.bond || 1) < 5;
        return `<div class="banner-owned-row">
          <img src="${charImageUrl(o.id)}" alt="${n}">
          <span>${escapeHtml(n)}</span>
          <span class="smart-tag">已持有 ${o.bond} 花</span>
          ${lowBond ? `<span class="smart-tag tag-warn">可升羁绊</span>` : `<span class="smart-tag">满花</span>`}
        </div>`;
      })
      .join("");
  }

  document.getElementById("resultsSection").style.display = "block";
  document.getElementById("resultSummary").textContent = results.length
    ? `待抽取 ${results.length} 名 · 按解锁价值排序`
    : "无待抽取推荐";

  const list = document.getElementById("resultList");
  const compact = document.getElementById("pullCompactPanel");

  if (!results.length) {
    compact.innerHTML = "";
    list.innerHTML = renderEmptyState({
      icon: "🎴",
      title: "暂无抽取推荐",
      desc: "可能已全部持有，或当前持有下难以用卡池角色组成达标队。",
      actionLabel: "调整条件重试",
      actionHref: "#",
    });
    return;
  }

  refreshPullCompactPanel();
  list.innerHTML = results
    .map((item, i) => renderBannerPullCard(item, i + 1, { isTopPick: i === 0 && item.teamCount > 0 }))
    .join("");
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
    Math.min(4, results.length)
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
  const missId = Number(detail.closest(".pull-compact-row-wrap")?.dataset.missId);
  document.querySelectorAll(".pull-compact-row-wrap .smart-compact-detail.open").forEach((el) => {
    el.classList.remove("open");
    el.closest(".pull-compact-row-wrap")?.querySelector(".pull-compact-row")?.classList.remove("expanded");
  });
  if (!detail.classList.contains("open")) {
    detail.classList.add("open");
    detail.closest(".pull-compact-row-wrap")?.querySelector(".pull-compact-row")?.classList.add("expanded");
    pullCompactExpandedMissId = missId;
  } else {
    pullCompactExpandedMissId = null;
  }
}

function renderPullSimPanel(rows, mech) {
  const panel = document.getElementById("pullSimPanel");
  const el = document.getElementById("pullSimContent");
  if (!panel || !el || !rows?.length) return;
  panel.style.display = "block";
  const intro =
    mech?.simMode === "fixed_ten"
      ? "眷恋贝壳：按剩余十连次数，估算再获得 1～2 名 SSR 后的四队参考"
      : mech?.kind === "step"
        ? "按当前优先级依次获得卡池角色，并结合 STEP 进度估算四队"
        : "按当前优先级依次获得卡池角色，估算可组无重复四队数量";
  const unit = mech?.simMode === "fixed_ten" ? "名 SSR" : "张";
  el.innerHTML = `
    <p style="font-size:0.82rem;color:var(--text-muted);margin-top:0">${escapeHtml(intro)}</p>
    <div class="banner-compare-grid">
      ${rows
        .map(
          (r) => `<div class="banner-compare-card">
            <strong>再获得 ${r.n} ${unit}</strong>
            <p>${r.pickNames.length ? escapeHtml(r.pickNames.join("、")) : "—"}</p>
            <p>四队参考 <strong>${r.disjointTeams}</strong> 套 · 池内待抽 ${r.remainingInPool} 名</p>
          </div>`
        )
        .join("")}
    </div>`;
}

function renderPullVsBondPanel(advice, ownedInPool, topBond) {
  const panel = document.getElementById("pullVsBondPanel");
  const el = document.getElementById("pullVsBondContent");
  if (!panel || !el) return;
  panel.style.display = "block";
  const bondRows = ownedInPool
    .filter((o) => (o.bond || 1) < 5)
    .map((o) => {
      const n = charDisplayName(o.char) || o.id;
      return `<span class="must-chip"><img src="${charImageUrl(o.id)}" alt=""><span>${escapeHtml(n)} ${o.bond}花</span></span>`;
    })
    .join("");
  el.innerHTML = `
    <p class="banner-summary-desc">${escapeHtml(advice.text || "")}</p>
    ${bondRows ? `<div style="margin:0.5rem 0">${bondRows}</div>` : ""}
    ${topBond ? `<p style="font-size:0.8rem;color:var(--text-muted)">卡池内升花首推：${escapeHtml(charDisplayName(getCharacter(topBond.charId)) || topBond.charId)} +1 花</p>` : ""}
    <a href="${siteUrl("smart/index.html")}?tab=bond" class="btn btn-sm btn-primary" style="margin-top:0.35rem">详细升羁绊分析</a>`;
}

function exportCurrentBannerReport() {
  if (typeof exportBannerReportMarkdown === "function" && lastBannerReportData) {
    exportBannerReportMarkdown(lastBannerReportData);
  } else {
    showToast("请先运行卡池分析", "info");
  }
}
