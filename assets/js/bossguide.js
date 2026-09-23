/** Boss 攻略与配队匹配 */

let bossGuidesCache = null;

async function fetchBossGuides() {
  if (bossGuidesCache) return bossGuidesCache;
  bossGuidesCache = await fetchJsonWithTimeout(`${getSiteBase()}/data/boss_guides.json`);
  return bossGuidesCache;
}

function getBossGuide(id) {
  return bossGuidesCache?.bosses?.find((b) => b.id === id) || null;
}

function getAllBosses() {
  return bossGuidesCache?.bosses || [];
}

function getBossCategories() {
  return bossGuidesCache?.categories || [];
}

function normalizeCompstrIds(comp) {
  if (!comp?.compstr) return [];
  return Array.isArray(comp.compstr)
    ? comp.compstr.map(Number).filter(Boolean)
    : String(comp.compstr)
        .split(/\s+/)
        .map(Number)
        .filter(Boolean);
}

function scoreCompForBoss(comp, boss) {
  const match = boss.match || { type: "all" };
  const ids = normalizeCompstrIds(comp);
  if (ids.length !== 5) return -1;

  const featured = match.featuredCompIds || boss.featuredCompIds;
  if (featured?.includes(comp.id)) return 1e15 + (comp.recommend || 0);

  const minOfficial = match.minOfficial ?? boss.minOfficial ?? 5e9;
  const official = comp.recommend || comp.vote || 0;
  if (official < minOfficial && (comp.vote || 0) < minOfficial * 0.4) return -1;

  if (match.minRanking && (comp.ranking || 0) < match.minRanking) return -1;

  if (match.type === "all") {
    return official + (comp.ranking || 0) * 1e8;
  }

  let score = official;

  const core = match.coreCharIds || [];
  if (core.length) {
    const overlap = ids.filter((id) => core.includes(id)).length;
    const minCore = match.minCoreMatch ?? 1;
    if (overlap < minCore) return -1;
    score += overlap * 3e9;
  }

  const ban = match.banCharIds || [];
  if (ban.some((id) => ids.includes(id))) return -1;

  const preferEl = match.preferElements || [];
  if (preferEl.length) {
    const chars = ids.map((id) => getCharacter(id)).filter(Boolean);
    const elCount = chars.filter((ch) => preferEl.includes(ch.element)).length;
    const minEl = match.minElementMatch ?? 1;
    if (elCount < minEl) return -1;
    score += elCount * 1.5e9;
  }

  const preferRole = match.preferRoles || [];
  if (preferRole.length) {
    const chars = ids.map((id) => getCharacter(id)).filter(Boolean);
    const roleCount = chars.filter((ch) => preferRole.includes(ch.role)).length;
    const minRole = match.minRoleMatch ?? 1;
    if (roleCount < minRole) return -1;
    score += roleCount * 8e8;
  }

  const keywords = match.nameKeywords || boss.nameKeywords || [];
  const nameRaw = (comp.name || "").toLowerCase();
  const nameSc =
    typeof compDisplayName === "function" ? compDisplayName(comp).toLowerCase() : nameRaw;
  for (const kw of keywords) {
    const k = String(kw).toLowerCase();
    if (nameRaw.includes(k) || nameSc.includes(k)) score += 2e9;
  }

  if (match.searchMustChar && ids.includes(match.searchMustChar)) score += 1e9;

  return score;
}

function filterCompsForBoss(comps, boss) {
  if (!boss) return [];
  const scored = [];
  for (const comp of comps) {
    const s = scoreCompForBoss(comp, boss);
    if (s >= 0) scored.push({ comp, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.comp);
}

function getBossSortValue(boss) {
  return boss?.sortDefault ?? 1;
}

/** 合并 boss_guides 手工字段与 stage_overlay 游戏关卡数据 */
function getBossStageInfo(boss) {
  if (!boss) return null;
  const manual = {
    stageId: boss.stageId,
    battleLevel: boss.battleLevel,
    battleRare: boss.battleRare,
    battle: boss.battle,
  };
  const fromMap =
    boss.stageId != null && typeof getStageInfo === "function"
      ? getStageInfo(boss.stageId)
      : undefined;
  if (!fromMap && manual.battleLevel == null) return null;
  return {
    ...(fromMap || {}),
    ...Object.fromEntries(Object.entries(manual).filter(([, v]) => v != null)),
    stageId: manual.stageId ?? fromMap?.stageId,
  };
}

function renderBossStageLine(boss) {
  const info = getBossStageInfo(boss);
  if (!info) return "";
  const line = typeof formatStageBattleLine === "function" ? formatStageBattleLine(info) : "";
  if (!line) return "";
  const sid = info.stageId != null ? `关卡 #${info.stageId}` : "参考关卡";
  return `<span class="smart-tag" title="来自游戏 maindata TStageData（启发式）">${escapeHtml(sid)} · ${escapeHtml(line)}</span>`;
}

function renderBossElementTag(element) {
  if (element == null || element < 0) return "";
  const name = ELEMENTS[element] || element;
  return `<span class="smart-tag element-chip-${element}">Boss ${escapeHtml(name)}</span>`;
}

function renderBossWeakTag(weakTo) {
  if (weakTo == null || weakTo < 0) return "";
  const name = ELEMENTS[weakTo] || weakTo;
  return `<span class="smart-tag tag-warn">推荐 ${escapeHtml(name)} 输出</span>`;
}

function renderBossCoreChars(boss) {
  const ids = boss.match?.coreCharIds || boss.coreCharIds || [];
  if (!ids.length) return "";
  return ids
    .map((id) => {
      const ch = getCharacter(id);
      const n = charDisplayName(ch) || id;
      return `<span class="must-chip" title="核心角色"><img src="${charImageUrl(id)}" alt=""><span>${escapeHtml(n)}</span></span>`;
    })
    .join("");
}

function bossSmartUrl(boss) {
  const core = boss.match?.coreCharIds || [];
  const must = core.slice(0, Math.min(3, core.length)).join(",");
  const q = new URLSearchParams();
  if (must) q.set("must", must);
  if (boss.id) q.set("boss", boss.id);
  const qs = q.toString();
  return `${siteUrl("smart/index.html")}${qs ? `?${qs}` : ""}`;
}

function bossCalcUrl(compId, boss) {
  const q = new URLSearchParams({ comp: compId });
  if (boss?.id) q.set("boss", boss.id);
  if (boss?.bossElement >= 0) q.set("bossEl", boss.bossElement);
  return `${siteUrl("calc/index.html")}?${q.toString()}`;
}

if (typeof window !== "undefined") {
  window.fetchBossGuides = fetchBossGuides;
  window.getBossGuide = getBossGuide;
  window.getBossCategories = getBossCategories;
  window.getAllBosses = getAllBosses;
  window.filterCompsForBoss = filterCompsForBoss;
  window.getBossSortValue = getBossSortValue;
  window.renderBossElementTag = renderBossElementTag;
  window.renderBossWeakTag = renderBossWeakTag;
  window.renderBossCoreChars = renderBossCoreChars;
  window.bossSmartUrl = bossSmartUrl;
  window.bossCalcUrl = bossCalcUrl;
  window.getBossStageInfo = getBossStageInfo;
  window.renderBossStageLine = renderBossStageLine;
}
