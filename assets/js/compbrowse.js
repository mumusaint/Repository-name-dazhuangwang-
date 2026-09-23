/** 配队列表浏览：本地库加载 + 属性/职业筛选（不依赖完整 compdata 引擎） */
const COMP_BROWSE_URLS = [
  "/api/compdata",
  "../api/compdata",
  "/data/compdata.json",
  "../data/compdata.json",
];

let compBrowseDatabase = null;
let compBrowsePromise = null;

function inflateBrowseBuffer(buffer) {
  const u8 = new Uint8Array(buffer);
  if (typeof pako === "undefined") throw new Error("pako 未加载");
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) return pako.ungzip(u8);
  // 纯 JSON 文本（未压缩，或经 CDN 透明解压后）直接返回
  if (u8.length >= 1 && (u8[0] === 0x7b || u8[0] === 0x5b)) return u8;
  return pako.inflate(u8);
}

async function fetchCompBrowseDatabase(onProgress) {
  if (compBrowseDatabase) return compBrowseDatabase;
  if (compBrowsePromise) return compBrowsePromise;

  compBrowsePromise = (async () => {
    let lastErr = null;
    for (const url of COMP_BROWSE_URLS) {
      try {
        onProgress?.("加载配队库…");
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onProgress?.("解压配队库…");
        const buffer = await res.arrayBuffer();
        const inflated = inflateBrowseBuffer(buffer);
        const json = JSON.parse(new TextDecoder().decode(inflated));
        compBrowseDatabase = json
          .filter((c) => !(c.recommend < 5e9 && c.vote < 2e9))
          .map((c) => ({
            ...c,
            compstr:
              typeof c.compstr === "string"
                ? c.compstr.split(/\s+/).map(Number).filter(Boolean)
                : (c.compstr || []).map(Number).filter(Boolean),
          }))
          .filter((c) => c.compstr.length === 5);
        onProgress?.(`已索引 ${compBrowseDatabase.length.toLocaleString()} 套`);
        return compBrowseDatabase;
      } catch (e) {
        lastErr = e;
        console.warn("配队库加载失败", url, e);
      }
    }
    compBrowsePromise = null;
    throw lastErr || new Error("配队库加载失败");
  })();

  return compBrowsePromise;
}

function normalizeCompstr(comp) {
  if (!comp?.compstr) return [];
  return Array.isArray(comp.compstr)
    ? comp.compstr
    : String(comp.compstr)
        .split(/\s+/)
        .map(Number)
        .filter(Boolean);
}

/** 配队是否匹配属性/职业筛选 */
function compMatchesTeamFilter(comp, { elementSet, roleSet, sameChar = false }) {
  const ids = normalizeCompstr(comp);
  if (!ids.length) return false;
  const chars = ids.map((id) => getCharacter(id)).filter(Boolean);
  if (!chars.length) return false;

  const elSet = elementSet instanceof Set ? elementSet : new Set(elementSet || []);
  const roSet = roleSet instanceof Set ? roleSet : new Set(roleSet || []);

  if (!elSet.size && !roSet.size) return true;

  if (sameChar && elSet.size && roSet.size) {
    return chars.some((ch) => elSet.has(ch.element) && roSet.has(ch.role));
  }

  const hasElement = !elSet.size || chars.some((ch) => elSet.has(ch.element));
  const hasRole = !roSet.size || chars.some((ch) => roSet.has(ch.role));
  return hasElement && hasRole;
}

function filterCompsByTeamTags(comps, filterState) {
  const { elementSet, roleSet, sameChar } = filterState;
  if (!elementSet?.size && !roleSet?.size) return comps;
  return comps.filter((c) => compMatchesTeamFilter(c, { elementSet, roleSet, sameChar }));
}

function sortCompsLocal(comps, sort) {
  const list = [...comps];
  switch (sort) {
    case 0:
      return list.sort((a, b) => (b.ranking || 0) - (a.ranking || 0));
    case 2:
      return list.sort((a, b) => String(b.create_at || "").localeCompare(String(a.create_at || "")));
    case 3:
      return list.sort((a, b) => String(b.update_at || "").localeCompare(String(a.update_at || "")));
    case 4:
      return list.sort((a, b) => (b.vote || 0) - (a.vote || 0));
    default:
      return list.sort((a, b) => (b.recommend || 0) - (a.recommend || 0));
  }
}

function compForRender(comp) {
  return {
    ...comp,
    compstr: Array.isArray(comp.compstr) ? comp.compstr.join(" ") : String(comp.compstr || ""),
  };
}

if (typeof window !== "undefined") {
  window.fetchCompBrowseDatabase = fetchCompBrowseDatabase;
  window.compMatchesTeamFilter = compMatchesTeamFilter;
  window.filterCompsByTeamTags = filterCompsByTeamTags;
  window.sortCompsLocal = sortCompsLocal;
  window.compForRender = compForRender;
}
