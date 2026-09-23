/** 本地用户数据：收藏配队、心愿单、主力队 */
const STORAGE_FAV = "dazhuang_fav_comps";
const STORAGE_WISHLIST = "dazhuang_wishlist";
const STORAGE_PINNED = "dazhuang_pinned_teams";

function _readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function _writeJson(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function getFavComps() {
  const list = _readJson(STORAGE_FAV, []);
  return Array.isArray(list) ? list : [];
}

function isFavComp(id) {
  return getFavComps().some((c) => c.id === id);
}

function toggleFavComp(comp) {
  if (!comp?.id) return false;
  let list = getFavComps();
  const idx = list.findIndex((c) => c.id === comp.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    _writeJson(STORAGE_FAV, list);
    return false;
  }
  list.unshift({
    id: comp.id,
    name: compDisplayName(comp),
    compstr: comp.compstr,
    fit13t: comp.fit13t,
    recommend: comp.recommend,
    savedAt: new Date().toISOString(),
  });
  list = list.slice(0, 50);
  _writeJson(STORAGE_FAV, list);
  return true;
}

function removeFavComp(id) {
  const list = getFavComps().filter((c) => c.id !== id);
  _writeJson(STORAGE_FAV, list);
}

function getWishlist() {
  const list = _readJson(STORAGE_WISHLIST, []);
  return Array.isArray(list) ? list.map(Number).filter(Boolean) : [];
}

function isWishlistChar(id) {
  return getWishlist().includes(Number(id));
}

function toggleWishlistChar(id) {
  id = Number(id);
  if (!id) return false;
  let list = getWishlist();
  const idx = list.indexOf(id);
  if (idx >= 0) {
    list.splice(idx, 1);
    _writeJson(STORAGE_WISHLIST, list);
    return false;
  }
  list.push(id);
  _writeJson(STORAGE_WISHLIST, list);
  return true;
}

function addMissingToWishlist(compIds, owned) {
  const idSet = new Set((owned || getOwned()).map((o) => o.id));
  const missing = (compIds || []).filter((id) => !idSet.has(id));
  let list = getWishlist();
  let added = 0;
  for (const id of missing) {
    if (!list.includes(id)) {
      list.push(id);
      added++;
    }
  }
  _writeJson(STORAGE_WISHLIST, list);
  return { added, missing, total: list.length };
}

function getPinnedTeams() {
  const list = _readJson(STORAGE_PINNED, []);
  return Array.isArray(list) ? list : [];
}

function setPinnedTeams(teams) {
  _writeJson(STORAGE_PINNED, (teams || []).slice(0, 4));
}

function setPinnedTeamsFromSmart(results, pool, parallelCount = 4, batchSort = "batchTotal") {
  if (typeof buildDisjointTeamBatches !== "function" || !results?.length) return [];
  const batches = buildDisjointTeamBatches(results, parallelCount, pool || results, batchSort);
  const batch = batches[0] || [];
  const teams = batch.map((comp) => ({
    id: comp.id,
    name: compDisplayName(comp),
    nameSc: compDisplayName(comp),
    compstr: comp.compstr,
    fit13t: comp.fit13t,
    recommend: comp.recommend,
    bonds: comp.bonds,
    pinnedAt: new Date().toISOString(),
  }));
  setPinnedTeams(teams);
  return teams;
}

/** 将收藏/主力四队中存的韩文队名刷新为简中 */
function migrateUserDataDisplayNames() {
  if (typeof compDisplayName !== "function") return false;

  const refreshEntry = (entry) => {
    if (!entry?.id) return { entry, changed: false };
    const display = compDisplayName(entry);
    if (!display || (entry.nameSc === display && entry.name === display)) {
      return { entry, changed: false };
    }
    return {
      entry: { ...entry, name: display, nameSc: display },
      changed: true,
    };
  };

  let anyChanged = false;

  const favs = getFavComps();
  let favChanged = false;
  const nextFavs = favs.map((e) => {
    const { entry, changed } = refreshEntry(e);
    if (changed) favChanged = true;
    return entry;
  });
  if (favChanged) {
    _writeJson(STORAGE_FAV, nextFavs);
    anyChanged = true;
  }

  const pinned = getPinnedTeams();
  let pinnedChanged = false;
  const nextPinned = pinned.map((e) => {
    const { entry, changed } = refreshEntry(e);
    if (changed) pinnedChanged = true;
    return entry;
  });
  if (pinnedChanged) {
    _writeJson(STORAGE_PINNED, nextPinned);
    anyChanged = true;
  }

  return anyChanged;
}

if (typeof window !== "undefined") {
  window.getFavComps = getFavComps;
  window.isFavComp = isFavComp;
  window.toggleFavComp = toggleFavComp;
  window.removeFavComp = removeFavComp;
  window.getWishlist = getWishlist;
  window.isWishlistChar = isWishlistChar;
  window.toggleWishlistChar = toggleWishlistChar;
  window.addMissingToWishlist = addMissingToWishlist;
  window.getPinnedTeams = getPinnedTeams;
  window.setPinnedTeams = setPinnedTeams;
  window.setPinnedTeamsFromSmart = setPinnedTeamsFromSmart;
  window.migrateUserDataDisplayNames = migrateUserDataDisplayNames;
}
