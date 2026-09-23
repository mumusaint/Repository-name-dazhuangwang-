/** 加载 TenkaAssist 社区配队压缩数据库 */
const COMP_DATA_URLS = [
  "/api/compdata",
  "../api/compdata",
  "/data/compdata.json",
  "../data/compdata.json",
];

let compDatabase = null;
let compIndex = null;
let compDatabasePromise = null;

function inflateCompdataBuffer(buffer) {
  const u8 = new Uint8Array(buffer);
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    return pako.ungzip(u8);
  }
  // 纯 JSON 文本（未压缩，或经 CDN 透明解压后）直接返回
  if (u8.length >= 1 && (u8[0] === 0x7b || u8[0] === 0x5b)) {
    return u8;
  }
  return pako.inflate(u8);
}

function buildCompIndex(database) {
  const byChar = new Map();
  const byId = new Map();
  database.forEach((comp, i) => {
    byId.set(comp.id, comp);
    for (const id of comp.compstr) {
      if (!byChar.has(id)) byChar.set(id, []);
      byChar.get(id).push(i);
    }
  });
  compIndex = { byChar, byId, database };
  return compIndex;
}

function getCompIndex(database) {
  if (compIndex && compIndex.database === database) return compIndex;
  return buildCompIndex(database);
}

function compKey(ids) {
  return [...ids].sort((a, b) => a - b).join("-");
}

function bondMultiplier(bond) {
  return 1 + (bond - 1) * 0.08;
}

/** 快速估算伤害，用于两阶段筛选的第一轮排序（对齐 TenkaAssist make.js） */
function estimateFit13t(comp, bondMap) {
  const ids = comp.compstr;
  const bonds = ids.map((id) => bondMap.get(id) || 1);
  if (bonds.every((b) => b === 5) && comp.recommend > 0) return comp.recommend;
  if (bonds.every((b) => b === 1) && comp.vote > 0) return comp.vote;
  const base = comp.recommend || comp.vote || 0;
  if (!base) return 0;
  const factors = bonds.map(bondMultiplier);
  const ref = Math.pow(bondMultiplier(5), 5);
  const actual = factors.reduce((a, b) => a * b, 1);
  return Math.round(base * (actual / ref));
}

function calcBondStats(ids, bondMap) {
  const bonds = ids.map((id) => bondMap.get(id) || 1);
  const avg = bonds.reduce((a, b) => a + b, 0) / 5;
  const min = Math.min(...bonds);
  const weakIds = ids.filter((id, i) => bonds[i] === min);
  const total = bonds.reduce((a, b) => a + b, 0);
  return { bonds, avg, min, weakIds, total };
}

function getCandidateIndices(mustInclude, index) {
  if (!mustInclude?.length) return null;
  const indexed = mustInclude.filter((id) => index.byChar.get(id)?.length);
  if (!indexed.length) return [];
  let set = null;
  for (const id of indexed) {
    const list = index.byChar.get(id);
    const cur = new Set(list);
    if (set === null) set = cur;
    else set = new Set([...set].filter((i) => cur.has(i)));
  }
  return set ? [...set] : [];
}

function charsMissingFromCompIndex(charIds, index) {
  return charIds.filter((id) => !index.byChar.get(id)?.length);
}

const LOCAL_COMP_CAP = 1200;

function donorOverlapScore(teamIds, donorIds) {
  const set = new Set(teamIds);
  return donorIds.filter((id) => set.has(id)).length;
}

function findBestDonorComp(teamIds, data) {
  let best = null;
  let bestOverlap = 0;
  for (const comp of data) {
    if (!comp.description || comp.description.length < 10) continue;
    const overlap = donorOverlapScore(teamIds, comp.compstr);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = comp;
    }
  }
  return best ? { comp: best, overlap: bestOverlap } : null;
}

function getFallbackDonorComp(data) {
  let best = null;
  let bestScore = 0;
  for (const comp of data) {
    if (!comp.description || comp.description.length < 10) continue;
    const score = comp.recommend || comp.vote || 0;
    if (score > bestScore) {
      bestScore = score;
      best = comp;
    }
  }
  return best;
}

const LOCAL_MIN_DONOR_OVERLAP = 1;

function alignCompstrToDonor(teamIds, donorIds) {
  const teamSet = new Set(teamIds);
  const ordered = [];
  const used = new Set();
  for (const id of donorIds) {
    if (teamSet.has(id) && !used.has(id)) {
      ordered.push(id);
      used.add(id);
    }
  }
  for (const id of teamIds) {
    if (!used.has(id)) ordered.push(id);
  }
  return ordered.slice(0, 5);
}

function pickLeaderFirst(compstr, hpUpMap) {
  if (!compstr.length) return compstr;
  let bestIdx = 0;
  let bestHp = hpUpMap.get(compstr[0]) ?? 0;
  for (let i = 1; i < compstr.length; i++) {
    const hp = hpUpMap.get(compstr[i]) ?? 0;
    if (hp > bestHp) {
      bestHp = hp;
      bestIdx = i;
    }
  }
  if (bestIdx === 0) return compstr;
  const next = [...compstr];
  const [leader] = next.splice(bestIdx, 1);
  next.unshift(leader);
  return next;
}

function makeLocalComp(compstr, donor, opts = {}) {
  const base = donor.recommend || donor.vote || 5e9;
  const overlap = opts.overlap ?? donorOverlapScore(compstr, donor.compstr);
  const names = compstr.map((id) => charDisplayName(getCharacter(id)) || id).join(" · ");
  const scaled = Math.round(base * (Math.max(overlap, 1) / 5));
  return {
    id: opts.id || `local-${compKey(compstr)}`,
    name: `本地配队 · ${names}`,
    compstr,
    description: donor.description,
    recommend: Math.max(scaled, Math.round(base * 0.12)),
    vote: donor.vote || 0,
    isLocal: true,
    localNote: opts.note || "借用相似社区配队出招顺序",
    donorId: donor.id,
  };
}

function getFallbackDonor(data) {
  return getFallbackDonorComp(data);
}

function resolveDonorForTeam(teamIds, data) {
  const hit = findBestDonorComp(teamIds, data);
  if (hit && hit.overlap >= LOCAL_MIN_DONOR_OVERLAP) return hit;
  const fb = getFallbackDonorComp(data);
  return fb ? { comp: fb, overlap: hit?.overlap ?? 0 } : null;
}

/** 社区库尚无记录的角色：替换差 1 人或从持有列表组合 5 人 */
function generateLocalCompsForUnindexedOwned({
  owned,
  mustInclude,
  unindexedOwned,
  idSet,
  hpUpMap,
  data,
  index,
}) {
  const must = mustInclude.filter((id) => idSet.has(id));
  const autoMode = !must.length;
  const unindexedInMust = must.filter((id) => !index.byChar.get(id)?.length);
  const targets = autoMode ? unindexedOwned : unindexedInMust.length ? unindexedInMust : unindexedOwned;
  if (!targets.length) return [];

  const enforceMust = must.length && unindexedInMust.length ? must : null;
  const byKey = new Map();

  function teamValid(team) {
    if (team.length !== 5) return false;
    if (enforceMust && !enforceMust.every((m) => team.includes(m))) return false;
    if (autoMode && !team.some((id) => unindexedOwned.includes(id))) return false;
    return team.every((id) => idSet.has(id));
  }

  function addComp(compstr, donor, note, overlap) {
    let ordered = alignCompstrToDonor(compstr, donor.compstr);
    ordered = pickLeaderFirst(ordered, hpUpMap);
    if (!teamValid(ordered)) return;
    const key = compKey(ordered);
    if (byKey.has(key)) return;
    byKey.set(
      key,
      makeLocalComp(ordered, donor, {
        overlap: overlap ?? donorOverlapScore(ordered, donor.compstr),
        note,
        id: `local-${key}`,
      })
    );
  }

  const replaceIds = autoMode ? unindexedOwned : unindexedInMust.length ? unindexedInMust : targets;

  for (const comp of data) {
    if (byKey.size >= LOCAL_COMP_CAP) break;
    if (!comp.description || comp.description.length < 10) continue;
    const ids = comp.compstr;
    const missing = ids.filter((id) => !idSet.has(id));
    if (missing.length !== 1) continue;
    const slot = missing[0];
    for (const newId of replaceIds) {
      const team = ids.map((id) => (id === slot ? newId : id));
      if (!teamValid(team)) continue;
      addComp(team, comp, `替换 ${slot} → ${newId}`);
    }
  }

  const ownedIds = owned
    .map((o) => o.id)
    .filter((id) => idSet.has(id) && getCharacter(id)?.ok !== false);
  const fallbackDonor = getFallbackDonor(data);

  function dfs(start, chosen, pool) {
    if (byKey.size >= LOCAL_COMP_CAP) return;
    if (chosen.length === 5) {
      const donorHit = resolveDonorForTeam(chosen, data);
      if (!donorHit) return;
      addComp(
        chosen,
        donorHit.comp,
        donorHit.overlap >= 1 ? "持有角色组合" : "持有角色组合（通用出招）",
        donorHit.overlap
      );
      return;
    }
    const left = 5 - chosen.length;
    for (let i = start; i <= pool.length - left; i++) {
      dfs(i + 1, [...chosen, pool[i]], pool);
    }
  }

  if (byKey.size < LOCAL_COMP_CAP) {
    if (enforceMust && enforceMust.length <= 5) {
      const pool = ownedIds
        .filter((id) => !enforceMust.includes(id))
        .sort((a, b) => (hpUpMap.get(b) ?? 0) - (hpUpMap.get(a) ?? 0));
      dfs(0, [...enforceMust], pool);
    } else if (autoMode || (!enforceMust && unindexedOwned.length)) {
      const seeds = autoMode
        ? unindexedOwned
        : unindexedOwned.filter((id) => !must.includes(id));
      for (const seedId of seeds) {
        if (byKey.size >= LOCAL_COMP_CAP) break;
        const pool = ownedIds
          .filter((id) => id !== seedId)
          .sort((a, b) => (hpUpMap.get(b) ?? 0) - (hpUpMap.get(a) ?? 0));
        if (pool.length < 4) continue;
        dfs(0, [seedId], pool);
      }
    }
  }

  if (byKey.size === 0 && fallbackDonor) {
    const tryBuild = (seedIds) => {
      const need = 5 - seedIds.length;
      const pool = ownedIds
        .filter((id) => !seedIds.includes(id))
        .sort((a, b) => (hpUpMap.get(b) ?? 0) - (hpUpMap.get(a) ?? 0))
        .slice(0, need);
      if (pool.length < need) return;
      const team = pickLeaderFirst([...seedIds, ...pool], hpUpMap);
      if (!teamValid(team)) return;
      addComp(team, fallbackDonor, "最小可行组合（通用出招）", 0);
    };
    if (enforceMust?.length) tryBuild(enforceMust.slice(0, 5));
    else if (autoMode) {
      for (const seedId of unindexedOwned) tryBuild([seedId]);
    }
  }

  return [...byKey.values()];
}

function passesFilters(comp, { idSet, hpUpMap, mustInclude, hpUpMin }) {
  const ids = comp.compstr;
  if (!teamFullyOwned(ids, idSet)) return false;
  if (mustInclude?.length && !mustInclude.every((id) => idSet.has(id) && ids.includes(id))) {
    return false;
  }
  const leaderHp = hpUpMap.get(ids[0]) ?? 0;
  if (leaderHp < hpUpMin) return false;
  if (!comp.description || comp.description.length < 10) return false;
  return true;
}

function dedupeByComposition(list) {
  const best = new Map();
  for (const item of list) {
    const key = compKey(item.compstr);
    const prev = best.get(key);
    if (!prev || item.fit13t > prev.fit13t) best.set(key, item);
  }
  return [...best.values()];
}

function batchTotalDmg(batch) {
  return (batch || []).reduce((s, c) => s + (c.fit13t || 0), 0);
}

/** 单次回溯/束搜索最多评估的四队组合数 */
const SMART_BATCH_COMBO_BUDGET = 25000;
/** 束宽（每槽保留的候选数） */
const SMART_BATCH_BEAM_WIDTH = 12;
/** 第一队种子数 */
const SMART_BATCH_MAX_SEEDS = 25;

class DisjointBatchMaxHeap {
  constructor() {
    this.heap = [];
  }
  parent(i) {
    return Math.floor((i - 1) / 2);
  }
  leftChild(i) {
    return 2 * i + 1;
  }
  rightChild(i) {
    return 2 * i + 2;
  }
  batchSum(batch) {
    return batch.reduce((s, c) => s + (c.fit13t || 0), 0);
  }
  push(batch) {
    this.heap.push(batch);
    let i = this.heap.length - 1;
    while (i > 0 && this.batchSum(this.heap[this.parent(i)]) < this.batchSum(this.heap[i])) {
      [this.heap[this.parent(i)], this.heap[i]] = [this.heap[i], this.heap[this.parent(i)]];
      i = this.parent(i);
    }
  }
  pop() {
    if (!this.heap.length) return null;
    if (this.heap.length === 1) return this.heap.pop();
    const top = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.heapify(0);
    return top;
  }
  heapify(i) {
    const left = this.leftChild(i);
    const right = this.rightChild(i);
    let largest = i;
    if (left < this.heap.length && this.batchSum(this.heap[left]) > this.batchSum(this.heap[largest])) {
      largest = left;
    }
    if (right < this.heap.length && this.batchSum(this.heap[right]) > this.batchSum(this.heap[largest])) {
      largest = right;
    }
    if (largest !== i) {
      [this.heap[i], this.heap[largest]] = [this.heap[largest], this.heap[i]];
      this.heapify(largest);
    }
  }
  size() {
    return this.heap.length;
  }
}

function filterDisjointFromPool(pool, usedChars) {
  return pool.filter((c) => !c.compstr.some((id) => usedChars.has(id)));
}

/** 束搜索：在全量 pool 上找总伤最高的 N 套无重复组合（TenkaAssist 单队可排 500+ 名） */
function buildBeamDisjointBatches(pool, batchSize, maxPages = 200) {
  const size = Math.max(1, Math.min(4, batchSize || 1));
  const sorted = [...pool].sort((a, b) => (b.fit13t || 0) - (a.fit13t || 0));
  if (size === 1) {
    return sorted.slice(0, maxPages).map((c) => [c]);
  }

  const heap = new DisjointBatchMaxHeap();
  const beam = SMART_BATCH_BEAM_WIDTH;
  const seeds = sorted.slice(0, Math.min(sorted.length, SMART_BATCH_MAX_SEEDS));
  let evaluated = 0;

  function tryPush(batch) {
    if (batch.length !== size) return;
    heap.push(batch);
    evaluated++;
  }

  if (size === 2) {
    for (const s1 of seeds) {
      if (evaluated >= SMART_BATCH_COMBO_BUDGET) break;
      const used1 = new Set(s1.compstr);
      for (const s2 of filterDisjointFromPool(sorted, used1).slice(0, beam)) {
        tryPush([s1, s2]);
        if (evaluated >= SMART_BATCH_COMBO_BUDGET) break;
      }
    }
  } else if (size === 3) {
    for (const s1 of seeds) {
      if (evaluated >= SMART_BATCH_COMBO_BUDGET) break;
      const used1 = new Set(s1.compstr);
      for (const s2 of filterDisjointFromPool(sorted, used1).slice(0, beam)) {
        const used2 = new Set([...used1, ...s2.compstr]);
        for (const s3 of filterDisjointFromPool(sorted, used2).slice(0, beam)) {
          tryPush([s1, s2, s3]);
          if (evaluated >= SMART_BATCH_COMBO_BUDGET) break;
        }
      }
    }
  } else {
    for (const s1 of seeds) {
      if (evaluated >= SMART_BATCH_COMBO_BUDGET) break;
      const used1 = new Set(s1.compstr);
      for (const s2 of filterDisjointFromPool(sorted, used1).slice(0, beam)) {
        const used2 = new Set([...used1, ...s2.compstr]);
        for (const s3 of filterDisjointFromPool(sorted, used2).slice(0, beam)) {
          const used3 = new Set([...used2, ...s3.compstr]);
          for (const s4 of filterDisjointFromPool(sorted, used3).slice(0, beam)) {
            tryPush([s1, s2, s3, s4]);
            if (evaluated >= SMART_BATCH_COMBO_BUDGET) break;
          }
        }
      }
    }
  }

  const batches = [];
  while (heap.size() > 0 && batches.length < maxPages) {
    const batch = heap.pop();
    batch.sort((a, b) => (b.fit13t || 0) - (a.fit13t || 0));
    batches.push(batch);
  }
  return batches;
}

/** 回溯补充（在全量 pool 上，非 Top-N 截断） */
function buildOptimalDisjointBatches(pool, batchSize, maxPages = 200) {
  const size = Math.max(1, Math.min(4, batchSize || 1));
  const sorted = [...pool].sort((a, b) => (b.fit13t || 0) - (a.fit13t || 0));
  const searchPool = sorted;

  if (size === 1) {
    return sorted.slice(0, maxPages).map((c) => [c]);
  }

  const heap = new DisjointBatchMaxHeap();
  let comboBudget = SMART_BATCH_COMBO_BUDGET;

  function backtrack(startIndex, selected, usedChars) {
    if (comboBudget <= 0) return;
    if (selected.length === size) {
      heap.push([...selected]);
      comboBudget--;
      return;
    }
    for (let i = startIndex; i < searchPool.length; i++) {
      if (comboBudget <= 0) return;
      const comp = searchPool[i];
      if (comp.compstr.some((id) => usedChars.has(id))) continue;
      comp.compstr.forEach((id) => usedChars.add(id));
      selected.push(comp);
      backtrack(i + 1, selected, usedChars);
      selected.pop();
      comp.compstr.forEach((id) => usedChars.delete(id));
    }
  }

  function seedCycle(seedIdx) {
    if (seedIdx < 0 || seedIdx >= searchPool.length || comboBudget <= 0) return;
    const comp = searchPool[seedIdx];
    const used = new Set(comp.compstr);
    const selected = [comp];
    backtrack(seedIdx + 1, selected, used);
  }

  const seedLimit = Math.min(searchPool.length, SMART_BATCH_MAX_SEEDS);
  for (let i = 0; i < seedLimit; i++) {
    seedCycle(i);
    const j = searchPool.length - 1 - i;
    if (j > i && j < searchPool.length) seedCycle(j);
  }

  const batches = [];
  while (heap.size() > 0 && batches.length < maxPages) {
    const batch = heap.pop();
    batch.sort((a, b) => (b.fit13t || 0) - (a.fit13t || 0));
    batches.push(batch);
  }
  return batches;
}

/** 合并束搜索与回溯，取总伤更高的方案 */
function buildBestDisjointBatches(pool, batchSize, maxPages = 200) {
  const beam = buildBeamDisjointBatches(pool, batchSize, maxPages);
  const bt = buildOptimalDisjointBatches(pool, batchSize, maxPages);
  const merged = new DisjointBatchMaxHeap();
  for (const b of [...beam, ...bt]) merged.push(b);
  const out = [];
  while (merged.size() > 0 && out.length < maxPages) {
    const batch = merged.pop();
    batch.sort((a, b) => (b.fit13t || 0) - (a.fit13t || 0));
    out.push(batch);
  }
  return out;
}

let smartBatchCacheKey = "";
let smartBatchCache = null;

function getSmartDisjointBatches(results, batchSize, extendedPool, batchSort) {
  const pool =
    extendedPool?.length > (results?.length || 0) ? extendedPool : results || [];
  const key = `${batchSort}|${batchSize}|${pool.length}|${pool[0]?.id ?? 0}|${pool[pool.length - 1]?.id ?? 0}`;
  if (smartBatchCacheKey === key && smartBatchCache) return smartBatchCache;
  smartBatchCacheKey = key;
  smartBatchCache = buildDisjointTeamBatches(results, batchSize, extendedPool, batchSort);
  return smartBatchCache;
}

function invalidateSmartBatchCache() {
  smartBatchCacheKey = "";
  smartBatchCache = null;
}

/** 贪心分页：按列表顺序依次取无重复组合 */
function buildDisjointTeamBatchesGreedy(pool, batchSize, byTotal = false) {
  const size = Math.max(1, Math.min(4, batchSize || 1));
  let remaining = [...pool];
  const batches = [];

  while (remaining.length > 0) {
    const batch = [];
    const usedChars = new Set();

    for (let n = 0; n < size; n++) {
      let pickIdx = -1;
      if (byTotal) {
        let bestDmg = -1;
        for (let i = 0; i < remaining.length; i++) {
          const comp = remaining[i];
          if (comp.compstr.some((id) => usedChars.has(id))) continue;
          const dmg = comp.fit13t || 0;
          if (dmg > bestDmg) {
            bestDmg = dmg;
            pickIdx = i;
          }
        }
      } else {
        pickIdx = remaining.findIndex((c) => !c.compstr.some((id) => usedChars.has(id)));
      }
      if (pickIdx === -1) break;
      const comp = remaining.splice(pickIdx, 1)[0];
      batch.push(comp);
      comp.compstr.forEach((id) => usedChars.add(id));
    }

    if (!batch.length) {
      batch.push(remaining.shift());
    } else if (byTotal) {
      batch.sort((a, b) => (b.fit13t || 0) - (a.fit13t || 0));
    }
    batches.push(batch);
  }

  if (byTotal) {
    batches.sort((a, b) => batchTotalDmg(b) - batchTotalDmg(a));
  }
  return batches;
}

/** 将推荐结果分成多页，每页最多 batchSize 套且角色互不重复
 * batchSort: rank=按推荐名次 | batchTotal=按组合总伤（TenkaAssist 回溯最优）
 */
function buildDisjointTeamBatches(results, batchSize, extendedPool, batchSort = "batchTotal") {
  const size = Math.max(1, Math.min(4, batchSize || 1));
  const pool =
    extendedPool?.length > (results?.length || 0) ? extendedPool : results || [];
  const byTotal = batchSort === "batchTotal";

  if (byTotal && size > 1 && pool.length > 1) {
    const optimal = buildBestDisjointBatches(pool, size);
    if (optimal.length) return optimal;
  }
  return buildDisjointTeamBatchesGreedy(pool, size, byTotal);
}

function findSmartCompById(id) {
  const num = Number(id);
  const inResults = (window.smartResults || []).find((c) => c.id === num);
  if (inResults) return inResults;
  return (window.smartResultsPool || []).find((c) => c.id === num);
}

function pullItemCharSet(item) {
  return new Set(item.bestComp?.compstr || [item.missId]);
}

function batchTotalPullDmg(batch) {
  return (batch || []).reduce((s, item) => s + (item.preciseDmg || 0), 0);
}

/** 优先抽取：凑齐最多 4 套代表配队，角色（含待抽目标）互不重复 */
function buildDisjointPullBatches(results, batchSize = 4, extendedPool) {
  const size = Math.max(1, Math.min(4, batchSize || 4));
  const pool =
    extendedPool?.length > (results?.length || 0) ? extendedPool : results || [];
  let remaining = [...pool].filter((item) => item.bestComp);
  const batches = [];

  while (remaining.length > 0) {
    const batch = [];
    const usedChars = new Set();

    for (let n = 0; n < size; n++) {
      let bestIdx = -1;
      let bestDmg = -1;
      for (let i = 0; i < remaining.length; i++) {
        const item = remaining[i];
        if ([...pullItemCharSet(item)].some((id) => usedChars.has(id))) continue;
        const dmg = item.preciseDmg || 0;
        if (dmg > bestDmg) {
          bestDmg = dmg;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;
      const picked = remaining.splice(bestIdx, 1)[0];
      batch.push(picked);
      pullItemCharSet(picked).forEach((id) => usedChars.add(id));
    }

    if (!batch.length) {
      batch.push(remaining.shift());
    } else {
      batch.sort((a, b) => (b.preciseDmg || 0) - (a.preciseDmg || 0));
    }
    batches.push(batch);
  }

  batches.sort((a, b) => batchTotalPullDmg(b) - batchTotalPullDmg(a));
  return batches;
}

function pullResultRank(results, item, extendedPool) {
  const primary = results.findIndex((r) => r.missId === item.missId);
  if (primary >= 0) return primary + 1;
  const pool = extendedPool || results;
  const idx = pool.findIndex((r) => r.missId === item.missId);
  return idx >= 0 ? idx + 1 : 0;
}

function pullItemBonds(item) {
  const { bondMap } = buildOwnedMaps(getOwned());
  const comp = item.bestComp;
  if (!comp) return [];
  return comp.compstr.map((id) =>
    id === item.missId ? item.assumeBond || 1 : bondMap.get(id) || 1
  );
}

function getSmartBatchCharIds(results, page, parallelCount, extendedPool, batchSort = "batchTotal") {
  const batches = getSmartDisjointBatches(results, parallelCount, extendedPool, batchSort);
  const batch = batches[Math.min(Math.max(1, page), batches.length) - 1] || [];
  const ids = new Set();
  batch.forEach((c) => c.compstr.forEach((id) => ids.add(id)));
  return ids;
}

function smartResultRank(results, comp, extendedPool) {
  const primary = results.findIndex((c) => c.id === comp.id);
  if (primary >= 0) return primary + 1;
  const pool = extendedPool || results;
  const idx = pool.findIndex((c) => c.id === comp.id);
  return idx >= 0 ? idx + 1 : 0;
}

function sortSmartResults(list, sortBy) {
  const sorted = [...list];
  switch (sortBy) {
    case "efficiency":
      sorted.sort((a, b) => b.efficiency - a.efficiency || b.fit13t - a.fit13t);
      break;
    case "scarecrow":
      sorted.sort(
        (a, b) =>
          (a.ranking || 99) - (b.ranking || 99) ||
          b.fit13t - a.fit13t
      );
      break;
    case "bond":
      sorted.sort((a, b) => b.bondTotal - a.bondTotal || b.fit13t - a.fit13t);
      break;
    default:
      sorted.sort((a, b) => b.fit13t - a.fit13t);
  }
  return sorted;
}

function enrichCompResult(comp, bondMap, calcOptions) {
  const resolved = resolveFit13t(comp, bondMap, calcOptions);
  const fit13t = resolved.fit13t;
  const stats = calcBondStats(comp.compstr, bondMap);
  const official = comp.recommend || 0;
  return {
    ...comp,
    fit13t,
    fit13tSource: resolved.fit13tSource,
    calcNote: resolved.calcNote,
    bonds: stats.bonds,
    bondAvg: stats.avg,
    bondMin: stats.min,
    bondTotal: stats.total,
    weakIds: stats.weakIds,
    efficiency: fit13t / Math.max(stats.avg, 1),
    gapToOfficial: official > 0 ? official - fit13t : 0,
    compstrStr: comp.compstr.join(" "),
  };
}

/** 按当前 bonds 数组精确重算单套推荐配队 */
function recalcSmartCompBonds(comp) {
  if (!comp?.compstr?.length) return comp;
  const bondMap = new Map(comp.compstr.map((id, i) => [id, comp.bonds[i] || 1]));
  Object.assign(comp, enrichCompResult(comp, bondMap));
  const maxMap = new Map(bondMap);
  comp.compstr.forEach((id) => maxMap.set(id, 5));
  const maxResolved = resolveFit13t(comp, maxMap);
  comp.maxBondFit13t = maxResolved.fit13t;
  comp.bondUpgradeHints = smartBondUpgradeHints(comp, bondMap);
  return comp;
}

async function fetchCompDatabase(onProgress) {
  if (compDatabase) return compDatabase;
  if (compDatabasePromise) return compDatabasePromise;

  compDatabasePromise = (async () => {
  let lastErr = null;
  for (const url of COMP_DATA_URLS) {
    try {
      onProgress?.("正在下载配队数据库…");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onProgress?.("正在解压数据…");
      const buffer = await res.arrayBuffer();
      const inflated = inflateCompdataBuffer(buffer);
      const json = JSON.parse(new TextDecoder().decode(inflated));
      compDatabase = json
        .filter((c) => !(c.recommend < 5e9 && c.vote < 2e9))
        .map((c) => ({
          ...c,
          compstr: c.compstr.split(" ").map(Number),
        }));
      buildCompIndex(compDatabase);
      onProgress?.(`已加载 ${compDatabase.length.toLocaleString()} 套配队`);
      return compDatabase;
    } catch (e) {
      lastErr = e;
      console.warn("配队库加载失败", url, e);
    }
  }
  compDatabasePromise = null;
  throw lastErr || new Error("配队数据库加载失败");
  })();

  return compDatabasePromise;
}

function invalidateCompDatabase() {
  compDatabase = null;
  compIndex = null;
  compDatabasePromise = null;
}

function buildOwnedMaps(owned) {
  const idSet = new Set();
  const bondMap = new Map();
  const hpUpMap = new Map();
  for (const o of owned) {
    idSet.add(o.id);
    bondMap.set(o.id, o.bond || 1);
    const ch = getCharacter(o.id);
    hpUpMap.set(o.id, ch?.hpUp || 0);
  }
  return { idSet, bondMap, hpUpMap };
}

function teamFullyOwned(compIds, idSet) {
  return compIds.every((id) => idSet.has(id));
}

function calcFit13t(comp, bondMap, calcOptions) {
  return resolveFit13t(comp, bondMap, calcOptions).fit13t;
}

/** 精确重算；对齐 TenkaAssist：全 5 花用 recommend、全 1 花用 vote */
function resolveFit13t(comp, bondMap, calcOptions) {
  const ids = comp.compstr;
  const bonds = ids.map((id) => bondMap.get(id) || 1);
  const desc = comp.description;
  const estimated = estimateFit13t(comp, bondMap);

  if (bonds.every((b) => b === 5) && comp.recommend > 0) {
    return { fit13t: comp.recommend, fit13tSource: "official" };
  }
  if (bonds.every((b) => b === 1) && comp.vote > 0) {
    return { fit13t: comp.vote, fit13tSource: "official" };
  }

  if (!desc || desc.length < 10) {
    return {
      fit13t: estimated,
      fit13tSource: estimated > 0 ? "estimate" : "none",
      calcNote: estimated > 0 ? "无出招序列，按官方参考估算" : null,
    };
  }

  if (typeof CalcEngine !== "undefined" && CalcEngine.isEngineReady()) {
    const result = CalcEngine.runPreciseCalc(ids, desc, bonds, calcOptions);
    if (result.valid && result.dmg13 > 0) {
      return { fit13t: result.dmg13, fit13tSource: "precise" };
    }
    if (estimated > 0) {
      return {
        fit13t: estimated,
        fit13tSource: "estimate",
        calcNote: result.error || "计算器尚未收录部分角色技能",
      };
    }
    return { fit13t: 0, fit13tSource: "none", calcNote: result.error };
  }

  return {
    fit13t: estimated,
    fit13tSource: estimated > 0 ? "estimate" : "none",
  };
}

function formatFit13tYi(comp) {
  const yi = ((comp.fit13t || 0) / 1e8).toFixed(2);
  return comp.fit13tSource === "estimate" ? `≈${yi}` : yi;
}

/** 为推荐结果补充全 5 羁绊潜力与升羁绊提示（精确重算） */
function enrichSmartCompExtras(comp, bondMap) {
  if (!comp?.compstr || typeof CalcEngine === "undefined" || !CalcEngine.isEngineReady()) {
    return comp;
  }
  const maxMap = new Map(bondMap);
  for (const id of comp.compstr) maxMap.set(id, 5);
  comp.maxBondFit13t = calcFit13t(comp, maxMap);
  comp.bondUpgradeHints = smartBondUpgradeHints(comp, bondMap);
  return comp;
}

function buildTempBondMap(bondMap, compIds, pullIds, pullBond) {
  const temp = new Map(bondMap);
  for (const id of compIds) {
    if (!temp.has(id)) temp.set(id, pullBond);
  }
  for (const id of pullIds || []) temp.set(id, pullBond);
  return temp;
}

/** 紧凑多队对比：从达标配队中搜索无重复组合的上限 */
const SMART_DISJOINT_POOL_CAP = {
  standard: 1000,
  high: 1500,
  max: Infinity,
};

/**
 * 智能筛选：两阶段分析（快速估算 → 精确重算），支持必带角色、去重、多种排序
 */
async function smartRecommend(owned, options, onProgress) {
  const {
    hpUpMin = 0,
    fit13tMin = 2e9,
    topN = 50,
    mustInclude = [],
    sortBy = "damage",
    dedupe = true,
    precisePool = 1000,
    precision = "standard",
    autoRelax = true,
  } = options;

  if (typeof CalcEngine !== "undefined") {
    await CalcEngine.waitUntilReady();
  }

  const data = await fetchCompDatabase(onProgress);
  const index = getCompIndex(data);
  const { idSet, bondMap, hpUpMap } = buildOwnedMaps(owned);

  const unindexedMust = mustInclude.length
    ? charsMissingFromCompIndex(mustInclude, index)
    : [];
  const unindexedOwned = [...idSet].filter((id) => !index.byChar.get(id)?.length);
  const candidateIndices = getCandidateIndices(mustInclude, index);
  let scanList =
    candidateIndices === null
      ? data
      : candidateIndices.map((i) => data[i]);

  let localComps = [];
  const needLocalGen = unindexedMust.length > 0 || unindexedOwned.length > 0;
  if (needLocalGen) {
    const labelIds = unindexedMust.length ? unindexedMust : unindexedOwned;
    const names = labelIds
      .map((id) => charDisplayName(getCharacter(id)) || id)
      .join("、");
    onProgress?.(`新角色 ${names} 暂无社区配队，生成本地候选组合…`, 0.03);
    localComps = generateLocalCompsForUnindexedOwned({
      owned,
      mustInclude,
      unindexedOwned,
      idSet,
      hpUpMap,
      data,
      index,
    });
    if (mustInclude.length && candidateIndices.length === 0 && unindexedMust.length) {
      scanList = localComps;
    } else {
      scanList = [...localComps, ...scanList];
    }
  }

  onProgress?.(`快速筛选 ${scanList.length.toLocaleString()} 套候选配队…`, 0.05);

  const roughMatches = [];
  let processed = 0;
  const total = scanList.length;

  for (const comp of scanList) {
    processed++;
    if (!passesFilters(comp, { idSet, hpUpMap, mustInclude, hpUpMin })) continue;
    let estimate = estimateFit13t(comp, bondMap);
    if (comp.isLocal) {
      estimate = Math.max(estimate, comp.recommend || 0, 2e9);
    }
    roughMatches.push({ comp, estimate });
    if (processed % 2000 === 0) {
      onProgress?.(
        `快速筛选 ${((processed / total) * 100).toFixed(0)}% · 候选 ${roughMatches.length} 套`,
        0.05 + (processed / total) * 0.35
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  roughMatches.sort((a, b) => b.estimate - a.estimate);

  const poolSizeLimit =
    precision === "max" ? 5000 : precision === "high" ? 2800 : precisePool;

  let pool;
  if (precision === "high" || precision === "max") {
    const minEstimate = fit13tMin > 0 ? fit13tMin * 0.75 : 0;
    const idxSet = new Set();
    roughMatches.forEach((m, i) => {
      if (i < poolSizeLimit) idxSet.add(i);
      else if (minEstimate > 0 && m.estimate >= minEstimate) idxSet.add(i);
    });
    pool = [...idxSet]
      .sort((a, b) => a - b)
      .map((i) => roughMatches[i]);
    onProgress?.(
      `精确重算 ${pool.length.toLocaleString()} 套（Top ${poolSizeLimit} + 达标估算）…`,
      0.42
    );
  } else {
    pool = roughMatches.slice(0, Math.min(poolSizeLimit, roughMatches.length));
    onProgress?.(`精确重算前 ${pool.length} 套配队…`, 0.45);
  }

  const results = [];
  const PRECISE_BATCH = precision === "standard" ? 40 : 12;
  const PRECISE_YIELD_MS = precision === "standard" ? 0 : 12;
  for (let i = 0; i < pool.length; i++) {
    const { comp } = pool[i];
    const enriched = enrichCompResult(comp, bondMap);
    if (enriched.fit13t < fit13tMin) continue;
    results.push(enriched);
    if (i % PRECISE_BATCH === 0) {
      onProgress?.(
        `精确重算 ${((i / pool.length) * 100).toFixed(0)}% · 达标 ${results.length} 套`,
        0.45 + (i / pool.length) * 0.48
      );
      if (PRECISE_YIELD_MS > 0) {
        await new Promise((r) => setTimeout(r, PRECISE_YIELD_MS));
      } else {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  let final = dedupe ? dedupeByComposition(results) : results;
  final = sortSmartResults(final, sortBy);

  const hintCount = precision === "standard" ? 10 : Math.min(20, topN, final.length);
  if (hintCount > 0) {
    onProgress?.(`评估升羁绊提示 Top ${hintCount}…`, 0.94);
    for (const item of final.slice(0, hintCount)) {
      enrichSmartCompExtras(item, bondMap);
      await new Promise((r) => setTimeout(r, PRECISE_YIELD_MS || 0));
    }
  }

  let relaxed = false;
  if (final.length === 0 && autoRelax && fit13tMin > 0) {
    onProgress?.("未找到结果，正在放宽伤害下限…", 0.92);
    return smartRecommend(
      owned,
      { ...options, fit13tMin: 0, autoRelax: false },
      onProgress
    ).then((r) => ({ ...r, relaxed: true }));
  }

  if (final.length === 0 && localComps.length > 0) {
    onProgress?.("精确伤害未达标，展示本地组合参考…", 0.94);
    const fallbackResults = [];
    for (const comp of localComps) {
      if (!passesFilters(comp, { idSet, hpUpMap, mustInclude, hpUpMin: 0 })) continue;
      fallbackResults.push(enrichCompResult(comp, bondMap));
    }
    if (fallbackResults.length) {
      final = dedupe ? dedupeByComposition(fallbackResults) : fallbackResults;
      final = sortSmartResults(final, sortBy);
      relaxed = true;
    }
  }

  const fullyOwnedCount = scanList.filter((c) =>
    passesFilters(c, { idSet, hpUpMap, mustInclude, hpUpMin: 0 })
  ).length;

  const poolCap = SMART_DISJOINT_POOL_CAP[precision] ?? SMART_DISJOINT_POOL_CAP.high;
  const disjointPool =
    poolCap === Infinity ? final : final.slice(0, Math.min(final.length, poolCap));

  return {
    results: final.slice(0, topN),
    pool: disjointPool,
    meta: {
      scanned: total,
      roughMatches: roughMatches.length,
      precisePool: pool.length,
      qualifiedCount: final.length,
      disjointPoolCount: disjointPool.length,
      precision,
      fullyOwnedCount,
      relaxed,
      localCompCount: localComps.length,
      unindexedMust,
      unindexedOwned,
    },
  };
}

/** 差 1 人即可组成的配队（帮助判断该抽/换谁） */
async function smartNearMiss(owned, options, onProgress) {
  const { topN = 15, mustInclude = [], hpUpMin = 0 } = options;
  const data = await fetchCompDatabase(onProgress);
  const { idSet, bondMap, hpUpMap } = buildOwnedMaps(owned);
  const missingMap = new Map();

  let processed = 0;
  for (const comp of data) {
    processed++;
    const ids = comp.compstr;
    const missing = ids.filter((id) => !idSet.has(id));
    if (missing.length !== 1) continue;
    if (mustInclude.length && !mustInclude.every((id) => ids.includes(id))) continue;
    const leaderHp = hpUpMap.get(ids[0]) ?? 0;
    if (leaderHp < hpUpMin) continue;
    if (!comp.description || comp.description.length < 10) continue;

    const missId = missing[0];
    const score = comp.recommend || comp.vote || 0;
    const prev = missingMap.get(missId);
    if (!prev || score > prev.bestScore) {
      missingMap.set(missId, {
        missId,
        bestScore: score,
        comp,
        bonds: ids.map((id) => (idSet.has(id) ? bondMap.get(id) || 1 : null)),
      });
    }
    if (processed % 5000 === 0) {
      onProgress?.(`扫描差 1 人配队… ${((processed / data.length) * 100).toFixed(0)}%`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return [...missingMap.values()]
    .sort((a, b) => b.bestScore - a.bestScore)
    .slice(0, topN);
}

/**
 * 抽取建议：统计缺 1 人即可组成的高配队，按解锁价值排序，并对 Top 目标精确重算
 */
async function smartPullSuggest(owned, options, onProgress) {
  const {
    topN = 20,
    precalcTop = 20,
    assumeBond = 1,
    minOfficial = 15e9,
    minTeamCount = 2,
    hpUpMin = 0,
    mustInclude = [],
    poolIds = [],
  } = options;

  const poolSet = poolIds?.length ? new Set(poolIds.map(Number)) : null;

  if (typeof CalcEngine !== "undefined") {
    await CalcEngine.waitUntilReady();
  }

  const data = await fetchCompDatabase(onProgress);
  const { idSet, bondMap, hpUpMap } = buildOwnedMaps(owned);
  const charStats = new Map();

  onProgress?.("扫描缺员配队…", 0.1);

  for (let i = 0; i < data.length; i++) {
    const comp = data[i];
    const ids = comp.compstr;
    const missing = ids.filter((id) => !idSet.has(id));
    if (missing.length !== 1) continue;
    if (mustInclude.length && !mustInclude.every((id) => ids.includes(id))) continue;
    if (!comp.description || comp.description.length < 10) continue;

    const official = comp.recommend || comp.vote || 0;
    if (official < minOfficial) continue;

    const missId = missing[0];
    if (poolSet && !poolSet.has(missId)) continue;
    const leaderId = ids[0];
    const leaderHp = idSet.has(leaderId)
      ? hpUpMap.get(leaderId) ?? 0
      : getCharacter(leaderId)?.hpUp || 0;
    if (leaderHp < hpUpMin) continue;

    let stat = charStats.get(missId);
    if (!stat) {
      stat = {
        missId,
        teamCount: 0,
        scoreSum: 0,
        bestOfficial: 0,
        bestComp: null,
      };
      charStats.set(missId, stat);
    }
    stat.teamCount++;
    stat.scoreSum += official;
    if (official > stat.bestOfficial) {
      stat.bestOfficial = official;
      stat.bestComp = comp;
    }

    if (i % 8000 === 0) {
      onProgress?.(
        `扫描配队库 ${((i / data.length) * 100).toFixed(0)}% · 候选 ${charStats.size} 名`,
        0.1 + (i / data.length) * 0.5
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (poolSet) {
    for (const id of poolSet) {
      if (idSet.has(id)) continue;
      if (!charStats.has(id)) {
        charStats.set(id, {
          missId: id,
          teamCount: 0,
          scoreSum: 0,
          bestOfficial: 0,
          bestComp: null,
        });
      }
    }
  }

  const minTeams = poolSet ? 0 : minTeamCount;
  let results = [...charStats.values()]
    .filter((s) => (poolSet ? poolSet.has(s.missId) : true))
    .filter((s) => s.teamCount >= minTeams)
    .map((s) => ({
      ...s,
      avgOfficial: Math.round(s.scoreSum / s.teamCount),
      priorityScore:
        s.teamCount * Math.sqrt(s.bestOfficial) + s.scoreSum * Math.log2(s.teamCount + 1),
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, Math.max(topN, precalcTop));

  onProgress?.(`精确评估前 ${Math.min(precalcTop, results.length)} 个缺员目标…`, 0.65);

  for (let i = 0; i < Math.min(precalcTop, results.length); i++) {
    const item = results[i];
    const comp = item.bestComp;
    if (!comp) continue;
    const tempBondMap = buildTempBondMap(bondMap, comp.compstr, [item.missId], assumeBond);
    item.preciseDmg = calcFit13t(comp, tempBondMap);
    item.assumeBond = assumeBond;
    if (i % 2 === 0) {
      onProgress?.(
        `精确重算缺员 ${i + 1}/${Math.min(precalcTop, results.length)}…`,
        0.65 + (i / precalcTop) * 0.3
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  results.sort(
    (a, b) =>
      (b.preciseDmg ?? 0) - (a.preciseDmg ?? 0) ||
      b.teamCount - a.teamCount ||
      b.priorityScore - a.priorityScore
  );

  const pool = results.slice(0, Math.max(topN, 40));

  return {
    results: results.slice(0, topN),
    pool,
    totalCandidates: charStats.size,
    assumeBond,
    poolIds: poolIds?.length ? [...poolIds] : [],
  };
}

/**
 * 卡池 UP 抽取推荐：仅在指定 poolIds 内排序，区分已持有 / 待抽取
 */
async function smartBannerPullSuggest(owned, options, onProgress) {
  const poolIds = (options.poolIds || []).map(Number).filter(Boolean);
  if (!poolIds.length) {
    return { results: [], ownedInPool: [], poolIds: [], emptyPool: true };
  }

  const { idSet, bondMap } = buildOwnedMaps(owned);
  const ownedInPool = poolIds
    .filter((id) => idSet.has(id))
    .map((id) => ({
      id,
      bond: bondMap.get(id) || 1,
      char: getCharacter(id),
    }));

  const pull = await smartPullSuggest(
    owned,
    {
      ...options,
      poolIds,
      topN: poolIds.length,
      precalcTop: Math.min(poolIds.length, options.precalcTop ?? 12),
      minTeamCount: options.minTeamCount ?? 1,
    },
    onProgress
  );

  const unownedResults = pull.results.filter((r) => !idSet.has(r.missId));
  const bestPick = unownedResults[0]?.missId ?? null;

  return {
    ...pull,
    results: unownedResults,
    ownedInPool,
    bestPick,
    emptyPool: false,
  };
}

function renderBannerPullCard(item, rank, opts = {}) {
  const base = renderPullSuggestCard(item, rank);
  if (!item.teamCount) {
    return base.replace(
      '<div class="comp-name">',
      '<div class="comp-name"><span class="smart-tag tag-warn" style="margin-right:0.35rem">难组高配</span>'
    );
  }
  if (opts.isTopPick) {
    return base.replace(
      'class="comp-card pull-card"',
      'class="comp-card pull-card banner-top-pick"'
    ).replace(
      '<div class="comp-side">',
      '<div class="comp-side"><span class="banner-pick-badge">首推</span>'
    );
  }
  return base;
}

/**
 * 羁绊提升性价比：评估每名角色从当前花数到各目标花数的总增益与每级效率
 * targetMode: auto=自动选最优路径 | max=直接拉到5花 | step=仅+1
 */
async function smartBondUpgradeSuggest(owned, options, onProgress) {
  const {
    topN = 15,
    precalcTop = 15,
    minOfficial = 15e9,
    minPreciseGain = 0,
    hpUpMin = 0,
    mustInclude = [],
    contextComps = [],
    targetMode = "auto",
  } = options;

  const data = await fetchCompDatabase(onProgress);
  const { idSet, bondMap, hpUpMap } = buildOwnedMaps(owned);
  const upgradeable = owned.filter((o) => (o.bond || 1) < 5);
  if (!upgradeable.length) {
    return { results: [], totalCandidates: 0 };
  }
  if (typeof CalcEngine === "undefined" || !CalcEngine.isEngineReady()) {
    return { results: [], totalCandidates: 0, engineMissing: true };
  }

  const upgradeableSet = new Set(upgradeable.map((o) => o.id));
  /** charId -> toBond -> stat */
  const charPathStats = new Map();
  const contextIds = new Set((contextComps || []).map((c) => c.id));

  onProgress?.("扫描升羁绊收益…", 0.15);

  for (let i = 0; i < data.length; i++) {
    const comp = data[i];
    if (!teamFullyOwned(comp.compstr, idSet)) continue;
    if (mustInclude.length && !mustInclude.every((id) => comp.compstr.includes(id))) continue;
    if (!passesFilters(comp, { idSet, hpUpMap, mustInclude: [], hpUpMin })) continue;
    if (!comp.description || comp.description.length < 10) continue;

    const official = comp.recommend || comp.vote || 0;
    if (official < minOfficial) continue;

    const inContext = contextIds.has(comp.id);
    const baseEstimate = estimateFit13t(comp, bondMap);
    const contextWeight = inContext ? 1.35 : 1;

    for (const charId of comp.compstr) {
      if (!upgradeableSet.has(charId)) continue;
      const fromBond = bondMap.get(charId) || 1;
      if (fromBond >= 5) continue;

      const targets =
        targetMode === "step"
          ? [fromBond + 1]
          : targetMode === "max"
            ? [5]
            : Array.from({ length: 5 - fromBond }, (_, k) => fromBond + k + 1);

      for (const toBond of targets) {
        const upgraded = CalcEngine.bondMapWithTarget(bondMap, charId, toBond);
        const newEstimate = estimateFit13t(comp, upgraded);
        const gain = (newEstimate - baseEstimate) * contextWeight;
        if (gain <= 0) continue;

        const levels = toBond - fromBond;
        if (!charPathStats.has(charId)) charPathStats.set(charId, new Map());
        const paths = charPathStats.get(charId);

        let stat = paths.get(toBond);
        if (!stat) {
          stat = {
            charId,
            fromBond,
            toBond,
            bondLevels: levels,
            teamCount: 0,
            gainSum: 0,
            bestGain: 0,
            bestComp: null,
            contextHits: 0,
          };
          paths.set(toBond, stat);
        }
        stat.teamCount++;
        stat.gainSum += gain;
        if (inContext) stat.contextHits++;
        if (gain > stat.bestGain) {
          stat.bestGain = gain;
          stat.bestComp = comp;
        }
      }
    }

    if (i % 4000 === 0) {
      onProgress?.(
        `扫描升羁绊 ${((i / data.length) * 100).toFixed(0)}% · 候选 ${charPathStats.size} 名`,
        0.15 + (i / data.length) * 0.45
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  let results = [];
  for (const [charId, paths] of charPathStats) {
    const pathList = [...paths.values()].map((s) => {
      const perLevel = s.gainSum / s.bondLevels;
      const roomFactor = (6 - s.fromBond) / 5;
      const priorityScore =
        s.gainSum *
        Math.log2(s.teamCount + 1) *
        roomFactor *
        (1 + s.contextHits * 0.08) /
        Math.pow(s.bondLevels, 0.35);
      return { ...s, perLevel, avgGain: Math.round(s.gainSum / s.teamCount), priorityScore };
    });

    let picked;
    if (targetMode === "step") {
      picked = pathList[0];
    } else if (targetMode === "max") {
      picked = pathList.find((p) => p.toBond === 5) || pathList.sort((a, b) => b.toBond - a.toBond)[0];
    } else {
      picked = pathList.sort((a, b) => b.priorityScore - a.priorityScore)[0];
    }
    if (picked) {
      results.push({
        ...picked,
        altPaths: pathList
          .filter((p) => p.toBond !== picked.toBond)
          .sort((a, b) => b.priorityScore - a.priorityScore)
          .slice(0, 2),
      });
    }
  }

  results.sort((a, b) => b.priorityScore - a.priorityScore);
  results = results.slice(0, Math.max(topN, precalcTop));

  onProgress?.(`精确评估升羁绊 Top ${Math.min(precalcTop, results.length)}…`, 0.65);

  for (let i = 0; i < Math.min(precalcTop, results.length); i++) {
    const item = results[i];
    const comp = item.bestComp;
    if (!comp) continue;
    item.baseDmg = calcFit13t(comp, bondMap);
    const upgraded = CalcEngine.bondMapWithTarget(bondMap, item.charId, item.toBond);
    item.newDmg = calcFit13t(comp, upgraded);
    item.preciseGain = Math.max(0, item.newDmg - item.baseDmg);
    item.perLevelGain = item.preciseGain / item.bondLevels;
    if (i % 2 === 0) {
      onProgress?.(
        `精确重算升羁绊 ${i + 1}/${Math.min(precalcTop, results.length)}…`,
        0.65 + (i / precalcTop) * 0.3
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  results = results.filter((item) => (item.preciseGain ?? item.bestGain) >= minPreciseGain);

  results.sort(
    (a, b) =>
      (b.perLevelGain ?? b.perLevel ?? 0) - (a.perLevelGain ?? a.perLevel ?? 0) ||
      (b.preciseGain ?? b.bestGain) - (a.preciseGain ?? a.bestGain) ||
      b.teamCount - a.teamCount ||
      a.fromBond - b.fromBond ||
      b.priorityScore - a.priorityScore
  );

  return {
    results: results.slice(0, topN),
    totalCandidates: charPathStats.size,
    targetMode,
  };
}

/** 抽取 + 升羁绊 一并分析（培养建议） */
async function smartInvestAdvice(owned, options, onProgress) {
  if (typeof CalcEngine !== "undefined") {
    await CalcEngine.waitUntilReady();
  }

  let pullProgress = 0;
  let bondProgress = 0;
  const mergeProgress = (phase, ratio) => {
    if (phase === "pull") pullProgress = ratio ?? 0;
    else bondProgress = ratio ?? 0;
    onProgress?.(
      phase === "pull" ? "分析优先抽取…" : "分析升羁绊性价比…",
      pullProgress * 0.52 + bondProgress * 0.48
    );
  };

  const [pull, bond] = await Promise.all([
    smartPullSuggest(owned, options.pull, (text, ratio) => {
      mergeProgress("pull", ratio);
      onProgress?.(text, pullProgress * 0.52 + bondProgress * 0.48);
    }),
    smartBondUpgradeSuggest(owned, options.bond, (text, ratio) => {
      mergeProgress("bond", ratio);
      onProgress?.(text, pullProgress * 0.52 + bondProgress * 0.48);
    }),
  ]);

  return { pull, bond };
}

/** @deprecated 使用 smartInvestAdvice */
async function smartPullAndBondAdvice(owned, options, onProgress) {
  return smartInvestAdvice(owned, { pull: options, bond: options }, onProgress);
}

/** 羁绊提升建议：对当前配队中的低羁绊角色评估多级升花路径 */
function smartBondUpgradeHints(topComp, bondMap) {
  if (!topComp?.compstr || !topComp.description) return [];
  if (typeof CalcEngine === "undefined" || !CalcEngine.isEngineReady()) return [];
  const hints = [];
  const seen = new Set();
  const baseDmg = topComp.fit13t || calcFit13t(topComp, bondMap);

  for (const weakId of topComp.compstr) {
    if (seen.has(weakId)) continue;
    const cur = bondMap.get(weakId) || 1;
    if (cur >= 5) continue;

    let best = null;
    for (let toBond = cur + 1; toBond <= 5; toBond++) {
      const levels = toBond - cur;
      const upgraded = CalcEngine.bondMapWithTarget(bondMap, weakId, toBond);
      const newDmg = calcFit13t(topComp, upgraded);
      const gain = newDmg - baseDmg;
      if (gain <= 0) continue;
      const perLevel = gain / levels;
      const score = gain / Math.pow(levels, 0.35);
      if (!best || score > best.score) {
        best = { charId: weakId, fromBond: cur, toBond, bondLevels: levels, gain, perLevel, newDmg, score };
      }
    }
    if (best) {
      hints.push(best);
      seen.add(weakId);
    }
  }
  return hints.sort((a, b) => b.perLevel - a.perLevel || b.gain - a.gain);
}

function renderPullDeckWithSlots(compIds, bonds, missId) {
  return compIds
    .map((id, i) => {
      const ch = getCharacter(id);
      if (!ch) return "";
      const n = charDisplayName(ch);
      const bond = bonds?.[i] ?? "";
      const isPull = id === missId;
      const hpUp = i === 0 && ch.hpUp ? `<span class="hp-badge">生命+${ch.hpUp}</span>` : "";
      const lib =
        ch.isLiberation ||
        (typeof liberationList !== "undefined" && liberationList.includes(ch.name));
      return `<div class="deck-char slot-char${isPull ? " deck-char-pull-missing" : ""}" title="${isPull ? "待抽取：" : ""}${n}">
        <span class="slot-num-badge">${i + 1}</span>
        ${isPull ? `<span class="pull-missing-badge">待抽</span>` : ""}
        <img src="${charImageUrl(id)}" alt="${n}">
        <span class="element-dot element-${ch.element}"></span>
        ${bond ? `<span class="bond-badge" style="top:auto;bottom:14px;right:2px">${bond}</span>` : ""}
        ${hpUp}${lib ? `<span class="lib-badge">+</span>` : ""}
        <span class="deck-char-name">${n}</span>
      </div>`;
    })
    .join("");
}

function renderPullCompactRow(item, rank, expanded = false) {
  const comp = item.bestComp;
  if (!comp) return "";
  const ids = comp.compstr;
  const bonds = pullItemBonds(item);
  const pullCh = getCharacter(item.missId);
  const pullName = charDisplayName(pullCh) || item.missId;
  const fitYi = item.preciseDmg > 0 ? (item.preciseDmg / 1e8).toFixed(2) : "-";
  const official = item.bestOfficial > 0 ? (item.bestOfficial / 1e8).toFixed(2) : "-";
  const uid = `pull-compact-${item.missId}`;
  const commandHtml = formatCommandHtml(comp.description, ids, true);
  const preview = formatCommandPreview(comp.description, ids, 2);

  return `<div class="smart-compact-row-wrap pull-compact-row-wrap" data-miss-id="${item.missId}">
    <div class="smart-compact-row pull-compact-row${expanded ? " expanded" : ""}" onclick="togglePullCompactRow('${uid}')">
      <div class="pull-compact-pull-tag">
        <img src="${charImageUrl(item.missId)}" alt="${pullName}">
        <span>抽 ${pullName}</span>
      </div>
      <div class="smart-compact-deck" onclick="event.stopPropagation()">
        ${renderPullDeckWithSlots(ids, bonds, item.missId)}
      </div>
      <div class="smart-compact-dmg">
        <div class="smart-compact-dmg-val">${fitYi}<span class="smart-compact-dmg-unit">亿</span></div>
        <div class="smart-compact-dmg-sub">解锁 ${item.teamCount} 套 · 官方 ${official} 亿</div>
      </div>
    </div>
    <div class="smart-compact-detail${expanded ? " open" : ""}" id="${uid}">
      <div class="smart-compact-detail-head">
        <span class="smart-compact-detail-rank">抽取优先级 第 ${rank} 名</span>
        <span class="smart-compact-detail-name">${escapeHtml(compDisplayName(comp))}</span>
      </div>
      <div class="smart-tags" style="margin-bottom:0.5rem">
        <span class="smart-tag">待抽 ${pullName}</span>
        <span class="smart-tag">假设 ${item.assumeBond || 1} 花</span>
        <span class="smart-tag">解锁 ${item.teamCount} 套</span>
        <span class="smart-tag">均参考 ${formatNumber(item.avgOfficial || 0)}</span>
      </div>
      <div class="command-preview-text" style="margin-bottom:0.5rem;font-size:0.78rem">${escapeHtml(preview)}</div>
      <div class="command-panel smart-compact-command">${commandHtml}</div>
      <div class="smart-actions" style="margin-top:0.65rem">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();location.href='${siteUrl(`comp/index.html?id=${comp.id}`)}'">查看配队</button>
        <button class="btn btn-sm" onclick="event.stopPropagation();pullCopyCommand(${item.missId})">复制顺序</button>
      </div>
    </div>
  </div>`;
}

function renderPullCompactPanel(results, page, expandedMissId, extendedPool, parallelCount = 4) {
  const total = results.length;
  const poolTotal = extendedPool?.length || total;
  const batches = buildDisjointPullBatches(results, parallelCount, extendedPool);
  const pages = Math.max(1, batches.length);
  const safePage = Math.min(Math.max(1, page), pages);
  const slice = batches[safePage - 1] || [];
  const batchTotalYi = (batchTotalPullDmg(slice) / 1e8).toFixed(2);
  const rankLabel = slice.map((item) => pullResultRank(results, item, extendedPool)).filter(Boolean).join("、");

  const rows = slice
    .map((item) =>
      renderPullCompactRow(
        item,
        pullResultRank(results, item, extendedPool),
        expandedMissId === item.missId
      )
    )
    .join("");

  const shortHint =
    slice.length < parallelCount && slice.length > 0
      ? ` · 目标 ${parallelCount} 套，已选 ${slice.length} 套无重复`
      : slice.length > 1
        ? ` · ${slice.length} 套角色互不重复`
        : "";

  const totalHint =
    slice.length > 1
      ? `<strong class="smart-compact-batch-total">合计 ${batchTotalYi} 亿</strong> · `
      : "";

  const rangeText =
    slice.length >= 1
      ? `${totalHint}抽取优先级 ${rankLabel}${shortHint} · 列表 ${total} 名 · 候选 ${poolTotal} 名`
      : "暂无四队参考";

  return `<div class="smart-compact-panel pull-compact-panel">
    <div class="smart-compact-header">
      <div class="smart-compact-header-left">
        <span class="smart-compact-page-badge"># ${safePage}</span>
        <span class="smart-compact-range">${rangeText}</span>
      </div>
      <div class="smart-compact-header-right">
        <span class="smart-compact-select-label" style="font-size:0.78rem;color:var(--text-muted)">四队参考</span>
        <div class="smart-compact-nav">
          <button type="button" class="btn btn-sm" onclick="setPullCompactPage(${safePage - 1})" ${safePage <= 1 ? "disabled" : ""}>‹</button>
          <span class="smart-compact-nav-text">${safePage} / ${pages}</span>
          <button type="button" class="btn btn-sm" onclick="setPullCompactPage(${safePage + 1})" ${safePage >= pages ? "disabled" : ""}>›</button>
        </div>
      </div>
    </div>
    <div class="smart-compact-rows">${rows || `<p class="empty-hint" style="padding:1rem">暂无四队参考（候选池角色重叠过多）</p>`}</div>
  </div>`;
}

function renderPullSuggestCard(item, rank) {
  const ch = getCharacter(item.missId);
  const name = charDisplayName(ch) || item.missId;
  const comp = item.bestComp;
  const precise =
    item.preciseDmg > 0
      ? formatNumber(item.preciseDmg)
      : "-";
  const official = item.bestOfficial > 0 ? formatNumber(item.bestOfficial) : "-";

  let deckPreview = "";
  if (comp) {
    const { bondMap: ownedBonds } = buildOwnedMaps(getOwned());
    const bonds = comp.compstr.map((id) =>
      id === item.missId ? (item.assumeBond || 1) : (ownedBonds.get(id) || 1)
    );
    deckPreview = renderDeckWithSlots(comp.compstr, bonds);
  }

  return `<div class="comp-card pull-card">
    <div class="comp-side">第${rank}名</div>
    <div class="pull-char-col">
      <img class="pull-char-img" src="${charImageUrl(item.missId)}" alt="${name}">
      <span class="pull-char-name">${name}</span>
      ${ch?.element != null ? `<span class="element-dot element-${ch.element}" style="position:static;margin:0.25rem auto 0"></span>` : ""}
    </div>
    <div class="comp-body" style="flex:1;min-width:0">
      <div class="comp-name">解锁 <strong style="color:var(--accent)">${item.teamCount}</strong> 套高配队</div>
      <div class="smart-tags">
        <span class="smart-tag">解锁 ${item.teamCount} 套</span>
        <span class="smart-tag">均参考 ${formatNumber(item.avgOfficial)}</span>
        <span class="smart-tag">假设 ${item.assumeBond || 1} 花</span>
      </div>
      ${deckPreview ? `<div class="comp-deck" style="margin-top:0.5rem">${deckPreview}</div>` : ""}
      <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.35rem">
        代表配队：${escapeHtml(comp ? compDisplayName(comp) : "社区配队")}
      </div>
    </div>
    <div class="comp-metric" style="min-width:100px;text-align:right">
      <div style="font-size:0.72rem;color:var(--text-muted)">抽到后重算</div>
      <span class="metric-dmg">⚡ ${precise}</span>
      <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.15rem">官方 ${official}</div>
      ${comp ? `<button class="btn btn-sm" style="margin-top:0.5rem" onclick="location.href='${siteUrl(`comp/index.html?id=${comp.id}`)}'">查看配队</button>` : ""}
    </div>
  </div>`;
}

function renderBondUpgradeCard(item, rank) {
  const ch = getCharacter(item.charId);
  const name = charDisplayName(ch) || item.charId;
  const comp = item.bestComp;
  const levels = item.bondLevels || item.toBond - item.fromBond;
  const gain =
    item.preciseGain > 0
      ? formatNumber(item.preciseGain)
      : item.bestGain > 0
        ? `约 ${formatNumber(item.bestGain)}`
        : "-";
  const baseDmg = item.baseDmg > 0 ? formatNumber(item.baseDmg) : "-";
  const newDmg = item.newDmg > 0 ? formatNumber(item.newDmg) : "-";
  const perLevel =
    item.perLevelGain > 0
      ? `${(item.perLevelGain / 1e8).toFixed(2)} 亿/级`
      : item.perLevel > 0
        ? `约 ${(item.perLevel / 1e8).toFixed(2)} 亿/级`
        : "-";
  const altHint = (item.altPaths || [])
    .slice(0, 2)
    .map((p) => `${p.fromBond}→${p.toBond}花 约+${formatNumber(p.gainSum / p.teamCount || 0)}`)
    .join(" · ");
  const stepPath = (item.altPaths || []).find((p) => p.toBond === item.fromBond + 1);
  const to5Path = (item.altPaths || []).find((p) => p.toBond === 5);
  const stepGain =
    stepPath?.gainSum && stepPath.teamCount
      ? `${(stepPath.gainSum / stepPath.teamCount / 1e8).toFixed(2)} 亿/花`
      : item.perLevelGain > 0
        ? `${(item.perLevelGain / 1e8).toFixed(2)} 亿/花`
        : "-";
  const to5Gain = to5Path ? formatNumber(to5Path.gainSum / (to5Path.teamCount || 1)) : null;
  let bottleneckTag = "";
  if (comp && typeof getTeamBondBottleneck === "function") {
    const { bondMap } = buildOwnedMaps(getOwned());
    const neck = getTeamBondBottleneck(comp, bondMap);
    if (neck?.charId === item.charId) {
      bottleneckTag = `<span class="smart-tag tag-warn">瓶颈 · 全队最低 ${neck.bond} 花</span>`;
    }
  }

  let deckPreview = "";
  if (comp) {
    const { bondMap: ownedBonds } = buildOwnedMaps(getOwned());
    const bonds = comp.compstr.map((id) =>
      id === item.charId ? item.toBond : (ownedBonds.get(id) || 1)
    );
    deckPreview = renderDeckWithSlots(comp.compstr, bonds);
  }

  return `<div class="comp-card pull-card bond-upgrade-card">
    <div class="comp-side">第${rank}名</div>
    <div class="pull-char-col">
      <img class="pull-char-img bond-upgrade-img" src="${charImageUrl(item.charId)}" alt="${name}">
      <span class="pull-char-name">${name}</span>
      <span class="smart-tag" style="margin-top:0.25rem">${item.fromBond} 花 → ${item.toBond} 花</span>
      ${levels > 1 ? `<span style="font-size:0.68rem;color:var(--text-muted)">共 ${levels} 级</span>` : ""}
    </div>
    <div class="comp-body" style="flex:1;min-width:0">
      <div class="comp-name">升花影响 <strong style="color:var(--success)">${item.teamCount}</strong> 套配队${item.contextHits ? ` · 含 ${item.contextHits} 套当前推荐` : ""}</div>
      <div class="smart-tags">
        <span class="smart-tag">+1 花 ${stepGain}</span>
        ${to5Gain ? `<span class="smart-tag">→5 花均 ${to5Gain}</span>` : ""}
        <span class="smart-tag">总增益 ${gain}</span>
        ${levels > 1 ? `<span class="smart-tag">推荐 ${item.fromBond}→${item.toBond}</span>` : ""}
        ${bottleneckTag}
      </div>
      ${altHint ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem">备选：${altHint}</div>` : ""}
      ${deckPreview ? `<div class="comp-deck" style="margin-top:0.5rem">${deckPreview}</div>` : ""}
      <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.35rem">
        最佳代表：${escapeHtml(comp ? compDisplayName(comp) : "社区配队")}
      </div>
    </div>
    <div class="comp-metric" style="min-width:100px;text-align:right">
      <div style="font-size:0.72rem;color:var(--text-muted)">升 ${levels} 级总增益</div>
      <span class="metric-dmg" style="color:var(--success)">+${gain}</span>
      <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.15rem">${baseDmg} → ${newDmg}</div>
      ${comp ? `<button class="btn btn-sm" style="margin-top:0.5rem" onclick="location.href='${siteUrl(`comp/index.html?id=${comp.id}`)}'">查看配队</button>` : ""}
    </div>
  </div>`;
}

function renderSmartCompCard(comp, rank, viewMode = "list") {
  const ids = comp.compstr;
  const name = compDisplayName(comp);
  const fit = formatNumber(comp.fit13t);
  const fitDisplay = comp.fit13tSource === "estimate" ? `≈ ${fit}` : fit;
  const official = comp.recommend > 0 ? formatNumber(comp.recommend) : "-";
  const scarecrow = comp.ranking ? Math.round(comp.ranking) + " 回合" : "-";
  const preview = formatCommandPreview(comp.description, ids, 2);
  const commandHtml = formatCommandHtml(comp.description, ids, true);
  const uid = `smart-${comp.id}-${rank}`;
  const bondAvg = comp.bondAvg?.toFixed(1) || "-";
  const grid = viewMode === "grid";
  const weakHint =
    comp.weakIds?.length && comp.bondMin < 5
      ? `薄弱：${comp.weakIds.map((id) => charDisplayName(getCharacter(id)) || id).join("、")}（羁绊 ${comp.bondMin}）`
      : "";
  const gapHint =
    comp.gapToOfficial > 0
      ? `距全 5 羁绊参考还差 ${formatNumber(comp.gapToOfficial)}`
      : comp.gapToOfficial < 0
        ? `已超官方参考 ${formatNumber(-comp.gapToOfficial)}`
        : "";

  const headClick = grid ? "" : ` onclick="toggleSmartCard('${uid}')"`;
  const expandIcon = grid
    ? ""
    : `<span class="expand-icon" id="${uid}-icon">▼</span>`;
  const previewLine = grid
    ? ""
    : `<div class="command-preview-text">${escapeHtml(preview)}</div>`;

  return `<div class="comp-card smart-card${grid ? " smart-card-grid expanded" : ""}" data-id="${comp.id}" data-bonds="${comp.bonds.join(",")}">
    <div class="smart-card-head"${headClick}>
      <div class="smart-card-head-top">
        <div class="comp-side">第${rank}名</div>
        <div class="comp-metric smart-comp-metric">
          <span class="metric-dmg">⚡ ${fitDisplay}</span>
          <div class="metric-sub">官方（5 羁绊）${official}${comp.fit13tSource === "estimate" ? " · 羁绊估算" : ""}</div>
        </div>
      </div>
      <div class="comp-body" style="flex:1;min-width:0">
        <div class="comp-name">${escapeHtml(name)}</div>
        <div class="comp-deck smart-editable-deck">${renderEditableDeckWithSlots(comp.id, ids, comp.bonds)}</div>
        <div class="smart-tags">
          <span class="smart-tag">均羁绊 ${bondAvg}</span>
          <span class="smart-tag">总羁绊 ${comp.bondTotal ?? "-"}</span>
          ${comp.isLocal ? `<span class="smart-tag tag-local">本地组合</span>` : ""}
          ${comp.fit13tSource === "estimate" ? `<span class="smart-tag tag-estimate">羁绊估算</span>` : ""}
          ${comp.efficiency ? `<span class="smart-tag">效率 ${(comp.efficiency / 1e8).toFixed(2)}亿/羁绊</span>` : ""}
        </div>
        ${comp.isLocal && comp.localNote ? `<div class="command-preview-text" style="color:var(--warning)">${escapeHtml(comp.localNote)}</div>` : ""}
        ${previewLine}
      </div>
      ${expandIcon}
    </div>
    <div class="smart-card-body" id="${uid}">
      <div class="smart-stats">
        <span>重算伤害 <strong style="color:var(--success)">${fitDisplay}</strong></span>
        <span>官方参考（5 羁绊） <strong>${official}</strong></span>
        <span>木椿 <strong>${scarecrow}</strong></span>
        ${gapHint ? `<span>${gapHint}</span>` : ""}
        ${comp.maxBondFit13t > 0 && comp.bondMin < 5 ? `<span>全 5 羁绊潜力 <strong style="color:var(--accent)">${formatNumber(comp.maxBondFit13t)}</strong></span>` : ""}
        ${comp.calcNote && comp.fit13tSource === "estimate" ? `<span style="color:var(--warning)">${escapeHtml(comp.calcNote)}</span>` : ""}
        ${weakHint ? `<span style="color:var(--danger)">${weakHint}</span>` : ""}
        ${(comp.bondUpgradeHints || []).slice(0, 2).map((h) => {
          const n = charDisplayName(getCharacter(h.charId)) || h.charId;
          const lvl = h.bondLevels > 1 ? `（${h.bondLevels}级）` : "";
          return `<span>升羁绊：${n} ${h.fromBond}→${h.toBond}${lvl} <strong style="color:var(--success)">+${formatNumber(h.gain)}</strong> · ${(h.perLevel / 1e8).toFixed(2)}亿/级</span>`;
        }).join("")}
      </div>
      <div class="block-title" style="margin-bottom:0.35rem">出招顺序 <span style="font-weight:400;color:var(--text-muted)">（1~5 号对应上方角色）</span></div>
      <div class="command-panel">${commandHtml}</div>
      <div class="smart-actions">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();goSmartCalc(${JSON.stringify(comp.id)})">精确打桩</button>
        <button class="btn btn-sm" onclick="event.stopPropagation();goSmartTeam(${JSON.stringify(comp.id)})">加入编队</button>
        <button class="btn btn-sm" onclick="event.stopPropagation();smartResetCompBonds(${JSON.stringify(comp.id)})">重置花数</button>
        ${comp.isLocal ? "" : `<button class="btn btn-sm" onclick="event.stopPropagation();goSmartDetail(${comp.id})">配队详情</button>`}
        <button class="btn btn-sm" onclick="event.stopPropagation();smartCopyCommand(${JSON.stringify(comp.id)})">复制顺序</button>
        ${typeof isFavComp === "function" ? `<button class="btn btn-sm" onclick="event.stopPropagation();toggleSmartFav(${comp.id})">${isFavComp(comp.id) ? "★ 已收藏" : "☆ 收藏"}</button>` : ""}
      </div>
    </div>
  </div>`;
}

/** TenkaAssist 风格紧凑行：5 角色横排 + 右侧伤害（亿） */
function renderSmartCompactRow(comp, rank, expanded = false) {
  const ids = comp.compstr;
  const fitYi = formatFit13tYi(comp);
  const official = comp.recommend > 0 ? (comp.recommend / 1e8).toFixed(2) : "-";
  const uid = `smart-compact-${comp.id}`;
  const commandHtml = formatCommandHtml(comp.description, ids, true);
  const preview = formatCommandPreview(comp.description, ids, 2);

  return `<div class="smart-compact-row-wrap" data-id="${comp.id}">
    <div class="smart-compact-row${expanded ? " expanded" : ""}" onclick="toggleSmartCompactRow('${uid}')">
      <div class="smart-compact-deck smart-editable-deck" onclick="event.stopPropagation()">
        ${renderEditableDeckWithSlots(comp.id, ids, comp.bonds)}
      </div>
      <div class="smart-compact-dmg">
        <div class="smart-compact-dmg-val">${fitYi}<span class="smart-compact-dmg-unit">亿</span></div>
        <div class="smart-compact-dmg-sub">官方 ${official} 亿${comp.fit13tSource === "estimate" ? " · 估算" : ""}</div>
        <div class="smart-compact-name" title="${escapeHtml(compDisplayName(comp))}">${escapeHtml(compDisplayName(comp))}</div>
      </div>
    </div>
    <div class="smart-compact-detail${expanded ? " open" : ""}" id="${uid}">
      <div class="smart-compact-detail-head">
        <span class="smart-compact-detail-rank">第 ${rank} 名</span>
        <span class="smart-compact-detail-name">${escapeHtml(compDisplayName(comp))}</span>
      </div>
      <div class="smart-tags" style="margin-bottom:0.5rem">
        <span class="smart-tag">均羁绊 ${comp.bondAvg?.toFixed(1) || "-"}</span>
        <span class="smart-tag">总羁绊 ${comp.bondTotal ?? "-"}</span>
        ${comp.isLocal ? `<span class="smart-tag tag-local">本地组合</span>` : ""}
        ${comp.fit13tSource === "estimate" ? `<span class="smart-tag tag-estimate">羁绊估算</span>` : ""}
        ${comp.efficiency ? `<span class="smart-tag">效率 ${(comp.efficiency / 1e8).toFixed(2)}亿/羁绊</span>` : ""}
      </div>
      ${comp.isLocal && comp.localNote ? `<div class="command-preview-text" style="color:var(--warning);margin-bottom:0.5rem">${escapeHtml(comp.localNote)}</div>` : ""}
      <div class="command-preview-text" style="margin-bottom:0.5rem;font-size:0.78rem">${escapeHtml(preview)}</div>
      <div class="command-panel smart-compact-command">${commandHtml}</div>
      <div class="smart-actions" style="margin-top:0.65rem">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();goSmartCalc(${JSON.stringify(comp.id)})">精确打桩</button>
        <button class="btn btn-sm" onclick="event.stopPropagation();goSmartTeam(${JSON.stringify(comp.id)})">加入编队</button>
        <button class="btn btn-sm" onclick="event.stopPropagation();smartResetCompBonds(${JSON.stringify(comp.id)})">重置花数</button>
        ${comp.isLocal ? "" : `<button class="btn btn-sm" onclick="event.stopPropagation();goSmartDetail(${comp.id})">配队详情</button>`}
        <button class="btn btn-sm" onclick="event.stopPropagation();smartCopyCommand(${JSON.stringify(comp.id)})">复制顺序</button>
        ${typeof isFavComp === "function" ? `<button class="btn btn-sm" onclick="event.stopPropagation();toggleSmartFav(${comp.id})">${isFavComp(comp.id) ? "★ 已收藏" : "☆ 收藏"}</button>` : ""}
      </div>
    </div>
  </div>`;
}

function renderSmartCompactPanel(results, page, parallelCount, expandedId, extendedPool, batchSort = "batchTotal", batchesPrebuilt) {
  const total = results.length;
  const poolTotal = extendedPool?.length || total;
  const batches =
    batchesPrebuilt ||
    getSmartDisjointBatches(results, parallelCount, extendedPool, batchSort);
  const pages = Math.max(1, batches.length);
  const safePage = Math.min(Math.max(1, page), pages);
  const slice = batches[safePage - 1] || [];
  const batchTotalYi = (batchTotalDmg(slice) / 1e8).toFixed(2);
  const rankLabel = slice.map((c) => smartResultRank(results, c, extendedPool)).filter(Boolean).join("、");
  const byTotal = batchSort === "batchTotal";

  const parallelOptions = [1, 2, 3, 4]
    .map(
      (n) =>
        `<option value="${n}"${parallelCount === n ? " selected" : ""}>队伍${n}</option>`
    )
    .join("");

  const batchSortOptions = [
    { value: "batchTotal", label: "组合总伤" },
    { value: "rank", label: "推荐名次" },
  ]
    .map(
      (o) =>
        `<option value="${o.value}"${batchSort === o.value ? " selected" : ""}>${o.label}</option>`
    )
    .join("");

  const rows = slice
    .map((comp) =>
      renderSmartCompactRow(
        comp,
        smartResultRank(results, comp, extendedPool),
        expandedId === comp.id
      )
    )
    .join("");

  const shortHint =
    slice.length < parallelCount && slice.length > 0
      ? ` · 目标 ${parallelCount} 套，已选 ${slice.length} 套无重复`
      : slice.length > 1
        ? ` · ${slice.length} 套角色互不重复`
        : "";

  const totalHint =
    slice.length > 1 && byTotal
      ? `<strong class="smart-compact-batch-total">合计 ${batchTotalYi} 亿</strong> · `
      : slice.length > 1 && !byTotal
        ? `<span style="color:var(--text-muted)">合计 ${batchTotalYi} 亿 · </span>`
        : "";

  const sortHint = byTotal ? "组合总伤排序" : "推荐名次排序";

  const rangeText =
    slice.length >= 1
      ? `${totalHint}第 ${rankLabel} 名${shortHint} · ${sortHint} · 列表 ${total} 套 · 候选 ${poolTotal} 套`
      : "无配队";

  return `<div class="smart-compact-panel">
    <div class="smart-compact-header">
      <div class="smart-compact-header-left">
        <span class="smart-compact-page-badge"># ${safePage}</span>
        <span class="smart-compact-range">${rangeText}</span>
      </div>
      <div class="smart-compact-header-right">
        <label class="smart-compact-select-label">
          <select class="sort-select smart-batch-sort-select" onchange="setSmartBatchSort(this.value)">${batchSortOptions}</select>
        </label>
        <label class="smart-compact-select-label">
          <select class="sort-select smart-parallel-select" onchange="setSmartParallelCount(Number(this.value))">${parallelOptions}</select>
        </label>
        <div class="smart-compact-nav">
          <button type="button" class="btn btn-sm" onclick="setSmartCompactPage(${safePage - 1})" ${safePage <= 1 ? "disabled" : ""}>‹</button>
          <span class="smart-compact-nav-text">${safePage} / ${pages}</span>
          <button type="button" class="btn btn-sm" onclick="setSmartCompactPage(${safePage + 1})" ${safePage >= pages ? "disabled" : ""}>›</button>
        </div>
      </div>
    </div>
    <div class="smart-compact-rows">${rows || `<p class="empty-hint" style="padding:1rem">暂无推荐</p>`}</div>
  </div>`;
}

function toggleSmartCompactRow(uid) {
  const detail = document.getElementById(uid);
  if (!detail) return;
  const wrap = detail.closest(".smart-compact-row-wrap");
  const id = wrap?.dataset.id ? Number(wrap.dataset.id) : null;
  const wasOpen = detail.classList.contains("open");
  document.querySelectorAll(".smart-compact-detail.open").forEach((el) => {
    el.classList.remove("open");
    el.closest(".smart-compact-row-wrap")?.querySelector(".smart-compact-row")?.classList.remove("expanded");
  });
  if (!wasOpen && detail) {
    detail.classList.add("open");
    wrap?.querySelector(".smart-compact-row")?.classList.add("expanded");
    if (id != null) window.smartCompactExpandedId = id;
  } else {
    window.smartCompactExpandedId = null;
  }
}

function filterNearMissByChars(nearMiss, charIds) {
  if (!nearMiss?.length || !charIds?.size) return nearMiss || [];
  return nearMiss.filter((item) => {
    const ids = item.comp?.compstr || [];
    return !ids.some((id) => charIds.has(id));
  });
}

function renderNearMissCard(item) {
  const ch = getCharacter(item.missId);
  const name = charDisplayName(ch) || item.missId;
  const comp = item.comp;
  const ids = comp.compstr;
  const official = comp.recommend > 0 ? formatNumber(comp.recommend) : "-";
  const deckHtml = ids
    .map((id, i) => {
      if (id === item.missId) {
        return `<div class="deck-char slot-char missing-char" title="缺少：${name}">
          <span class="slot-num-badge">${i + 1}</span>
          <div class="missing-placeholder">?</div>
          <span class="deck-char-name">${name}</span>
        </div>`;
      }
      const c = getCharacter(id);
      if (!c) return "";
      const n = charDisplayName(c);
      const bond = item.bonds?.[i] ?? "";
      return `<div class="deck-char slot-char" title="${n}">
        <span class="slot-num-badge">${i + 1}</span>
        <img src="${charImageUrl(id)}" alt="${n}">
        <span class="element-dot element-${c.element}"></span>
        ${bond ? `<span class="bond-badge" style="top:auto;bottom:14px;right:2px">${bond}</span>` : ""}
        <span class="deck-char-name">${n}</span>
      </div>`;
    })
    .join("");

  return `<div class="comp-card near-miss-card">
    <div class="comp-side">缺 1</div>
    <div class="comp-body" style="flex:1;min-width:0">
      <div class="comp-name">缺少 <strong style="color:var(--accent)">${name}</strong> · ${escapeHtml(compDisplayName(comp))}</div>
      <div class="comp-deck">${deckHtml}</div>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.35rem">官方参考（5 羁绊）${official}</div>
    </div>
  </div>`;
}

const compDescriptions = {};

function bindSmartCardClicks(container, results) {
  window.smartResults = results;
  results.forEach((c) => {
    compDescriptions[c.id] = c.description;
  });
}

function smartCopyCommand(id) {
  const comp = (window.smartResults || []).find((c) => c.id === id);
  if (!comp) return;
  const text = formatCommandText(comp.description, comp.compstr, true);
  navigator.clipboard.writeText(text).then(() => showToast("已复制出招顺序", "success")).catch(() => showPrompt("复制出招顺序", text));
}

function toggleSmartCard(uid) {
  const body = document.getElementById(uid);
  const card = body?.closest(".smart-card");
  if (card) card.classList.toggle("expanded");
}

function goSmartCalc(id) {
  const comp = findSmartCompById(id);
  const bonds = comp?.bonds?.join(",") || "";
  if (comp?.isLocal) {
    sessionStorage.setItem(
      "dazhuang_local_comp",
      JSON.stringify({
        compstr: comp.compstr,
        description: comp.description,
        name: compDisplayName(comp),
        bonds: comp.bonds,
      })
    );
    location.href = `../calc/index.html?local=1&bond=${bonds}`;
    return;
  }
  location.href = `../calc/index.html?comp=${id}&bond=${bonds}`;
}

function pullCopyCommand(missId) {
  const item =
    (window.pullResults || []).find((r) => r.missId === missId) ||
    (window.pullResultsPool || []).find((r) => r.missId === missId);
  if (!item?.bestComp?.description) return;
  copyCommandText(item.bestComp.description, item.bestComp.compstr);
}

function goSmartDetail(id) {
  location.href = `../comp/index.html?id=${id}`;
}

function goSmartTeam(id) {
  const comp =
    (window.smartResults || []).find((c) => c.id === id) ||
    (window.smartResultsPool || []).find((c) => c.id === id);
  if (!comp) return;
  const team = comp.compstr.map((cid, i) => ({ id: cid, bond: comp.bonds[i] || 1 }));
  setTeam(team);
  showToast(`已加入编队：${compDisplayName(comp)}`, "success", 2500);
  setTimeout(() => {
    location.href = siteUrl("team/index.html");
  }, 400);
}

/** 再抽 N 张模拟：假设按优先级依次获得卡池角色 */
async function simulatePoolPulls(owned, options, counts = [1, 3, 10], onProgress) {
  const baseline = await smartBannerPullSuggest(owned, options, onProgress);
  const unownedIds = baseline.results.map((r) => r.missId).filter(Boolean);
  const assumeBond = options.assumeBond || 1;
  const rows = [];

  for (const n of counts) {
    const picks = unownedIds.slice(0, Math.min(n, unownedIds.length));
    const hypo = [...owned];
    const idSet = new Set(hypo.map((o) => o.id));
    for (const id of picks) {
      if (!idSet.has(id)) {
        hypo.push({ id, bond: assumeBond });
        idSet.add(id);
      }
    }
    onProgress?.(`模拟再抽 ${n} 张…`, 0.5);
    const after =
      picks.length > 0
        ? await smartBannerPullSuggest(hypo, options)
        : { ...baseline, results: [], ownedInPool: baseline.ownedInPool };
    const batchLen =
      typeof buildDisjointPullBatches === "function"
        ? (buildDisjointPullBatches(after.results, 4, after.pool || after.results)[0] || []).length
        : 0;
    rows.push({
      n,
      picks,
      pickNames: picks.map((id) => charDisplayName(getCharacter(id)) || id),
      disjointTeams: batchLen,
      remainingInPool: after.results.length,
      topAfter: after.results[0],
    });
  }
  return { baseline, rows };
}

/** 卡池内已持有角色的升羁绊建议（+1 花） */
async function smartBondUpgradeForPool(owned, poolCharIds, options, onProgress) {
  const poolSet = new Set((poolCharIds || []).map(Number));
  if (!poolSet.size) return { results: [] };
  const bond = await smartBondUpgradeSuggest(
    owned,
    {
      topN: poolSet.size,
      precalcTop: poolSet.size,
      targetMode: "step",
      minOfficial: options.minOfficial ?? 15e8,
      minPreciseGain: 0,
      hpUpMin: options.hpUpMin ?? 0,
      contextComps: options.contextComps || [],
    },
    onProgress
  );
  bond.results = bond.results.filter((r) => poolSet.has(r.charId));
  return bond;
}

function comparePullVsBondAdvice(topPull, topBond) {
  const pullDmg = topPull?.preciseDmg || topPull?.avgOfficial || 0;
  const bondGain = topBond?.perLevelGain || topBond?.preciseGain || topBond?.bestGain || 0;
  const pullName = topPull
    ? charDisplayName(getCharacter(topPull.missId)) || topPull.missId
    : null;
  const bondName = topBond
    ? charDisplayName(getCharacter(topBond.charId)) || topBond.charId
    : null;
  let verdict = "pull";
  let text = "";
  if (!topPull && topBond) {
    verdict = "bond";
    text = `卡池已齐或难组队，建议升 ${bondName} 羁绊（+1 花约 +${formatNumber(bondGain)}）`;
  } else if (topPull && !topBond) {
    text = `优先再抽 ${pullName}（解锁 ${topPull.teamCount ?? 0} 套）`;
  } else if (topPull && topBond) {
    if (bondGain > pullDmg * 0.6 && (topBond.fromBond || 1) < 5) {
      verdict = "bond";
      text = `已持有 UP 时，升 ${bondName} +1 花（约 ${(bondGain / 1e8).toFixed(2)} 亿/花）可能优于再抽 ${pullName}`;
    } else {
      text = `再抽 ${pullName} 优先；若已齐可升 ${bondName}（${(bondGain / 1e8).toFixed(2)} 亿/花）`;
    }
  }
  return { verdict, text, pullName, bondName, pullDmg, bondGain };
}

/** 同 4 人换 1 人的相似配队 */
function findSimilarComps(comp, data, limit = 6) {
  if (!comp?.compstr?.length || !data?.length) return [];
  const setA = new Set(comp.compstr);
  return data
    .filter((c) => c.id !== comp.id && c.compstr?.length === 5)
    .map((c) => {
      const overlap = c.compstr.filter((id) => setA.has(id)).length;
      return { comp: c, overlap, diff: 5 - overlap };
    })
    .filter((x) => x.diff === 1 && x.overlap === 4)
    .sort((a, b) => (b.comp.recommend || 0) - (a.comp.recommend || 0))
    .slice(0, limit)
    .map((x) => x.comp);
}

function renderCompCompareTable(compA, compB, owned) {
  if (!compA || !compB) return "";
  const { idSet, bondMap } = buildOwnedMaps(owned || getOwned());
  const missA = compA.compstr.filter((id) => !idSet.has(id));
  const missB = compB.compstr.filter((id) => !idSet.has(id));
  const row = (label, a, b) =>
    `<tr><td>${escapeHtml(label)}</td><td>${a}</td><td>${b}</td></tr>`;
  const missHtml = (ids) =>
    ids.length
      ? ids.map((id) => escapeHtml(charDisplayName(getCharacter(id)) || id)).join("、")
      : "—";
  return `<table class="comp-compare-table">
    <thead><tr><th></th><th>${escapeHtml(compDisplayName(compA))}</th><th>${escapeHtml(compDisplayName(compB))}</th></tr></thead>
    <tbody>
      ${row("重算伤害", formatNumber(compA.fit13t || 0), formatNumber(compB.fit13t || 0))}
      ${row("官方参考", formatNumber(compA.recommend || 0), formatNumber(compB.recommend || 0))}
      ${row("缺人", String(missA.length), String(missB.length))}
      ${row("缺谁", missHtml(missA), missHtml(missB))}
      ${row("成员", escapeHtml(compA.compstr.map((id) => charDisplayName(getCharacter(id)) || id).join(" · ")), escapeHtml(compB.compstr.map((id) => charDisplayName(getCharacter(id)) || id).join(" · ")))}
    </tbody>
  </table>`;
}

function getTeamBondBottleneck(comp, bondMap) {
  if (!comp?.compstr?.length) return null;
  let minId = comp.compstr[0];
  let minBond = bondMap.get(minId) || 1;
  for (const id of comp.compstr) {
    const b = bondMap.get(id) || 1;
    if (b < minBond) {
      minBond = b;
      minId = id;
    }
  }
  return { charId: minId, bond: minBond, name: charDisplayName(getCharacter(minId)) || minId };
}

if (typeof window !== "undefined") {
  window.smartBannerPullSuggest = smartBannerPullSuggest;
  window.smartRecommend = smartRecommend;
  window.smartInvestAdvice = smartInvestAdvice;
  window.simulatePoolPulls = simulatePoolPulls;
  window.smartBondUpgradeForPool = smartBondUpgradeForPool;
  window.comparePullVsBondAdvice = comparePullVsBondAdvice;
  window.findSimilarComps = findSimilarComps;
  window.renderCompCompareTable = renderCompCompareTable;
  window.getTeamBondBottleneck = getTeamBondBottleneck;
}
