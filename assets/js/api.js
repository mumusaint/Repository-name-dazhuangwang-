/**
 * 配队数据访问层
 * 全部从本地 data/compdata.json 读取并前端过滤，不再依赖远程 TenkaAssist API。
 * 适配 GitHub Pages 静态部署与本地 server.py 两种环境。
 */
function getApiBase() {
  if (typeof getSiteBase !== "function") return "/api";
  return getSiteBase() === ".." ? "../api" : "/api";
}

const SORT_OPTIONS = [
  { value: 1, label: "13 回合伤害（5 羁绊）" },
  { value: 4, label: "13 回合伤害（1 羁绊）" },
  { value: 0, label: "木椿存活（5 羁绊）" },
  { value: 2, label: "最新注册" },
  { value: 3, label: "最近修改" },
];

const STATIC_LIST_PAGE_SIZE = 30;
const STATIC_SEARCH_PAGE_SIZE = 20;

let _compdataEnsured = null;

/** 确保 pako + compdata.js 已加载，并完成配队库解压与索引 */
function ensureCompData(onProgress) {
  if (_compdataEnsured) return _compdataEnsured;
  _compdataEnsured = (async () => {
    const base = typeof getSiteBase === "function" ? getSiteBase() : ".";
    if (typeof pako === "undefined") {
      await loadScriptOnce(`${base}/assets/js/vendor/pako.min.js`);
    }
    if (typeof fetchCompDatabase !== "function") {
      await loadScriptOnce(`${base}/assets/js/compdata.js`);
    }
    return fetchCompDatabase(onProgress);
  })().catch((e) => {
    _compdataEnsured = null;
    throw e;
  });
  return _compdataEnsured;
}

function compToDetail(record) {
  if (!record) return null;
  return {
    ...record,
    compstr: Array.isArray(record.compstr) ? record.compstr.join(" ") : String(record.compstr || ""),
  };
}

/** 仅保留 5 人合法配队（与社区接口语义一致） */
function validComps() {
  const db = (typeof compDatabase !== "undefined" && compDatabase) || [];
  return db.filter((c) => Array.isArray(c.compstr) ? c.compstr.length === 5 : false);
}

function sortCompListLocal(list, sort) {
  const arr = [...list];
  switch (sort) {
    case 0:
      return arr.sort((a, b) => (b.ranking || 0) - (a.ranking || 0));
    case 2:
      return arr.sort((a, b) => String(b.create_at || "").localeCompare(String(a.create_at || "")));
    case 3:
      return arr.sort((a, b) => String(b.update_at || "").localeCompare(String(a.update_at || "")));
    case 4:
      return arr.sort((a, b) => (b.vote || 0) - (a.vote || 0));
    default:
      return arr.sort((a, b) => (b.recommend || 0) - (a.recommend || 0));
  }
}

/** 按必须包含/禁止/队名本地过滤（使用 compIndex.byChar 索引加速） */
function filterLocalComps({ chIds, banList, deckName }) {
  let pool = validComps();
  if (chIds?.length) {
    const idx = (typeof compIndex !== "undefined" && compIndex) || (typeof buildCompIndex === "function" ? buildCompIndex(compDatabase) : null);
    if (idx?.byChar) {
      const cand = getCandidateIndices ? getCandidateIndices(chIds, idx) : null;
      if (cand !== null) {
        if (!cand.length) return [];
        pool = cand.map((i) => compDatabase[i]).filter(Boolean);
      }
    }
  }
  if (banList?.length) {
    const ban = new Set(banList.map(Number));
    pool = pool.filter((c) => !c.compstr.some((id) => ban.has(id)));
  }
  if (deckName) {
    const q = String(deckName).toLowerCase();
    pool = pool.filter((c) => {
      const name = typeof compDisplayName === "function" ? compDisplayName(c) : c.name || "";
      return String(name).toLowerCase().includes(q);
    });
  }
  return pool;
}

async function fetchCompCount() {
  await ensureCompData();
  return { success: true, data: validComps().length };
}

async function fetchCompList(sort, page) {
  const db = await ensureCompData();
  const sorted = sortCompListLocal(validComps(), sort);
  const start = page * STATIC_LIST_PAGE_SIZE;
  const content = sorted.slice(start, start + STATIC_LIST_PAGE_SIZE).map(compToDetail);
  return { success: true, data: { content, total: sorted.length, page } };
}

async function searchCompCount({ chIds, banList, deckName }) {
  await ensureCompData();
  return { success: true, data: filterLocalComps({ chIds, banList, deckName }).length };
}

async function searchComps({ sort, page, chIds, banList, deckName }) {
  await ensureCompData();
  let pool = filterLocalComps({ chIds, banList, deckName });
  pool = sortCompListLocal(pool, sort);
  const start = page * STATIC_SEARCH_PAGE_SIZE;
  const content = pool.slice(start, start + STATIC_SEARCH_PAGE_SIZE).map(compToDetail);
  return { success: true, data: content };
}

/** 从本地配队库按 id 查找（不依赖任何在线 API） */
async function getCompById(id) {
  const numId = Number(id);
  if (!numId) return null;
  await ensureCompData();
  const hit = (typeof compIndex !== "undefined" && compIndex?.byId?.get(numId)) ||
    (compDatabase || []).find((c) => c.id === numId);
  return compToDetail(hit);
}

async function fetchCompDetail(id) {
  const numId = Number(id);
  if (!numId) return { success: false, msg: "无效的配队编号" };
  try {
    const local = await getCompById(numId);
    if (local) return { success: true, data: local };
  } catch (e) {
    console.warn("本地配队查找失败", e);
  }
  return { success: false, msg: "未找到该配队，请确认编号有效" };
}

function compMetric(comp, sort) {
  switch (sort) {
    case 0: return `<span class="metric-skull">💀 ${Math.round(comp.ranking)} 回合</span>`;
    case 2:
    case 3: return comp.recommend > 0
      ? `<span class="metric-dmg">⚡ ${formatNumber(comp.recommend)}</span>`
      : `<span class="metric-dmg">⚡ ${formatNumber(comp.vote)} <small>（1 羁绊）</small></span>`;
    case 4: return `<span class="metric-dmg">⚡ ${formatNumber(comp.vote)}</span>`;
    default: return `<span class="metric-dmg">⚡ ${formatNumber(comp.recommend)}</span>`;
  }
}

function compSideLabel(comp, sort, rank) {
  if (sort === 2) return comp.create_at || "-";
  if (sort === 3) return comp.update_at || "-";
  return `第${rank}名`;
}

function renderCompCard(comp, sort, rank) {
  const ids = comp.compstr.split(" ").map(Number);
  const chars = ids.map((id) => getCharacter(id)).filter(Boolean);
  const name = compDisplayName(comp);

  const deckHtml = chars
    .map((ch, i) => {
      const n = charDisplayName(ch);
      const hpUp = i === 0 && ch.hpUp ? `<span class="hp-badge">生命+${ch.hpUp}</span>` : "";
      const lib = ch.isLiberation || (typeof liberationList !== "undefined" && liberationList.includes(ch.name));
      return `<div class="deck-char" title="${n}">
        <img src="${charImageUrl(ch.id)}" alt="${n}">
        <span class="element-dot element-${ch.element}"></span>
        ${hpUp}${lib ? `<span class="lib-badge">+</span>` : ""}
        <span class="deck-char-name">${n}</span>
      </div>`;
    })
    .join("");

  return `<div class="comp-card" data-id="${comp.id}">
    <div class="comp-side">${compSideLabel(comp, sort, rank)}</div>
    <div class="comp-body">
      <div class="comp-name">${escapeHtml(name)}</div>
      <div class="comp-deck">${deckHtml}</div>
    </div>
    <div class="comp-metric">${compMetric(comp, sort, rank)}</div>
  </div>`;
}

function bindCompCardClicks(container, onClick) {
  container.querySelectorAll(".comp-card").forEach((el) => {
    el.addEventListener("click", () => onClick(Number(el.dataset.id)));
  });
}

function setupSortDropdown(selectId, onChange) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = SORT_OPTIONS.map((o) =>
    `<option value="${o.value}">${o.label}</option>`
  ).join("");
  sel.addEventListener("change", () => onChange(Number(sel.value)));
}

function setupInfiniteScroll(triggerId, onLoad) {
  const el = document.getElementById(triggerId);
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) onLoad();
  }, { rootMargin: "200px" });
  observer.observe(el);
}
