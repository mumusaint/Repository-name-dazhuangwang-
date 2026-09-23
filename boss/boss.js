let currentBoss = null;
let bossComps = [];
let bossPage = 0;
let bossRank = 0;
let bossSort = 1;
let loading = false;
let ended = false;
const BOSS_PAGE_SIZE = 30;

document.addEventListener("DOMContentLoaded", () => {
  bootPage({
    activePage: "boss",
    onReady: initBossPage,
  }).catch((e) => {
    showToast(formatErrorMessage(e), "error");
  });
});

async function initBossPage() {
  await Promise.all([fetchBossGuides(), loadStageOverlay()]);
  renderBossNav();
  setupBossSort();
  document.getElementById("bossSearch")?.addEventListener("input", renderBossNav);
  setupInfiniteScroll("bossLoadTrigger", loadBossComps);

  const id = new URLSearchParams(location.search).get("id") || "scarecrow";
  selectBoss(id);
}

function setupBossSort() {
  setupSortDropdown("bossSortSelect", (s) => {
    bossSort = s;
    if (currentBoss) reloadBossComps();
  });
}

function renderBossNav() {
  const el = document.getElementById("bossNav");
  if (!el) return;
  const q = (document.getElementById("bossSearch")?.value || "").trim().toLowerCase();
  const cats = getBossCategories();
  const bosses = getAllBosses();

  el.innerHTML = cats
    .map((cat) => {
      const list = bosses.filter(
        (b) =>
          b.category === cat.id &&
          (!q || (b.nameSc || "").toLowerCase().includes(q) || b.id.includes(q))
      );
      if (!list.length) return "";
      return `<div class="boss-nav-group">
        <div class="boss-nav-cat">${escapeHtml(cat.nameSc)}</div>
        ${list
          .map(
            (b) =>
              `<button type="button" class="boss-nav-item${currentBoss?.id === b.id ? " active" : ""}" onclick="selectBoss('${b.id}')">${escapeHtml(b.nameSc)}</button>`
          )
          .join("")}
      </div>`;
    })
    .join("");
}

function selectBoss(id) {
  const boss = getBossGuide(id);
  if (!boss) {
    showToast("未找到该 Boss 攻略", "error");
    return;
  }
  currentBoss = boss;
  bossSort = getBossSortValue(boss);
  const sel = document.getElementById("bossSortSelect");
  if (sel) sel.value = String(bossSort);

  history.replaceState(null, "", `${location.pathname}?id=${boss.id}`);
  renderBossNav();
  renderBossDetail();
  reloadBossComps();
}

function renderBossDetail() {
  const panel = document.getElementById("bossDetail");
  if (!currentBoss || !panel) return;
  panel.style.display = "block";

  document.getElementById("bossTitle").textContent = currentBoss.nameSc;
  document.getElementById("bossNotes").textContent = currentBoss.notesSc || "";
  document.getElementById("bossTags").innerHTML = [
    renderBossElementTag(currentBoss.bossElement),
    renderBossWeakTag(currentBoss.weakToElement),
    `<span class="smart-tag">${({ 0: "木椿存活", 1: "13回合5羁绊", 4: "13回合1羁绊" })[bossSort] || "排序"}</span>`,
  ]
    .filter(Boolean)
    .join("");

  const stageLine = document.getElementById("bossStageLine");
  if (stageLine) {
    const html = renderBossStageLine(currentBoss);
    stageLine.innerHTML = html;
    stageLine.style.display = html ? "flex" : "none";
  }

  const core = renderBossCoreChars(currentBoss);
  const coreBar = document.getElementById("bossCoreBar");
  coreBar.innerHTML = core
    ? `<span style="font-size:0.78rem;color:var(--text-muted);margin-right:0.35rem">核心参考</span>${core}`
    : `<span class="empty-hint">无指定核心，展示社区高配通用队</span>`;

  document.getElementById("bossSmartBtn").href = bossSmartUrl(currentBoss);
}

function reloadBossComps() {
  bossComps = [];
  bossPage = 0;
  bossRank = 0;
  ended = false;
  document.getElementById("bossCompList").innerHTML = "";
  loadBossComps();
}

async function loadBossComps() {
  if (loading || ended || !currentBoss) return;
  loading = true;
  const list = document.getElementById("bossCompList");

  if (bossPage === 0) {
    list.innerHTML = renderSkeletonCards(6);
    document.getElementById("bossCount").textContent = "匹配配队中…";
  }

  try {
    if (!bossComps.length) {
      await fetchCompBrowseDatabase((msg) => {
        document.getElementById("bossCount").textContent = msg;
      });
      const all = await fetchCompBrowseDatabase();
      bossComps = filterCompsForBoss(all, currentBoss);
      bossComps = sortCompsLocal(bossComps, bossSort);
      document.getElementById("bossCount").textContent = `匹配 ${bossComps.length.toLocaleString()} 套`;
    }

    if (bossPage === 0) list.innerHTML = "";

    const start = bossPage * BOSS_PAGE_SIZE;
    const slice = bossComps.slice(start, start + BOSS_PAGE_SIZE);

    if (!slice.length && bossPage === 0) {
      list.innerHTML = renderEmptyState({
        icon: "👹",
        title: "暂无匹配配队",
        desc: "可在 boss_guides.json 添加 featuredCompIds，或放宽 coreCharIds / minCoreMatch。",
        actionLabel: "浏览全部配队",
        actionHref: siteUrl("comps/index.html"),
      });
      ended = true;
      return;
    }

    const html = slice
      .map((comp) => {
        bossRank++;
        return renderCompCard(compForRender(comp), bossSort, bossRank);
      })
      .join("");

    list.insertAdjacentHTML("beforeend", html);
    bindCompCardClicks(list, (id) => {
      location.href = `${siteUrl("comp/index.html")}?id=${id}&boss=${currentBoss.id}`;
    });

    bossPage++;
    if (start + BOSS_PAGE_SIZE >= bossComps.length) ended = true;
  } catch (e) {
    if (bossPage === 0) {
      list.innerHTML = renderEmptyState({
        icon: "⚠️",
        title: "加载失败",
        desc: formatErrorMessage(e),
      });
    }
    ended = true;
  } finally {
    loading = false;
  }
}
