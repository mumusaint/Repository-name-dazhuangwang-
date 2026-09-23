const BOSS_MAX_HP = 10854389981;
const MAX_TURN = 13;
const ACTIONS_PER_TURN = 5;

const sim = {
  team: [],
  turn: 1,
  actionIndex: 0,
  bossHp: BOSS_MAX_HP,
  totalDmg: 0,
  turn13Dmg: 0,
  scarecrowTurn: null,
  finished: false,
  cds: [],
  dmgBreakdown: { normal: 0, ult: 0, dot: 0, extra: 0 },
  log: [],
  mode: "simple",
  command: null,
  compIds: null,
  bonds: null,
  bossElement: -1,
  bossId: null,
};

document.addEventListener("DOMContentLoaded", async () => {
  renderHeader("calc");
  try {
    if (typeof initAccounts === "function") {
      await initAccounts();
      if (typeof renderAccountBadge === "function") renderAccountBadge();
    }
    await loadCharacters();
  } catch (e) {
    showCalcBootError(e);
    return;
  }

  const params = new URLSearchParams(location.search);
  const compId = params.get("comp");
  const bondParam = params.get("bond");
  const isLocal = params.get("local") === "1";
  sim.bossId = params.get("boss");
  const bossEl = params.get("bossEl");
  if (bossEl != null && bossEl !== "") sim.bossElement = Number(bossEl);

  if (isLocal) {
    await initFromLocalComp(bondParam);
  } else if (compId) {
    await initFromComp(compId, bondParam);
  } else {
    initFromTeam();
  }
});

function showPreciseBootError(e) {
  document.getElementById("modeNotice").innerHTML =
    `<strong style="color:var(--danger)">精确模式加载失败</strong>：${formatErrorMessage(e)}` +
    `<p style="margin-top:0.75rem;font-size:0.9rem">` +
    `<a href="${siteUrl("smart/index.html")}" style="color:var(--accent)">返回智能打桩</a> · ` +
    `<a href="${siteUrl("comps/index.html")}" style="color:var(--accent)">浏览配队</a> · ` +
    `<a href="${siteUrl("team/index.html")}" style="color:var(--accent)">手动编队</a>` +
    `</p>`;
  document.getElementById("precisePanel").style.display = "none";
  const simLayout = document.querySelector(".sim-layout");
  if (simLayout) simLayout.style.display = "none";
}

function showCalcBootError(e) {
  document.querySelector(".main-container").innerHTML = `
    <div class="block-header">
      <h1 class="page-title" style="margin:0">打桩模拟</h1>
    </div>
    ${renderEmptyState({
      icon: "⚠️",
      title: "页面加载失败",
      desc: `${formatErrorMessage(e)}。请在本项目目录运行 python server.py 后刷新。`,
      actionLabel: "返回首页",
      actionHref: siteUrl("index.html"),
    })}`;
}

async function initFromLocalComp(bondParam) {
  sim.mode = "precise";
  document.getElementById("modeNotice").textContent =
    "精确模式（本地配队）：借用相似社区出招顺序重算，新角色技能未收录时结果可能偏低。";

  try {
    const raw = sessionStorage.getItem("dazhuang_local_comp");
    if (!raw) throw new Error("本地配队数据已过期，请从智能打桩重新进入");
    const comp = JSON.parse(raw);
    sim.compIds = comp.compstr.map(Number);
    sim.command = comp.description;
    sim.bonds = bondParam
      ? bondParam.split(",").map(Number)
      : comp.bonds || Array(5).fill(5);

    sim.team = sim.compIds.map((id, i) => ({
      ...getCharacter(id),
      bond: sim.bonds[i] || 5,
      cdLeft: 0,
    }));

    document.getElementById("precisePanel").style.display = "block";
    document.getElementById("officialDmg").textContent = "-";
    document.getElementById("preciseScarecrow").textContent = "-";
    document.getElementById("commandPreview").innerHTML =
      sim.command && sim.command.length > 10
        ? formatCommandHtml(sim.command, sim.compIds, true)
        : '<span class="empty-hint">无出招顺序</span>';
    document.getElementById("preciseDeck").innerHTML = renderDeckWithSlots(sim.compIds, sim.bonds);

    runPreciseCalc(0);
    setTeam(sim.compIds.map((id, i) => ({ id, bond: sim.bonds[i] })));
    addLog(`已加载本地配队：${compDisplayName(comp)}`);
    renderUI();
  } catch (e) {
    showPreciseBootError(e);
  }
}

async function initFromComp(compId, bondParam) {
  sim.mode = "precise";
  document.getElementById("modeNotice").textContent =
    "精确模式：官方计算引擎，按你的羁绊重算 13 回合伤害（含全体受击）。";

  try {
    const res = await fetchCompDetail(compId);
    if (!res.success) throw new Error(res.msg || "加载配队失败");
    const comp = res.data;
    sim.compIds = comp.compstr.split(" ").map(Number);
    sim.command = comp.description;
    sim.bonds = bondParam
      ? bondParam.split(",").map(Number)
      : Array(5).fill(5);

    sim.team = sim.compIds.map((id, i) => ({
      ...getCharacter(id),
      bond: sim.bonds[i] || 5,
      cdLeft: 0,
    }));

    document.getElementById("precisePanel").style.display = "block";
    document.getElementById("officialDmg").textContent = formatNumber(comp.recommend);
    document.getElementById("preciseScarecrow").textContent =
      comp.ranking ? Math.round(comp.ranking) + " 回合" : "-";
    document.getElementById("commandPreview").innerHTML =
      sim.command && sim.command.length > 10
        ? formatCommandHtml(sim.command, sim.compIds, true)
        : '<span class="empty-hint">无出招顺序</span>';
    document.getElementById("preciseDeck").innerHTML = renderDeckWithSlots(sim.compIds, sim.bonds);

    runPreciseCalc(comp.recommend);
    setTeam(sim.compIds.map((id, i) => ({ id, bond: sim.bonds[i] })));
    addLog(`已加载配队编号 ${compId}：${compDisplayName(comp)}`);
    renderUI();
  } catch (e) {
    showPreciseBootError(e);
  }
}

function runPreciseCalc(officialDmg) {
  if (!sim.command || sim.command.length < 10) {
    document.getElementById("preciseDmg").textContent = "无法计算";
    return;
  }
  const result = CalcEngine.runPreciseCalc(sim.compIds, sim.command, sim.bonds, {
    bossElement: sim.bossElement,
  });
  if (!result.valid) {
    const est = officialDmg
      ? CalcEngine.estimateDmgFromOfficial(officialDmg, sim.bonds)
      : 0;
    if (est > 0) {
      document.getElementById("preciseDmg").textContent = `≈ ${formatNumber(est)}（羁绊估算）`;
      sim.turn13Dmg = est;
      sim.totalDmg = est;
      sim.finished = true;
      addLog(
        `精确重算不可用（${result.error || "未知"}），已按官方参考估算：≈ ${formatNumber(est)}`
      );
      return;
    }
    document.getElementById("preciseDmg").textContent = result.error || "无法计算";
    addLog(`精确重算失败：${result.error || "未知错误"}`);
    return;
  }
  document.getElementById("preciseDmg").textContent = formatNumber(result.dmg13);
  sim.turn13Dmg = result.dmg13;
  sim.totalDmg = result.dmg13;
  sim.finished = true;
  addLog(`精确重算：${formatNumber(result.dmg13)}（官方 ${formatNumber(officialDmg)}）${sim.bossElement >= 0 ? ` · Boss 属性 ${ELEMENTS[sim.bossElement] || sim.bossElement}` : ""}`);
}

function initFromTeam() {
  const raw = getTeam();
  if (raw.length < 5) {
    document.querySelector(".main-container").innerHTML = `
      ${renderEmptyState({
        icon: "👥",
        title: "请先组建 5 人队伍",
        desc: "打桩模拟需要完整编队。推荐使用智能打桩获取社区配队与出招顺序。",
        actionLabel: "去智能打桩",
        actionHref: siteUrl("smart/index.html"),
      })}
      <p style="text-align:center;margin-top:1rem;font-size:0.85rem">
        或 <a href="${siteUrl("team/index.html")}" style="color:var(--accent)">手动编队</a>
        · <a href="${siteUrl("comps/index.html")}" style="color:var(--accent)">浏览配队</a>
      </p>`;
    return;
  }
  sim.mode = "simple";
  document.getElementById("modeNotice").innerHTML =
    "当前为<strong>简化估算</strong>，与官方伤害差距较大。请使用" +
    `<a href="${siteUrl("smart/index.html")}" style="color:var(--accent)">智能打桩</a>推荐配队，` +
    "或从配队详情进入<strong>精确打桩</strong>。";
  sim.team = raw.slice(0, 5).map((s) => ({
    ...getCharacter(s.id),
    bond: s.bond || 1,
    cdLeft: 0,
  }));
  sim.cds = sim.team.map(() => 0);
  addLog("打桩开始 — 13 回合 × 5 行动（简化引擎）");
  applySimpleModeUI();
  renderUI();
}

function applySimpleModeUI() {
  document.getElementById("modeNotice").classList.add("notice-warn");
  const autoBtn = document.getElementById("autoBtn");
  if (autoBtn) {
    autoBtn.disabled = true;
    autoBtn.title = "简化模式不支持逐步模拟，请使用精确打桩";
  }
  const ap = document.getElementById("actionPanel");
  if (ap) {
    ap.innerHTML =
      `<p class="empty-hint" style="padding:0.75rem">` +
      `此处为<strong>占位演示</strong>，不含社区出招顺序，伤害为随机估算。` +
      `请通过 <a href="${siteUrl("smart/index.html")}" style="color:var(--accent)">智能打桩</a> ` +
      `或配队详情进入<strong>精确打桩</strong>。</p>`;
  }
}

function bondMultiplier(bond) {
  return 1 + (bond - 1) * 0.08;
}

function calcNormalDmg(ch) {
  const base = ch.atk * (ch.atkMag / 100) * bondMultiplier(ch.bond);
  return Math.round(base * (0.95 + Math.random() * 0.1));
}

function calcUltDmg(ch) {
  if (!ch.ultMag) return 0;
  const base = ch.atk * (ch.ultMag / 100) * bondMultiplier(ch.bond) * 1.2;
  return Math.round(base * (0.98 + Math.random() * 0.04));
}

function getActiveCharIndex() {
  return sim.actionIndex % ACTIONS_PER_TURN;
}

function renderUI() {
  renderBossBar();
  renderStats();
  renderCharStatus();
  renderActions();
  renderBreakdown();
}

function renderBossBar() {
  const pct = Math.max(0, (sim.bossHp / BOSS_MAX_HP) * 100);
  document.getElementById("bossBarFill").style.width = pct + "%";
  document.getElementById("bossHpText").textContent = formatNumber(sim.bossHp);
}

function renderStats() {
  document.getElementById("turnDisplay").textContent = sim.finished ? "结束" : sim.turn;
  document.getElementById("totalDmg").textContent = formatNumber(sim.totalDmg);
  document.getElementById("turn13Dmg").textContent = formatNumber(sim.turn13Dmg);
  document.getElementById("scarecrowTurn").textContent =
    sim.scarecrowTurn != null ? sim.scarecrowTurn : "-";
}

function renderCharStatus() {
  const active = getActiveCharIndex();
  document.getElementById("charStatus").innerHTML = sim.team
    .map((ch, i) => {
      const name = charDisplayName(ch);
      const cdPct = ch.cd > 0 ? ((ch.cd - sim.cds[i]) / ch.cd) * 100 : 100;
      return `<div class="char-status ${i === active && !sim.finished ? "active" : ""}">
        <img src="${charImageUrl(ch.id)}" alt="${name}">
        <div style="flex:1">
          <div style="font-size:0.85rem">${i + 1}. ${name} · 羁绊${ch.bond}</div>
          <div class="cd-bar"><div class="cd-fill" style="width:${Math.max(0, cdPct)}%"></div></div>
        </div>
      </div>`;
    })
    .join("");
}

function renderActions() {
  const panel = document.getElementById("actionPanel");
  if (sim.mode === "precise" && sim.finished) {
    panel.innerHTML = `<button class="action-btn" disabled>精确模式已完成重算</button>`;
    return;
  }
  if (sim.finished) {
    panel.innerHTML = `<button class="action-btn" disabled>模拟已结束</button>`;
    return;
  }
  const idx = getActiveCharIndex();
  const ch = sim.team[idx];
  const name = charDisplayName(ch);
  const canUlt = sim.cds[idx] <= 0 && ch.ultMag > 0;
  panel.innerHTML = `
    <button class="action-btn" onclick="doAction('normal')">${name} · 普攻</button>
    <button class="action-btn ult" onclick="doAction('ult')" ${canUlt ? "" : "disabled"}>${name} · 必杀</button>
    <button class="action-btn" onclick="doAction('defend')">${name} · 防御</button>
  `;
}

function renderBreakdown() {
  const d = sim.dmgBreakdown;
  document.getElementById("dmgBreakdown").innerHTML = `
    普攻：<strong style="color:var(--text)">${formatNumber(d.normal)}</strong><br>
    必杀：<strong style="color:var(--text)">${formatNumber(d.ult)}</strong><br>
    持续：<strong style="color:var(--text)">${formatNumber(d.dot)}</strong><br>
    追加：<strong style="color:var(--text)">${formatNumber(d.extra)}</strong>
  `;
  document.getElementById("logPanel").innerHTML = sim.log
    .slice().reverse()
    .map((e) => `<div class="log-entry">${e}</div>`)
    .join("");
}

function addLog(msg) {
  sim.log.push(msg);
  if (sim.log.length > 200) sim.log.shift();
}

function applyDamage(dmg, type) {
  if (dmg <= 0 || sim.finished) return;
  sim.totalDmg += dmg;
  if (sim.turn <= MAX_TURN) sim.turn13Dmg += dmg;
  sim.dmgBreakdown[type] += dmg;
  sim.bossHp = Math.max(0, sim.bossHp - dmg);
  if (sim.scarecrowTurn == null && sim.bossHp <= 0) {
    sim.scarecrowTurn = sim.turn;
  }
}

function tickCooldowns(activeIdx, usedUlt) {
  sim.cds = sim.cds.map((cd, i) => {
    if (i === activeIdx) return usedUlt ? sim.team[i].cd : Math.max(0, cd - 1);
    return Math.max(0, cd - 1);
  });
}

function advanceAction() {
  sim.actionIndex++;
  if (sim.actionIndex >= MAX_TURN * ACTIONS_PER_TURN) {
    sim.finished = true;
    addLog(`<span class="log-damage">★ 13 回合结束，总伤害 ${formatNumber(sim.turn13Dmg)}</span>`);
    return;
  }
  if (sim.actionIndex % ACTIONS_PER_TURN === 0) {
    sim.turn++;
    addLog(`—— 第 ${sim.turn} 回合 ——`);
  }
}

function doAction(type) {
  if (sim.finished || sim.mode === "precise") return;
  const idx = getActiveCharIndex();
  const ch = sim.team[idx];
  const name = charDisplayName(ch);
  let dmg = 0;

  if (type === "normal") {
    dmg = calcNormalDmg(ch);
    applyDamage(dmg, "normal");
    addLog(`第 ${sim.turn} 回合 ${name} 普攻 <span class="log-damage">${formatNumber(dmg)}</span>`);
    tickCooldowns(idx, false);
  } else if (type === "ult") {
    if (sim.cds[idx] > 0) return;
    dmg = calcUltDmg(ch);
    applyDamage(dmg, "ult");
    addLog(`第 ${sim.turn} 回合 ${name} 必杀 <span class="log-damage">${formatNumber(dmg)}</span>`);
    tickCooldowns(idx, true);
    sim.cds[idx] = ch.cd;
  } else {
    addLog(`第 ${sim.turn} 回合 ${name} 防御`);
    tickCooldowns(idx, false);
  }
  advanceAction();
  renderUI();
}

function resetSim() {
  if (sim.mode === "precise" && sim.compIds) {
    location.reload();
    return;
  }
  sim.turn = 1;
  sim.actionIndex = 0;
  sim.bossHp = BOSS_MAX_HP;
  sim.totalDmg = 0;
  sim.turn13Dmg = 0;
  sim.scarecrowTurn = null;
  sim.finished = false;
  sim.cds = sim.team.map(() => 0);
  sim.dmgBreakdown = { normal: 0, ult: 0, dot: 0, extra: 0 };
  sim.log = [];
  addLog("打桩重置");
  renderUI();
}

async function autoPlay() {
  if (sim.mode === "precise") {
    document.getElementById("autoBtn").disabled = true;
    addLog("精确模式：官方引擎已完成 13 回合重算");
    sim.finished = true;
    renderUI();
    return;
  }
  if (sim.finished) resetSim();
  while (!sim.finished) {
    const idx = getActiveCharIndex();
    const ch = sim.team[idx];
    doAction(sim.cds[idx] <= 0 && ch.ultMag > 0 ? "ult" : "normal");
    await new Promise((r) => setTimeout(r, 60));
  }
}
