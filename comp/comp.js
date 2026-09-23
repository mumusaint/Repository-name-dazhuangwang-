let compData = null;
let compIds = [];
let command = "";
let compBossGuide = null;

document.addEventListener("DOMContentLoaded", () => {
  bootCompPage().catch((e) => showCompError(e));
});

async function bootCompPage() {
  renderHeader("comps");
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const bondParam = params.get("bond");
  const bossId = params.get("boss");
  if (bossId) {
    try {
      await fetchBossGuides();
      compBossGuide = getBossGuide(bossId);
    } catch {
      /* optional */
    }
  }
  if (!id) {
    document.getElementById("compTitle").textContent = "缺少配队编号";
    document.getElementById("commandBox").innerHTML =
      `<span class="empty-hint">请在 URL 中指定 ?id=配队编号</span>`;
    return;
  }

  setCompLoading(id);

  const detailPromise = fetchCompDetail(id);
  await Promise.all([
    loadCharacters(),
    typeof initAccounts === "function" ? initAccounts() : Promise.resolve(),
  ]);

  const res = await detailPromise;
  if (!res.success || !res.data) throw new Error(res.msg || "加载失败");

  compData = res.data;
  compIds = String(compData.compstr || "")
    .split(/\s+/)
    .map(Number)
    .filter(Boolean);
  if (compIds.length !== 5) throw new Error("配队角色数据不完整");
  command = compData.description || "";
  await render(bondParam);
  renderCompBossBanner();
}

function renderCompBossBanner() {
  if (!compBossGuide) return;
  const title = document.getElementById("compTitle");
  if (!title?.parentElement) return;
  let bar = document.getElementById("compBossBanner");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "compBossBanner";
    bar.className = "notice";
    title.parentElement.after(bar);
  }
  bar.innerHTML = `
    来自 Boss 配队：<strong>${escapeHtml(compBossGuide.nameSc)}</strong>
    ${renderBossElementTag(compBossGuide.bossElement)}
    ${renderBossWeakTag(compBossGuide.weakToElement)}
    · <a href="${siteUrl(`boss/index.html?id=${compBossGuide.id}`)}" style="color:var(--accent)">返回 Boss 列表</a>`;
}

function getCompCalcOptions() {
  if (compBossGuide?.bossElement >= 0) {
    return { bossElement: compBossGuide.bossElement };
  }
  return {};
}

function setCompLoading(id) {
  document.getElementById("compTitle").textContent = `配队 #${id}`;
  document.getElementById("commandBox").innerHTML =
    `<span class="empty-hint">正在加载出招顺序…</span>`;
  document.getElementById("compDeck").innerHTML = renderCompDetailSkeleton();
  document.getElementById("dmg13").textContent = "…";
  document.getElementById("dmg131").textContent = "…";
  document.getElementById("scarecrow").textContent = "…";
  document.getElementById("calcDmg").textContent = "…";
}

function showCompError(e) {
  document.getElementById("compTitle").textContent = "加载失败";
  document.getElementById("commandBox").innerHTML =
    `<span class="empty-hint">${escapeHtml(formatErrorMessage(e))}<br>请运行 <code>python server.py</code> 并确保已缓存配队库（data/compdata.json）</span>`;
}

function defaultBonds(bondParam) {
  const fromParam = getBondsFromParam(bondParam);
  if (fromParam?.length === 5) return fromParam;
  const owned = typeof getOwned === "function" ? getOwned() : [];
  const bondMap = new Map(owned.map((o) => [o.id, o.bond || 1]));
  if (bondMap.size) {
    return compIds.map((cid) => bondMap.get(cid) ?? 5);
  }
  return Array(5).fill(5);
}

async function render(bondParam) {
  document.getElementById("compTitle").textContent = compDisplayName(compData);
  document.getElementById("dmg13").textContent = formatNumber(compData.recommend);
  document.getElementById("dmg131").textContent = formatNumber(compData.vote);
  document.getElementById("scarecrow").textContent = compData.ranking
    ? Math.round(compData.ranking) + " 回合"
    : "-";

  document.getElementById("commandBox").innerHTML =
    command && command.length > 10
      ? formatCommandHtml(command, compIds, true)
      : '<span class="empty-hint">无出招顺序</span>';

  document.getElementById("metaInfo").innerHTML = `
    创建：${escapeHtml(compData.create_at || "-")} · ${escapeHtml(compData.creator || "-")}<br>
    更新：${escapeHtml(compData.update_at || "-")} · ${escapeHtml(compData.updater || "-")}<br>
    编号：${compData.id}
  `;

  const bonds = defaultBonds(bondParam);
  document.getElementById("compDeck").innerHTML = `<div class="comp-deck">${renderDeckWithSlots(
    compIds,
    bonds
  )}</div>`;

  document.getElementById("bondRow").innerHTML = compIds
    .map((cid, i) => {
      const ch = getCharacter(cid);
      const n = charDisplayName(ch) || cid;
      const val = bonds[i] ?? 5;
      return `<label style="font-size:0.85rem"><span style="color:var(--accent)">${i + 1}号</span> ${escapeHtml(n)}<br><input type="number" class="bond-input" id="bond${i}" value="${val}" min="1" max="5" onchange="recalc()"></label>`;
    })
    .join("");

  await recalc();
  renderBondCompare(bonds);
  await loadSimilarComps();
  updateWishlistBtn();
}

function updateWishlistBtn() {
  const btn = document.getElementById("wishlistBtn");
  if (!btn || !compIds.length) return;
  const missing = compIds.filter((id) => !getOwned().some((o) => o.id === id));
  if (!missing.length) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "inline-flex";
  const onWish = missing.some((id) => isWishlistChar(id));
  btn.textContent = onWish ? "★ 已在心愿单" : "☆ 缺人加心愿";
}

function toggleCompWishlist() {
  const missing = compIds.filter((id) => !getOwned().some((o) => o.id === id));
  if (!missing.length) return;
  missing.forEach((id) => {
    if (!isWishlistChar(id)) toggleWishlistChar(id);
  });
  showToast("缺人已加入心愿单", "success");
  updateWishlistBtn();
}

function addMissingWishlist() {
  const r = addMissingToWishlist(compIds, getOwned());
  showToast(r.added ? `已加入 ${r.added} 名缺人` : "无缺人可加入", r.added ? "success" : "info");
  updateWishlistBtn();
}

function goSmartMustInclude() {
  const ids = compIds.join(",");
  location.href = `${siteUrl("smart/index.html")}?must=${ids}`;
}

async function renderBondCompare(currentBonds) {
  const el = document.getElementById("bondCompareRow");
  if (!el || typeof CalcEngine === "undefined") return;
  await CalcEngine.waitUntilReady();
  const owned = getOwned();
  const bondMap = new Map(owned.map((o) => [o.id, o.bond || 1]));
  const myBonds = compIds.map((id) => bondMap.get(id) ?? currentBonds[compIds.indexOf(id)] ?? 1);
  const maxBonds = Array(5).fill(5);
  let myDmg = "—";
  let maxDmg = "—";
  if (command?.length > 10) {
    const myRes = CalcEngine.runPreciseCalc(compIds, command, myBonds);
    const maxRes = CalcEngine.runPreciseCalc(compIds, command, maxBonds);
    myDmg = myRes.valid ? formatNumber(myRes.dmg13) : "—";
    maxDmg = maxRes.valid ? formatNumber(maxRes.dmg13) : "—";
  }
  el.innerHTML = `
    <div class="bond-compare-card">
      <div class="bond-compare-label">我的羁绊</div>
      <div class="bond-compare-dmg">${myDmg}</div>
      <div class="comp-deck">${renderDeckWithSlots(compIds, myBonds)}</div>
    </div>
    <div class="bond-compare-card bond-compare-max">
      <div class="bond-compare-label">满羁绊 (5花)</div>
      <div class="bond-compare-dmg">${maxDmg}</div>
      <div class="comp-deck">${renderDeckWithSlots(compIds, maxBonds)}</div>
    </div>`;
}

async function loadSimilarComps() {
  const sec = document.getElementById("similarSection");
  const list = document.getElementById("similarList");
  if (!sec || !list || typeof findSimilarComps !== "function") return;
  try {
    const data = await fetchCompDatabase();
    const similar = findSimilarComps({ id: compData.id, compstr: compIds }, data, 6);
    if (!similar.length) return;
    sec.style.display = "block";
    list.innerHTML = similar
      .map(
        (c) => `<a class="similar-comp-row" href="${siteUrl(`comp/index.html?id=${c.id}`)}">
          <strong>${escapeHtml(compDisplayName(c))}</strong>
          <span class="stat-muted">${formatNumber(c.recommend || 0)}</span>
        </a>`
      )
      .join("");
  } catch {
    /* optional */
  }
}

function getBondsFromParam(bondParam) {
  if (!bondParam) return null;
  const arr = bondParam.split(",").map(Number);
  return arr.length === 5 ? arr : null;
}

function getBonds() {
  return compIds.map((_, i) => {
    const el = document.getElementById(`bond${i}`);
    return Number(el?.value) || 5;
  });
}

async function recalc() {
  const el = document.getElementById("calcDmg");
  if (!command || command.length < 10) {
    el.textContent = "无序列";
    return;
  }
  if (typeof CalcEngine === "undefined") {
    el.textContent = "引擎未加载";
    return;
  }
  el.textContent = "计算中…";
  try {
    await CalcEngine.waitUntilReady();
    const result = CalcEngine.runPreciseCalc(compIds, command, getBonds(), getCompCalcOptions());
    el.textContent = result.valid
      ? formatNumber(result.dmg13)
      : result.error || "计算错误";
    renderBondCompare(getBonds());
  } catch (e) {
    el.textContent = formatErrorMessage(e);
  }
}

function goCalc() {
  const bonds = getBonds().join(",");
  const q = new URLSearchParams({ comp: compData.id, bond: bonds });
  if (compBossGuide?.id) q.set("boss", compBossGuide.id);
  if (compBossGuide?.bossElement >= 0) q.set("bossEl", compBossGuide.bossElement);
  location.href = `${siteUrl("calc/index.html")}?${q.toString()}`;
}

function addCompToTeam() {
  if (!compIds.length) return;
  const bonds = getBonds();
  setTeam(compIds.map((id, i) => ({ id, bond: bonds[i] || 5 })));
  showToast(`已加入编队：${compDisplayName(compData)}`, "success", 2500);
}

function copyCommand() {
  copyCommandText(command, compIds);
}
