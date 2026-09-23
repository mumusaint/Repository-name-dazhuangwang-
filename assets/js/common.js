const IMG_BASE = "https://inittt.github.io/tenkaassist/images/characters";
const STORAGE_OWNED = "dazhuang_owned";
const STORAGE_TEAM = "dazhuang_team";

const ELEMENTS = ["火", "水", "风", "光", "暗"];
const ROLES = ["输出", "治疗", "坦克", "辅助", "干扰"];
const RARITIES = ["普通", "罕见", "稀有", "超稀有"];

function charDisplayName(ch) {
  if (!ch) return "";
  if (ch.nameSc) return ch.nameSc;
  const id = Number(ch.id);
  if (id && characterMap.has(id)) {
    const sc = characterMap.get(id).nameSc;
    if (sc) return sc;
  }
  return ch.nameTc || ch.nameEn || "";
}

function hasHangul(s) {
  return /[\uAC00-\uD7AF]/.test(String(s ?? ""));
}

let _krNickToScMap = null;
let _compNameAliases = null;

async function loadCompNameAliases() {
  if (_compNameAliases !== null) return _compNameAliases;
  try {
    const res = await fetch(`${getSiteBase()}/data/comp_name_aliases.json`);
    _compNameAliases = res.ok ? await res.json() : {};
  } catch {
    _compNameAliases = {};
  }
  _krNickToScMap = null;
  return _compNameAliases;
}

/** 韩文角色名 / 昵称 → 简中（用于配队名翻译） */
function getKrNickToScMap() {
  if (_krNickToScMap) return _krNickToScMap;
  _krNickToScMap = new Map();
  const list = characterData?.data || [];
  for (const ch of list) {
    const kr = ch.name;
    const sc = charDisplayName(ch);
    if (!kr || !sc) continue;
    _krNickToScMap.set(kr, sc);
    for (let len = 2; len <= Math.min(5, kr.length); len++) {
      const prefix = kr.slice(0, len);
      if (!_krNickToScMap.has(prefix)) _krNickToScMap.set(prefix, sc);
    }
  }
  if (_compNameAliases && typeof _compNameAliases === "object") {
    Object.entries(_compNameAliases).forEach(([k, v]) => {
      if (k && v) _krNickToScMap.set(k, v);
    });
  }
  // 社区常用韩文简称 → 简中（优先级最高，覆盖自动推断）
  const manual = {
    이블: "伊布力斯",
    정이블: "丧伊",
    크이블: "圣伊",
    수이블: "夏伊",
    코이블: "可伊",
    신이블: "花伊",
    바이블: "兔伊",
    안코: "小泱",
    얀코: "小泱",
  };
  Object.entries(manual).forEach(([k, v]) => _krNickToScMap.set(k, v));
  return _krNickToScMap;
}

function compNameFromRoster(comp) {
  const ids = Array.isArray(comp?.compstr)
    ? comp.compstr.map(Number).filter(Boolean)
    : String(comp?.compstr || "")
        .split(/\s+/)
        .map(Number)
        .filter(Boolean);
  if (!ids.length) return comp?.id ? `配队 #${comp.id}` : "社区配队";
  const names = ids
    .slice(0, 3)
    .map((id) => charDisplayName(getCharacter(id)) || id)
    .filter(Boolean);
  if (names.length >= 2) return `${names.join("·")}队`;
  return `${names[0]}队`;
}

function translateKrDeckName(krName) {
  const raw = String(krName || "").trim();
  if (!raw) return "";
  const base = raw.replace(/덱\d*$/u, "").trim();
  if (!base) return "";
  const map = getKrNickToScMap();
  if (map.has(base)) return `${map.get(base)}队`;
  for (let len = base.length; len >= 2; len--) {
    const sub = base.slice(0, len);
    if (map.has(sub)) return `${map.get(sub)}队`;
  }
  for (const ch of characterData?.data || []) {
    if (ch.name === base) return `${charDisplayName(ch)}队`;
  }
  return "";
}

/** 配队显示名：优先简中，韩文队名自动翻译或按成员生成 */
function compDisplayName(comp) {
  if (!comp) return "社区配队";
  if (comp.nameSc) return comp.nameSc;
  const raw = comp.name || "";
  if (raw && !hasHangul(raw)) return raw;
  if (raw && hasHangul(raw)) {
    const translated = translateKrDeckName(raw);
    if (translated) return translated;
  }
  return compNameFromRoster(comp);
}

function formatErrorMessage(e) {
  const msg = e?.message || String(e);
  if (msg === "Failed to fetch") {
    return "网络请求失败：请用 python server.py 启动（不要用 http.server），并确保配队库可下载";
  }
  if (msg.startsWith("接口 ")) return `接口请求失败（${msg.slice(3)}）`;
  if (msg.startsWith("HTTP ")) return `下载失败（${msg}）`;
  return msg;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 根据当前页面路径解析站点根相对前缀 */
function getSiteBase() {
  const path = location.pathname.replace(/\\/g, "/");
  const subdirs = ["have", "team", "calc", "comps", "search", "comp", "smart", "banner", "boss", "login", "changelog", "new"];
  return subdirs.some((d) => path.includes(`/${d}/`) || path.endsWith(`/${d}`)) ? ".." : ".";
}

function siteUrl(subpath) {
  const base = getSiteBase();
  return base === ".." ? `${base}/${subpath}` : subpath;
}

/** 是否运行在本地 Python server（用于区分可写后端能力，如同步/补全） */
function isLocalServer() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

const _scriptLoadPromises = new Map();

/** 按需加载 JS（同 URL 只加载一次） */
function loadScriptOnce(src) {
  if (_scriptLoadPromises.has(src)) return _scriptLoadPromises.get(src);
  const p = new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`脚本加载失败：${src}`));
    document.head.appendChild(s);
  });
  _scriptLoadPromises.set(src, p);
  return p;
}

/** 带超时的 JSON 请求，避免页面一直卡在「加载中」 */
async function fetchJsonWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("请求超时，请确认已运行 python server.py");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

let characterData = null;
const characterMap = new Map();
let maindataOverlay = null;
const maindataMap = new Map();
let gameCharacterNames = null;
const gameNameMap = new Map();
let gameDataStatus = null;
let manualCharacters = null;
let stageOverlay = null;
const stageMap = new Map();
let localCharacterImages = null;
let newCharIdSet = null;

function getNewCharIds() {
  if (newCharIdSet) return newCharIdSet;
  const fromParsed = characterData?.manual || [];
  const fromManual = (manualCharacters || []).map((c) => c.id);
  newCharIdSet = new Set([...fromParsed, ...fromManual].map(Number));
  return newCharIdSet;
}

function isNewCharacter(ch) {
  if (!ch) return false;
  return Boolean(ch.manual || ch.source === "manual" || getNewCharIds().has(Number(ch.id)));
}

function getNewCharacters() {
  if (!characterData?.data) return [];
  return characterData.data.filter(isNewCharacter).sort((a, b) => a.id - b.id);
}

const GAME_PROP_ELEMENT = {
  1: { name: "火", element: 0 },
  2: { name: "水", element: 1 },
  3: { name: "风", element: 2 },
  4: { name: "光", element: 3 },
  5: { name: "暗", element: 4 },
  6: { name: "暗", element: 4 },
  7: { name: "暗", element: 4 },
};

async function loadManualCharacters() {
  if (manualCharacters !== null) return manualCharacters;
  try {
    const res = await fetch(`${getSiteBase()}/data/manual_characters.json`);
    if (!res.ok) {
      manualCharacters = [];
      return manualCharacters;
    }
    const raw = await res.json();
    manualCharacters = raw.characters || [];
    manualCharacters.forEach((ch) => {
      characterMap.set(ch.id, ch);
      if (typeof character_map !== "undefined" && ch.ok) {
        character_map.set(ch.id, { ...ch, seq: character_map.size });
      }
    });
    return manualCharacters;
  } catch {
    manualCharacters = [];
    return manualCharacters;
  }
}

async function loadMaindataOverlay() {
  if (maindataOverlay !== null) return maindataOverlay;
  try {
    const res = await fetch(`${getSiteBase()}/data/maindata_overlay.json`);
    if (!res.ok) {
      maindataOverlay = { byId: {} };
      return maindataOverlay;
    }
    maindataOverlay = await res.json();
    Object.entries(maindataOverlay.byId || {}).forEach(([id, row]) => {
      maindataMap.set(Number(id), row);
    });
    return maindataOverlay;
  } catch {
    maindataOverlay = { byId: {} };
    return maindataOverlay;
  }
}

async function loadGameCharacterNames() {
  if (gameCharacterNames !== null) return gameCharacterNames;
  try {
    const res = await fetch(`${getSiteBase()}/data/game_character_names.json`);
    if (!res.ok) {
      gameCharacterNames = { byId: {} };
      return gameCharacterNames;
    }
    gameCharacterNames = await res.json();
    Object.entries(gameCharacterNames.byId || {}).forEach(([id, row]) => {
      gameNameMap.set(Number(id), row);
    });
    return gameCharacterNames;
  } catch {
    gameCharacterNames = { byId: {} };
    return gameCharacterNames;
  }
}

async function loadGameDataStatus() {
  if (gameDataStatus !== null) return gameDataStatus;
  try {
    const res = await fetch(`${getSiteBase()}/data/game_data_status.json`);
    gameDataStatus = res.ok ? await res.json() : null;
    return gameDataStatus;
  } catch {
    gameDataStatus = null;
    return gameDataStatus;
  }
}

async function loadStageOverlay() {
  if (stageOverlay !== null) return stageOverlay;
  try {
    const res = await fetch(`${getSiteBase()}/data/stage_overlay.json`);
    if (!res.ok) {
      stageOverlay = { byId: {} };
      return stageOverlay;
    }
    stageOverlay = await res.json();
    Object.entries(stageOverlay.byId || {}).forEach(([id, row]) => {
      stageMap.set(Number(id), row);
    });
    return stageOverlay;
  } catch {
    stageOverlay = { byId: {} };
    return stageOverlay;
  }
}

function getStageInfo(stageId) {
  const n = Number(stageId);
  if (!n) return undefined;
  return stageMap.get(n);
}

/** 关卡敌人档位一行（TStageData battleLevel / battleRare） */
function formatStageBattleLine(stage) {
  if (!stage) return "";
  const parts = [];
  if (stage.battleLevel != null) parts.push(`Lv ${stage.battleLevel}`);
  if (stage.battleRare != null) parts.push(`Rare ${stage.battleRare}`);
  if (stage.battle != null) parts.push(`Battle ${stage.battle}`);
  if (stage.confidence === "heuristic") parts.push("估算");
  return parts.join(" · ");
}

function applyGameCharacterMeta(ch) {
  if (!ch) return ch;
  const gn = gameNameMap.get(Number(ch.id));
  const out = { ...ch };
  if (gn) {
    if (gn.nameSc && (!out.nameSc || out.nameSource === "game_stringdata")) {
      out.nameSc = gn.nameSc;
      out.nameSource = "game_stringdata";
    }
    if (gn.title) out.title = gn.title;
    if (gn.nameEn && !out.nameEn) out.nameEn = gn.nameEn;
    if (gn.nameTc && !out.nameTc) out.nameTc = gn.nameTc;
  }
  const prop = out.gameProperty ?? maindataMap.get(Number(ch.id))?.property;
  if (prop != null && GAME_PROP_ELEMENT[prop]) {
    out.gameProperty = prop;
    if (!out.elementName || out.elementName === String(out.element)) {
      out.elementName = GAME_PROP_ELEMENT[prop].name;
      out.element = GAME_PROP_ELEMENT[prop].element;
    }
  }
  return out;
}

/** 角色面板一行摘要（含 maindata 来源标记） */
function formatCharPanelLine(ch) {
  if (!ch) return "";
  const parts = [];
  if (ch.atk != null) {
    const tag = ch.atkSource === "maindata" ? "游" : "";
    parts.push(`ATK ${formatNumber(ch.atk)}${tag}`);
  }
  if (ch.hp != null) {
    const tag = ch.hpSource === "maindata" ? "游" : "";
    parts.push(`HP ${formatNumber(ch.hp)}${tag}`);
  }
  if (ch.hpBase != null || ch.atkBase != null) {
    const b = [];
    if (ch.hpBase != null) b.push(`hp基${ch.hpBase}`);
    if (ch.atkBase != null) b.push(`atk基${ch.atkBase}`);
    parts.push(`(${b.join(" ")})`);
  }
  return parts.join(" · ");
}

async function loadCharacters() {
  await Promise.all([
    loadMaindataOverlay(),
    loadStageOverlay(),
    loadLocalCharacterImages(),
    loadGameCharacterNames(),
    loadCompNameAliases(),
  ]);
  if (characterData) return characterData;
  const res = await fetch(`${getSiteBase()}/characters_parsed.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("角色数据加载失败");
  characterData = await res.json();
  characterData.data.forEach((ch) => characterMap.set(ch.id, ch));
  newCharIdSet = null;
  _krNickToScMap = null;
  await loadManualCharacters();
  return characterData;
}

function applyMaindataOverlay(ch) {
  if (!ch) return ch;
  const md = maindataMap.get(Number(ch.id));
  if (!md) return ch;
  const out = { ...ch };
  if (md.hp != null) out.hp = md.hp;
  if (md.atk != null) out.atk = md.atk;
  if (md.cd != null) out.cd = md.cd;
  out.maindataStatus = md.parse_status;
  out.hpSource = md.hpSource;
  out.atkSource = md.atkSource;
  if (md.hp_base != null) out.hpBase = md.hp_base;
  if (md.atk_base != null) out.atkBase = md.atk_base;
  if (md.hp_scale != null) out.hpScale = md.hp_scale;
  if (md.property != null) out.gameProperty = md.property;
  if (md.note) out.maindataNote = md.note;
  return out;
}

function getCharacter(id) {
  const n = Number(id);
  const parsed = characterMap.get(n);
  const official =
    typeof character_map !== "undefined" ? character_map.get(n) : undefined;

  let merged;
  if (official && parsed) {
    merged = {
      ...official,
      nameSc: parsed.nameSc,
      nameTc: parsed.nameTc,
      nameEn: parsed.nameEn,
      nameJp: parsed.nameJp,
      elementName: parsed.elementName,
      roleName: parsed.roleName,
      rarityName: parsed.rarityName,
      isLiberation: parsed.isLiberation,
      isEternal: parsed.isEternal,
    };
  } else if (parsed) {
    merged = parsed;
  } else if (official) {
    merged = official;
  } else {
    return undefined;
  }
  return applyGameCharacterMeta(applyMaindataOverlay(merged));
}

async function loadLocalCharacterImages() {
  if (localCharacterImages !== null) return localCharacterImages;
  try {
    const res = await fetch(`${getSiteBase()}/data/character_images.json`);
    if (!res.ok) {
      localCharacterImages = { byId: {} };
      return localCharacterImages;
    }
    localCharacterImages = await res.json();
    return localCharacterImages;
  } catch {
    localCharacterImages = { byId: {} };
    return localCharacterImages;
  }
}

function charImageUrl(id) {
  const n = Number(id);
  const local = localCharacterImages?.byId?.[String(n)]?.path;
  if (local) return `${getSiteBase()}/${local.replace(/^\//, "")}`;
  if (getNewCharIds().has(n)) {
    return `${getSiteBase()}/assets/images/new-characters/cs${n}_0_0.webp`;
  }
  return `${IMG_BASE}/cs${n}_0_0.webp`;
}

function formatNumber(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + " 亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1) + " 万";
  return Math.round(n).toLocaleString();
}

function renderHeader(activePage) {
  const pages = [
    { id: "home", label: "首页", path: "index.html" },
    { id: "smart", label: "智能打桩", path: "smart/index.html", highlight: true },
    { id: "banner", label: "卡池推荐", path: "banner/index.html" },
    { id: "have", label: "持有", path: "have/index.html" },
    { id: "new", label: "新角色", path: "new/index.html", highlight: true },
    { id: "comps", label: "配队", path: "comps/index.html" },
    { id: "boss", label: "Boss配队", path: "boss/index.html" },
    { id: "search", label: "搜索", path: "search/index.html" },
    { id: "team", label: "编队", path: "team/index.html" },
    { id: "calc", label: "打桩", path: "calc/index.html" },
    { id: "login", label: "账号", path: "login/index.html" },
  ];

  const links = pages
    .map((p) => {
      const cls = [
        activePage && p.id === activePage ? "active" : "",
        p.highlight ? "nav-highlight" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<a href="${siteUrl(p.path)}" class="${cls}">${p.label}</a>`;
    })
    .join("");

  document.getElementById("site-header").innerHTML = `
    <div class="header-inner">
      <a href="${siteUrl("index.html")}" class="logo">打桩网</a>
      <button type="button" class="nav-toggle" id="nav-toggle" aria-label="打开菜单">☰</button>
      <nav class="nav-links" id="main-nav">${links}</nav>
      <button type="button" class="btn btn-sm header-search-btn" id="globalSearchBtn" title="全局搜索 (Ctrl+K)">🔍</button>
      <span id="account-badge"></span>
    </div>`;

  document.getElementById("nav-toggle")?.addEventListener("click", () => {
    document.getElementById("main-nav")?.classList.toggle("open");
  });
  document.querySelectorAll("#main-nav a").forEach((a) => {
    a.addEventListener("click", () => document.getElementById("main-nav")?.classList.remove("open"));
  });

  if (typeof renderAccountBadge === "function") renderAccountBadge();
  initGlobalUI();
  loadDataSyncScript();
  loadAuxScripts();
  bindGlobalSearchShortcut();
}

function loadDataSyncScript() {
  if (window.__dazhuangDataSyncInit || document.getElementById("datasync-js")) return;
  const s = document.createElement("script");
  s.id = "datasync-js";
  s.src = `${getSiteBase()}/assets/js/datasync.js`;
  s.onload = () => window.__dazhuangDataSync?.init?.();
  document.head.appendChild(s);
}

function loadAuxScripts() {
  const base = getSiteBase();
  ["userdata.js", "event-alerts.js"].forEach((file) => {
    const src = `${base}/assets/js/${file}`;
    if (!document.querySelector(`script[data-src="${src}"]`)) {
      loadScriptOnce(src)
        .then(() => {
          if (file === "event-alerts.js" && typeof mountSiteEventAlerts === "function") {
            mountSiteEventAlerts().catch(() => {});
          }
        })
        .catch(() => {});
    }
  });
}

function getCharUnavailableReason(ch) {
  if (!ch) return "未知角色";
  if (ch.ok !== false) return "";
  if (ch.manual || ch.source === "manual") return "社区库未收录 · 使用手工/估算面板";
  if (ch.estimateOnly) return "仅估算伤害 · 无完整技能链";
  if (typeof maindataMap !== "undefined" && maindataMap.has(ch.id)) {
    return "maindata 部分覆盖 · 精度有限";
  }
  return "无可用面板或技能数据";
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => false);
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  ta.remove();
  return Promise.resolve(true);
}

function bindGlobalSearchShortcut() {
  document.getElementById("globalSearchBtn")?.addEventListener("click", openGlobalSearch);
  if (window.__globalSearchBound) return;
  window.__globalSearchBound = true;
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      openGlobalSearch();
    }
  });
}

async function openGlobalSearch() {
  initGlobalUI();
  if (!characterData) {
    try {
      await loadCharacters();
    } catch {
      showToast("角色数据未加载", "error");
      return;
    }
  }
  const owned = getOwned();
  const idSet = new Set(owned.map((o) => o.id));
  const wishSet = new Set(typeof getWishlist === "function" ? getWishlist() : []);

  showModal({
    title: "全局搜索",
    body: `<input type="text" id="globalSearchInput" class="search-input" placeholder="角色名 / ID…" style="width:100%;margin-bottom:0.75rem" autofocus>
      <div id="globalSearchResults" class="global-search-results"><p class="empty-hint">输入角色名开始搜索</p></div>`,
    confirmText: "关闭",
    cancelText: "",
    onConfirm: () => {},
  });

  const input = document.getElementById("globalSearchInput");
  const results = document.getElementById("globalSearchResults");
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      results.innerHTML = `<p class="empty-hint">输入角色名开始搜索</p>`;
      return;
    }
    const hits = characterData.data
      .filter((ch) => {
        const n = charDisplayName(ch).toLowerCase();
        return n.includes(q) || String(ch.id).includes(q);
      })
      .slice(0, 20);
    if (!hits.length) {
      results.innerHTML = `<p class="empty-hint">无匹配角色</p>`;
      return;
    }
    results.innerHTML = hits
      .map((ch) => {
        const name = charDisplayName(ch);
        const ownedTag = idSet.has(ch.id)
          ? `<span class="smart-tag">${owned.find((o) => o.id === ch.id)?.bond || 1} 花</span>`
          : `<span class="smart-tag tag-warn">未持有</span>`;
        const reason = getCharUnavailableReason(ch);
        const okTag = ch.ok === false ? `<span class="smart-tag tag-warn" title="${escapeHtml(reason)}">估算</span>` : "";
        const wishTag = wishSet.has(ch.id) ? `<span class="smart-tag">心愿</span>` : "";
        return `<div class="global-search-row">
          <img src="${charImageUrl(ch.id)}" alt="">
          <div class="global-search-main">
            <strong>${escapeHtml(name)}</strong> <span class="stat-muted">#${ch.id}</span>
            ${ownedTag} ${okTag} ${wishTag}
            ${reason ? `<div class="global-search-reason">${escapeHtml(reason)}</div>` : ""}
          </div>
          <div class="global-search-actions">
            <a href="${siteUrl(`have/index.html`)}#${ch.id}" class="btn btn-sm">持有</a>
            <a href="${siteUrl(`search/index.html`)}?must=${ch.id}" class="btn btn-sm">配队</a>
          </div>
        </div>`;
      })
      .join("");
  };
  input.addEventListener("input", render);
  input.focus();
}

/** 顶栏下方账号摘要（have / team / smart / banner 等页复用） */
function refreshUserInfoBar(elId = "userInfo", options = {}) {
  const {
    analyzeBtnIds = [],
    investBtnId = null,
    showAvgBond = false,
    afterRender = null,
  } = options;
  const el = document.getElementById(elId);
  const disableBtns = (on) => {
    analyzeBtnIds.forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.disabled = on;
    });
    const inv = investBtnId ? document.getElementById(investBtnId) : null;
    if (inv) {
      if (on) inv.setAttribute("disabled", "disabled");
      else inv.removeAttribute("disabled");
    }
  };
  if (!el) return;
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const owned = getOwned();
  if (!user) {
    el.innerHTML = `未登录 · <a href="${siteUrl("login/index.html")}" style="color:var(--accent)">请先登录</a>`;
    disableBtns(true);
    afterRender?.();
    return;
  }
  if (!owned.length) {
    el.innerHTML =
      `账号 <strong style="color:var(--accent)">${user}</strong> · ` +
      `尚未添加持有 · <a href="${siteUrl("have/index.html")}" style="color:var(--accent)">去添加</a>`;
    disableBtns(true);
    afterRender?.();
    return;
  }
  const bond5 = owned.filter((o) => o.bond >= 5).length;
  let line =
    `账号 <strong style="color:var(--accent)">${user}</strong> · ` +
    `持有 <strong>${owned.length}</strong> 名 · 满羁绊 <strong>${bond5}</strong>`;
  if (showAvgBond) {
    const avgBond = (owned.reduce((s, o) => s + (o.bond || 1), 0) / owned.length).toFixed(1);
    line += ` · 平均羁绊 <strong>${avgBond}</strong>`;
  }
  el.innerHTML = line;
  disableBtns(false);
  afterRender?.();
}

function renderCharGridLoading(elId, count = 12) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<p class="empty-hint" style="grid-column:1/-1">角色数据加载中…</p>`;
}

/** 标准页面启动：账号 + 角色库 + 可选回调 */
async function bootPage({ activePage, onReady, gridId, userInfoId }) {
  renderHeader(activePage);
  if (typeof initAccounts === "function") {
    await initAccounts();
    if (typeof renderAccountBadge === "function") renderAccountBadge();
  }
  if (userInfoId) refreshUserInfoBar(userInfoId);
  if (gridId) renderCharGridLoading(gridId);
  try {
    await loadCharacters();
    if (typeof migrateUserDataDisplayNames === "function") migrateUserDataDisplayNames();
    if (onReady) await onReady();
  } catch (e) {
    const msg = formatErrorMessage(e);
    showToast(`数据加载失败：${msg}`, "error", 5000);
    if (gridId) {
      const el = document.getElementById(gridId);
      if (el) {
        el.innerHTML = renderEmptyState({
          icon: "⚠️",
          title: "数据加载失败",
          desc: `${msg}。请在本项目目录运行 python server.py 后刷新。`,
          actionLabel: "返回首页",
          actionHref: siteUrl("index.html"),
        });
      }
    }
    throw e;
  }
}

function getRecommendedAction() {
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const owned = getOwned();
  if (!user) {
    return {
      title: "登录账号",
      desc: "首次使用请先登录。演示账号 mumu（木木）已预置持有角色。",
      href: siteUrl("login/index.html"),
      btn: "去登录",
    };
  }
  if (owned.length < 5) {
    return {
      title: "添加持有角色",
      desc: `当前持有 ${owned.length} 名。添加越多，智能推荐越准确。`,
      href: siteUrl("have/index.html"),
      btn: "管理持有",
    };
  }
  return {
    title: "开始智能打桩",
    desc: `已持有 ${owned.length} 名角色，一键找出适合你羁绊的最优配队。`,
    href: siteUrl("smart/index.html"),
    btn: "立即分析",
  };
}

/* ── 全局 UI：Toast / 弹窗 / 页脚 / 回到顶部 ── */

let uiReady = false;

function initGlobalUI() {
  if (uiReady) return;
  uiReady = true;

  if (!document.getElementById("toast-container")) {
    const tc = document.createElement("div");
    tc.id = "toast-container";
    tc.className = "toast-container";
    document.body.appendChild(tc);
  }
  if (!document.getElementById("modal-root")) {
    const mr = document.createElement("div");
    mr.id = "modal-root";
    document.body.appendChild(mr);
  }
  if (!document.getElementById("site-footer")) {
    const ft = document.createElement("footer");
    ft.id = "site-footer";
    ft.className = "site-footer";
    document.body.appendChild(ft);
  }
  if (!document.getElementById("back-top")) {
    const bt = document.createElement("button");
    bt.id = "back-top";
    bt.className = "back-top";
    bt.type = "button";
    bt.title = "回到顶部";
    bt.textContent = "↑";
    bt.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    document.body.appendChild(bt);
    window.addEventListener("scroll", () => {
      bt.classList.toggle("visible", window.scrollY > 400);
    }, { passive: true });
  }
  renderFooter();
}

function showToast(message, type = "info", duration = 2800) {
  initGlobalUI();
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

function showModal({ title, body, confirmText = "确定", cancelText = "取消", onConfirm, onCancel, inputValue = "" }) {
  initGlobalUI();
  const hasInput = inputValue !== null && typeof body === "string" && body.includes("{input}");
  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-box" role="dialog">
        <div class="modal-title">${title}</div>
        <div class="modal-body">${hasInput ? body.replace("{input}", `<textarea class="modal-input" id="modal-input" rows="4" placeholder="粘贴内容…">${inputValue}</textarea>`) : body}</div>
        <div class="modal-actions">
          ${cancelText ? `<button type="button" class="btn btn-sm" id="modal-cancel">${cancelText}</button>` : ""}
          <button type="button" class="btn btn-primary btn-sm" id="modal-confirm">${confirmText}</button>
        </div>
      </div>
    </div>`;
  const root = document.getElementById("modal-root");
  root.innerHTML = html;
  const overlay = document.getElementById("modal-overlay");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { closeModal(); onCancel?.(); } });
  document.getElementById("modal-cancel")?.addEventListener("click", () => { closeModal(); onCancel?.(); });
  document.getElementById("modal-confirm")?.addEventListener("click", () => {
    const val = document.getElementById("modal-input")?.value;
    closeModal();
    onConfirm?.(val);
  });
}

function showConfirm(message, { title = "确认", confirmText = "确定", cancelText = "取消" } = {}) {
  return new Promise((resolve) => {
    showModal({
      title,
      body: message,
      confirmText,
      cancelText,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function showPrompt(title, placeholder = "") {
  return new Promise((resolve) => {
    showModal({
      title,
      body: "{input}",
      confirmText: "确定",
      cancelText: "取消",
      inputValue: placeholder,
      onConfirm: (val) => resolve(val?.trim() || null),
      onCancel: () => resolve(null),
    });
  });
}

async function copyText(text, successMsg = "已复制到剪贴板") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg, "success");
    return true;
  } catch {
    showModal({
      title: "请手动复制",
      body: `<textarea class="modal-input" readonly rows="4" onclick="this.select()">${text.replace(/</g, "&lt;")}</textarea>`,
      confirmText: "关闭",
      cancelText: "",
      onConfirm: () => {},
    });
    return false;
  }
}

function setButtonLoading(btn, loading, loadingText = "处理中…") {
  if (!btn) return;
  if (loading) {
    btn.dataset.prevText = btn.textContent;
    btn.textContent = loadingText;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.prevText || btn.textContent;
    btn.disabled = false;
  }
}

function renderFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  const links = [
    ["smart/index.html", "智能打桩"],
    ["banner/index.html", "卡池推荐"],
    ["have/index.html", "持有"],
    ["comps/index.html", "配队"],
    ["boss/index.html", "Boss配队"],
    ["search/index.html", "搜索"],
    ["team/index.html", "编队"],
    ["calc/index.html", "打桩"],
    ["login/index.html", "账号"],
    ["changelog/index.html", "更新日志"],
  ];
  el.innerHTML = `
    <div class="footer-inner">
      <span>打桩网 · 天下布魔社区工具</span>
      <span class="footer-links">
        ${links.map(([p, l]) => `<a href="${siteUrl(p)}">${l}</a>`).join("")}
      </span>
    </div>`;
}

function renderEmptyState({ icon = "📭", title, desc, actionLabel, actionHref }) {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-desc">${desc}</div>
    ${actionLabel ? `<a href="${actionHref}" class="btn btn-primary btn-sm" style="margin-top:0.75rem">${actionLabel}</a>` : ""}
  </div>`;
}

function renderSkeletonCards(n = 5) {
  return Array.from({ length: n }, () =>
    `<div class="skeleton-card"><div class="skeleton-line w60"></div><div class="skeleton-line w90"></div><div class="skeleton-deck">${Array(5).fill('<div class="skeleton-avatar"></div>').join("")}</div></div>`
  ).join("");
}

function renderCompDetailSkeleton() {
  return `<div class="comp-deck skeleton-deck">${Array(5)
    .fill('<div class="skeleton-avatar" style="width:64px;height:64px;border-radius:10px"></div>')
    .join("")}</div>
    <div style="display:flex;gap:1.5rem;margin-top:1rem;flex-wrap:wrap">
      ${Array(4).fill('<div class="skeleton-line w40" style="height:2.5rem"></div>').join("")}
    </div>`;
}

function renderCharCard(ch, options = {}) {
  const { selected = false, bond = 0, showName = true, showPanel = false, onclick = "" } = options;
  const full = getCharacter(ch.id) || ch;
  const name = charDisplayName(full);
  const bondHtml = bond > 0 ? `<span class="bond-badge">${bond}</span>` : "";
  const clickAttr = onclick ? `onclick="${onclick}"` : "";
  const reason = full.ok === false ? getCharUnavailableReason(full) : "";
  const unavailable = full.ok === false ? `<span class="char-unavail" title="${escapeHtml(reason)}">不可用</span>` : "";
  const titleExtra = reason ? `（${reason}）` : full.ok === false ? "（不可用）" : "";
  const subParts = [];
  if (full.title) subParts.push(full.title);
  if (full.eventTag) subParts.push(full.eventTag);
  const subtitle = subParts.length
    ? `<span class="char-subtitle">${escapeHtml(subParts.join(" · "))}</span>`
    : "";
  const panelLine = showPanel ? formatCharPanelLine(full) : "";
  const panelHtml = panelLine
    ? `<span class="char-panel-line" title="游=游戏 maindata">${escapeHtml(panelLine)}</span>`
    : "";
  const tip = [name, full.title, panelLine, titleExtra].filter(Boolean).join(" · ");
  return `
    <div class="char-card ${selected ? "selected" : ""}${full.ok === false ? " char-unavailable" : ""}" data-id="${full.id}" title="${escapeHtml(tip)}" ${clickAttr}>
      <span class="element-dot element-${full.element}"></span>
      ${bondHtml}
      ${unavailable}
      <img src="${charImageUrl(full.id)}" alt="${name}" loading="lazy"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><rect fill=%22%23252936%22 width=%2280%22 height=%2280%22/><text x=%2240%22 y=%2245%22 text-anchor=%22middle%22 fill=%22%238b92a8%22 font-size=%2212%22>${full.id}</text></svg>'">
      ${showName ? `<span class="char-name">${name}</span>${subtitle}${panelHtml}` : ""}
    </div>`;
}

function renderNewCharCard(ch, options = {}) {
  const { selected = false, bond = 0, onclick = "" } = options;
  const full = getCharacter(ch.id) || ch;
  const name = charDisplayName(full);
  const bondHtml = bond > 0 ? `<span class="bond-badge">${bond}</span>` : "";
  const clickAttr = onclick ? `onclick="${onclick}"` : "";
  const panelLine = formatCharPanelLine(full);
  const badges = [];
  if (full.manual || full.source === "manual") badges.push('<span class="new-char-badge">手工</span>');
  if (full.estimateOnly) badges.push('<span class="new-char-badge warn">估算</span>');
  if (full.eventTag) badges.push(`<span class="new-char-badge event">${escapeHtml(full.eventTag)}</span>`);
  const meta = [full.title, full.confidence, full.note].filter(Boolean).join(" · ");
  const tip = [name, full.title, panelLine, full.eventTag].filter(Boolean).join(" · ");
  return `
    <div class="new-char-card char-card ${selected ? "selected" : ""}" data-id="${full.id}" title="${escapeHtml(tip)}" ${clickAttr}>
      <span class="element-dot element-${full.element}"></span>
      ${bondHtml}
      <img src="${charImageUrl(full.id)}" alt="${name}" loading="lazy"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><rect fill=%22%23252936%22 width=%2280%22 height=%2280%22/><text x=%2240%22 y=%2245%22 text-anchor=%22middle%22 fill=%22%238b92a8%22 font-size=%2212%22>${full.id}</text></svg>'">
      <div class="new-char-body">
        <span class="char-name">${name}</span>
        <span class="new-char-id">#${full.id}</span>
        ${badges.length ? `<div class="new-char-badges">${badges.join("")}</div>` : ""}
        ${meta ? `<p class="new-char-meta">${escapeHtml(meta)}</p>` : ""}
        ${panelLine ? `<p class="char-panel-line">${escapeHtml(panelLine)}</p>` : ""}
      </div>
    </div>`;
}

function getOwned() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_OWNED) || "[]");
  } catch {
    return [];
  }
}

function setOwned(list) {
  if (typeof setOwnedWithAccount === "function") {
    setOwnedWithAccount(list);
  } else {
    localStorage.setItem(STORAGE_OWNED, JSON.stringify(list));
  }
}

function getTeam() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_TEAM) || "[]");
  } catch {
    return [];
  }
}

function setTeam(list) {
  if (typeof setTeamWithAccount === "function") {
    setTeamWithAccount(list);
  } else {
    localStorage.setItem(STORAGE_TEAM, JSON.stringify(list));
  }
}

function encodeOwned(list) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(list))));
}

function decodeOwned(str) {
  return JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
}

const TENKA_B64 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_!";

function b64to10(str) {
  let result = BigInt(0);
  for (const ch of str) {
    const value = TENKA_B64.indexOf(ch);
    if (value < 0) throw new Error("TenkaAssist 代码格式无效");
    result = result * 64n + BigInt(value);
  }
  return result.toString();
}

function b10to64(str) {
  let decimal = BigInt(str);
  if (decimal === 0n) return "0";
  let result = "";
  while (decimal > 0n) {
    result = TENKA_B64[Number(decimal % 64n)] + result;
    decimal /= 64n;
  }
  return result;
}

/** 解析 TenkaAssist「复制代码」格式 */
function decodeTenkaAssistCode(text) {
  const parts = text.trim().split(":");
  if (parts.length !== 2) throw new Error("不是 TenkaAssist 复制码");
  const idTail = b64to10(parts[0]).slice(2);
  const ids = [];
  for (let i = 0; i < idTail.length; i += 3) {
    ids.push(Number(idTail.slice(i, i + 3)) + 10000);
  }
  const bonds = b64to10(parts[1]).split("").map(Number);
  if (!ids.length || ids.length !== bonds.length) {
    throw new Error("TenkaAssist 代码中角色与羁绊数量不一致");
  }
  return ids.map((id, i) => ({ id, bond: bonds[i] || 1 }));
}

/** 生成 TenkaAssist 兼容复制码 */
function encodeTenkaAssistCode(list) {
  if (!list.length) throw new Error("持有列表为空");
  const idPart = "10" + list.map((o) => String(o.id).slice(-3)).join("");
  const bondPart = list.map((o) => String(o.bond || 1)).join("");
  return `${b10to64(idPart)}:${b10to64(bondPart)}`;
}

function parseOwnedImport(text) {
  const raw = text.trim();
  if (!raw) throw new Error("内容为空");
  if (raw.includes(":") && !raw.startsWith("[")) {
    return decodeTenkaAssistCode(raw);
  }
  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.owned;
    if (!Array.isArray(list)) throw new Error("JSON 格式无效");
    return list.map((o) => ({ id: o.id, bond: o.bond || 1 }));
  }
  return decodeOwned(raw);
}

function filterCharacters(
  chars,
  { element, role, rarity, search, okOnly = true, eternalOnly = false, excludeNew = false }
) {
  return chars.filter((ch) => {
    if (excludeNew && isNewCharacter(ch)) return false;
    if (okOnly && !ch.ok) return false;
    if (element != null && ch.element !== element) return false;
    if (role != null && ch.role !== role) return false;
    if (rarity != null && ch.rarity !== rarity) return false;
    if (eternalOnly && !ch.isEternal) return false;
    if (search) {
      const q = search.toLowerCase();
      const aliasHay = (ch.aliases || []).join(" ");
      const hay = [ch.name, ch.nameSc, ch.nameEn, ch.fullname, aliasHay].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function setupFilterChips(containerId, chips, onChange) {
  const container = document.getElementById(containerId);
  container.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const group = chip.dataset.group;
      const value = chip.dataset.value;
      const isActive = chip.classList.contains("active");

      if (group === "toggle") {
        chip.classList.toggle("active");
      } else {
        container.querySelectorAll(`.filter-chip[data-group="${group}"]`).forEach((c) => c.classList.remove("active"));
        if (!isActive) chip.classList.add("active");
      }
      onChange();
    });
  });
}

function getActiveFilter(containerId, group) {
  const el = document.querySelector(`#${containerId} .filter-chip[data-group="${group}"].active`);
  if (!el) return null;
  const v = el.dataset.value;
  return v === "all" ? null : Number(v);
}

function isToggleActive(containerId, group) {
  const el = document.querySelector(`#${containerId} .filter-chip[data-group="${group}"].active`);
  return !!el;
}
