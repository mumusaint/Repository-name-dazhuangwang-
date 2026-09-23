let sort = 1;

let page = 0;

let rank = 0;

let loading = false;

let ended = false;



const PAGE_SIZE = 30;

const filterElements = new Set();

const filterRoles = new Set();

let sameCharFilter = false;



let localFiltered = null;

let localPage = 0;

let filterMode = false;



document.addEventListener("DOMContentLoaded", () => {

  bootPage({

    activePage: "comps",

    onReady: () => {

      setupCompFilters();

      applyCompUrlFilters();

      if (hasActiveFilters()) reset();

      setupSortDropdown("sortSelect", (s) => {

        sort = s;

        reset();

        loadMore();

      });

      setupInfiniteScroll("loadTrigger", loadMore);

      loadCount();

      loadMore();

    },

  }).catch((e) => console.error("bootPage", e));

});



function hasActiveFilters() {

  return filterElements.size > 0 || filterRoles.size > 0;

}



function applyCompUrlFilters() {

  const params = new URLSearchParams(location.search);

  const el = params.get("element");

  const role = params.get("role");

  if (el != null && el !== "") {

    el.split(",")

      .map(Number)

      .filter((n) => !Number.isNaN(n))

      .forEach((n) => filterElements.add(n));

  }

  if (role != null && role !== "") {

    role.split(",")

      .map(Number)

      .filter((n) => !Number.isNaN(n))

      .forEach((n) => filterRoles.add(n));

  }

  if (params.get("same") === "1") {

    sameCharFilter = true;

    const cb = document.getElementById("sameCharFilter");

    if (cb) cb.checked = true;

  }

  syncFilterChipUI();

  updateFilterHint();

}



function setupCompFilters() {

  document.querySelectorAll("#compFilters .filter-chip[data-group]").forEach((chip) => {

    chip.addEventListener("click", () => {

      const group = chip.dataset.group;

      const value = chip.dataset.value;

      if (group === "element") {

        if (value === "all") filterElements.clear();

        else {

          const v = Number(value);

          if (filterElements.has(v)) filterElements.delete(v);

          else filterElements.add(v);

        }

      } else if (group === "role") {

        if (value === "all") filterRoles.clear();

        else {

          const v = Number(value);

          if (filterRoles.has(v)) filterRoles.delete(v);

          else filterRoles.add(v);

        }

      } else if (group === "preset") {

        applyFilterPreset(value);

      }

      syncFilterChipUI();

      updateFilterHint();

      syncUrlFromFilters();

      reset();

      loadMore();

    });

  });



  document.getElementById("sameCharFilter")?.addEventListener("change", (e) => {

    sameCharFilter = e.target.checked;

    syncUrlFromFilters();

    reset();

    loadMore();

  });



  document.getElementById("clearCompFilters")?.addEventListener("click", () => {

    filterElements.clear();

    filterRoles.clear();

    sameCharFilter = false;

    const cb = document.getElementById("sameCharFilter");

    if (cb) cb.checked = false;

    syncFilterChipUI();

    updateFilterHint();

    history.replaceState(null, "", location.pathname);

    reset();

    loadCount();

    loadMore();

  });

}



function applyFilterPreset(id) {

  filterElements.clear();

  filterRoles.clear();

  sameCharFilter = false;

  const cb = document.getElementById("sameCharFilter");

  if (cb) cb.checked = false;

  const presets = {

    fire: { el: [0] },

    water: { el: [1] },

    wind: { el: [2] },

    light: { el: [3] },

    dark: { el: [4] },

    "water-support": { el: [1], role: [3], same: true },

    "fire-dps": { el: [0], role: [0], same: true },

  };

  const p = presets[id];

  if (!p) return;

  (p.el || []).forEach((n) => filterElements.add(n));

  (p.role || []).forEach((n) => filterRoles.add(n));

  if (p.same) {

    sameCharFilter = true;

    if (cb) cb.checked = true;

  }

}



function syncFilterChipUI() {

  document.querySelectorAll('#compFilters .filter-chip[data-group="element"]').forEach((chip) => {

    if (chip.dataset.value === "all") {

      chip.classList.toggle("active", filterElements.size === 0);

    } else {

      chip.classList.toggle("active", filterElements.has(Number(chip.dataset.value)));

    }

  });

  document.querySelectorAll('#compFilters .filter-chip[data-group="role"]').forEach((chip) => {

    if (chip.dataset.value === "all") {

      chip.classList.toggle("active", filterRoles.size === 0);

    } else {

      chip.classList.toggle("active", filterRoles.has(Number(chip.dataset.value)));

    }

  });

}



function updateFilterHint() {

  const el = document.getElementById("filterHint");

  if (!el) return;

  if (!hasActiveFilters()) {

    el.textContent = "未筛选 · 滚动加载社区排行（在线分页）";

    return;

  }

  const parts = [];

  if (filterElements.size) {

    parts.push(

      "含属性 " +

        [...filterElements].map((i) => ELEMENTS[i] || i).join("/")

    );

  }

  if (filterRoles.size) {

    parts.push(

      "含职业 " + [...filterRoles].map((i) => ROLES[i] || i).join("/")

    );

  }

  if (sameCharFilter && filterElements.size && filterRoles.size) {

    parts.push("同一角色");

  }

  el.textContent = parts.join(" · ") + " · 本地库筛选";

}



function syncUrlFromFilters() {

  if (!hasActiveFilters() && !sameCharFilter) {

    history.replaceState(null, "", location.pathname);

    return;

  }

  const q = new URLSearchParams();

  if (filterElements.size) q.set("element", [...filterElements].join(","));

  if (filterRoles.size) q.set("role", [...filterRoles].join(","));

  if (sameCharFilter) q.set("same", "1");

  history.replaceState(null, "", `${location.pathname}?${q.toString()}`);

}



function reset() {

  page = 0;

  localPage = 0;

  rank = 0;

  ended = false;

  localFiltered = null;

  filterMode = hasActiveFilters();

  document.getElementById("compList").innerHTML = "";

}



async function loadCount() {

  const countEl = document.getElementById("compCount");

  if (hasActiveFilters()) return;

  try {

    const res = await fetchCompCount();

    if (res.success) {

      countEl.textContent = `共 ${res.data.toLocaleString()} 套配队`;

    }

  } catch {

    countEl.textContent = "配队总数加载失败";

  }

}



async function ensureLocalFiltered() {

  if (localFiltered) return localFiltered;

  await fetchCompDatabase((msg) => {

    document.getElementById("compCount").textContent = msg;

  });

  const all = (compDatabase || []).filter((c) => Array.isArray(c.compstr) && c.compstr.length === 5);

  const filtered = filterCompsByTeamTags(all, {

    elementSet: filterElements,

    roleSet: filterRoles,

    sameChar: sameCharFilter,

  });

  localFiltered = sortCompsLocal(filtered, sort);

  document.getElementById("compCount").textContent = `筛选 ${localFiltered.length.toLocaleString()} 套 · 库内 ${all.length.toLocaleString()} 套`;

  return localFiltered;

}



async function loadMore() {

  if (loading || ended) return;

  loading = true;

  const list = document.getElementById("compList");



  if (filterMode) {

    if (localPage === 0) list.innerHTML = renderSkeletonCards(6);

    try {

      const data = await ensureLocalFiltered();

      if (localPage === 0) list.innerHTML = "";

      const start = localPage * PAGE_SIZE;

      const items = data.slice(start, start + PAGE_SIZE);

      if (!items.length && localPage === 0) {

        list.innerHTML = renderEmptyState({

          icon: "🔍",

          title: "无匹配配队",

          desc: "试试减少筛选条件，或取消「同一角色」限制。",

        });

        ended = true;

        return;

      }

      const html = items

        .map((comp) => {

          rank++;

          return renderCompCard(compForRender(comp), sort, rank);

        })

        .join("");

      list.insertAdjacentHTML("beforeend", html);

      bindCompCardClicks(list, (id) => {

        location.href = `../comp/index.html?id=${id}`;

      });

      localPage++;

      if (start + PAGE_SIZE >= data.length) ended = true;

    } catch (e) {

      if (localPage === 0) {

        list.innerHTML = renderEmptyState({

          icon: "⚠️",

          title: "筛选加载失败",

          desc: formatErrorMessage(e),

        });

      }

      ended = true;

    } finally {

      loading = false;

    }

    return;

  }



  if (page === 0) list.innerHTML = renderSkeletonCards(6);



  try {

    const res = await fetchCompList(sort, page);

    if (!res.success) throw new Error(res.msg || "加载失败");

    const items = res.data?.content || [];

    if (page === 0) list.innerHTML = "";

    if (items.length === 0) {

      ended = true;

      if (rank === 0) {

        list.innerHTML = renderEmptyState({

          icon: "📋",

          title: "暂无配队数据",

          desc: "请确认已运行本地服务（python server.py）",

        });

      }

      return;

    }

    const html = items

      .map((comp) => {

        rank++;

        return renderCompCard(comp, sort, rank);

      })

      .join("");

    list.insertAdjacentHTML("beforeend", html);

    bindCompCardClicks(list, (id) => {

      location.href = `../comp/index.html?id=${id}`;

    });

    page++;

  } catch (e) {

    if (page === 0) {

      list.innerHTML = renderEmptyState({

        icon: "⚠️",

        title: "加载失败",

        desc: `${formatErrorMessage(e)}。请运行本地服务（python server.py，含接口代理）。`,

      });

    }

    ended = true;

  } finally {

    loading = false;

  }

}

