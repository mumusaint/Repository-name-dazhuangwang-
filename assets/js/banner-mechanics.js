/** 卡池分池机制：保底 / 心愿 / STEP / 固定十连 */

const BANNER_PULLS_STORAGE = "dazhuang_banner_pulls";
const BANNER_SHELL_TENS_STORAGE = "dazhuang_banner_shell_tens";

function getStoredBannerPulls() {
  const n = Number(localStorage.getItem(BANNER_PULLS_STORAGE));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function setStoredBannerPulls(n) {
  localStorage.setItem(BANNER_PULLS_STORAGE, String(Math.max(0, Math.floor(n))));
}

function getStoredShellTens() {
  const n = Number(localStorage.getItem(BANNER_SHELL_TENS_STORAGE));
  return Number.isFinite(n) && n >= 0 ? Math.min(2, Math.floor(n)) : 0;
}

function setStoredShellTens(n) {
  localStorage.setItem(BANNER_SHELL_TENS_STORAGE, String(Math.min(2, Math.max(0, Math.floor(n)))));
}

/** 合并 banner 与 event 默认规则 */
function resolveBannerMechanics(banner, event = {}) {
  if (!banner) return null;
  const kind = banner.kind || "limited";
  const currencyType =
    banner.currencyType || (/魂晶/.test(String(banner.currencySc || "")) ? "soul" : "crystal");
  const base = {
    kind,
    id: banner.id,
    nameSc: banner.nameSc,
    currencySc: banner.currencySc,
    currencyType,
    ssrRateTotal: banner.ssrRateTotal ?? event.ssrRateTotal,
    noteSc: banner.noteSc || "",
    stepRewards: Array.isArray(banner.stepRewards) ? banner.stepRewards : [],
  };

  if (kind === "limited") {
    return {
      ...base,
      pityHard: banner.pityHard ?? event.pityHard ?? 100,
      wishUnlock: banner.wishUnlock ?? event.wishUnlock ?? 300,
      wishPickCount: banner.wishPickCount ?? 0,
      wishResetOnHit: banner.wishResetOnHit !== false,
      simCounts: banner.simCounts || [1, 3, 10],
    };
  }

  if (kind === "rerun") {
    return {
      ...base,
      pityHard: banner.pityHard ?? 100,
      wishUnlock: banner.wishUnlock ?? null,
      wishPickCount: 0,
      simCounts: banner.simCounts || [1, 3, 10],
    };
  }

  if (kind === "step") {
    return {
      ...base,
      pityHard: banner.pityHard ?? 60,
      wishUnlock: null,
      wishPickCount: 0,
      simCounts: banner.simCounts || [1, 3, 10],
    };
  }

  if (kind === "wish") {
    const isShell = banner.id === "shell-wish-v220" || banner.simMode === "fixed_ten";
    return {
      ...base,
      pityHard: banner.pityHard ?? (isShell ? null : 100),
      wishUnlock: isShell ? null : banner.wishUnlock ?? null,
      wishPickCount: banner.wishPickCount ?? (isShell ? 5 : 3),
      maxTenPulls: banner.maxTenPulls ?? (isShell ? 2 : null),
      pullsPerTen: banner.pullsPerTen ?? 10,
      soulCostPerTen: banner.soulCostPerTen ?? 35,
      simMode: isShell ? "fixed_ten" : "wish_standard",
      simCounts: isShell ? [1, 2] : banner.simCounts || [1, 3, 10],
    };
  }

  return { ...base, pityHard: 100, simCounts: [1, 3, 10] };
}

function getActiveBannerMechanics() {
  const id =
    typeof localStorage !== "undefined" ? localStorage.getItem("dazhuang_banner_event_id") : null;
  const banner = id && typeof findBanner === "function" ? findBanner(id) : null;
  const event = typeof bannerEvents !== "undefined" ? bannerEvents?.event : {};
  if (banner) return resolveBannerMechanics(banner, event);
  if (event?.pityHard || event?.wishUnlock) {
    return resolveBannerMechanics({ kind: "limited", ...event, nameSc: event.titleSc }, event);
  }
  return null;
}

function pullsToNextPity(pulls, pityHard) {
  if (!pityHard) return null;
  const mod = pulls % pityHard;
  if (mod === 0 && pulls > 0) return pityHard;
  return pityHard - mod;
}

function getStepProgress(pulls, stepRewards = []) {
  const sorted = [...stepRewards].sort((a, b) => a.at - b.at);
  const claimed = sorted.filter((s) => pulls >= s.at);
  let next = sorted.find((s) => pulls < s.at);
  if (!next) {
    const repeatable = sorted.filter((s) => s.repeatable);
    const anchor = repeatable.length ? repeatable[repeatable.length - 1] : null;
    if (anchor && pulls >= anchor.at) {
      const cycle = anchor.at;
      const rem = cycle - (pulls % cycle);
      next = { ...anchor, at: pulls + (rem === cycle ? cycle : rem), remaining: rem === cycle ? cycle : rem };
    }
  } else {
    next = { ...next, remaining: next.at - pulls };
  }
  return { claimed, next, sorted };
}

function readBannerMechanicsInputs() {
  const pullsEl = document.getElementById("pullsOnBanner");
  const shellEl = document.getElementById("shellTenPullsUsed");
  const pulls = Number(pullsEl?.value);
  const shellTenPullsUsed = Number(shellEl?.value);
  return {
    pulls: Number.isFinite(pulls) && pulls >= 0 ? Math.floor(pulls) : getStoredBannerPulls(),
    shellTenPullsUsed:
      Number.isFinite(shellTenPullsUsed) && shellTenPullsUsed >= 0
        ? Math.min(2, Math.floor(shellTenPullsUsed))
        : getStoredShellTens(),
  };
}

function syncBannerMechanicsInputsToStorage() {
  const { pulls, shellTenPullsUsed } = readBannerMechanicsInputs();
  setStoredBannerPulls(pulls);
  setStoredShellTens(shellTenPullsUsed);
}

function computeMechanicsState(mech, inputs) {
  if (!mech) return { lines: [], stepHtml: "", simCounts: [1, 3, 10], simMode: "standard" };
  const pulls = inputs?.pulls ?? 0;
  const shellTenPullsUsed = inputs?.shellTenPullsUsed ?? 0;
  const lines = [];

  if (mech.ssrRateTotal != null) {
    lines.push({ label: "SSR 总概率", value: `${(mech.ssrRateTotal * 100).toFixed(1)}%` });
  }

  if (mech.kind === "limited" || mech.kind === "rerun") {
    if (mech.pityHard) {
      const toPity = pullsToNextPity(pulls, mech.pityHard);
      lines.push({ label: "硬保底", value: `每 ${mech.pityHard} 抽` });
      lines.push({ label: "距下次 UP 保底", value: `约 ${toPity} 抽`, highlight: true });
    }
    if (mech.wishUnlock) {
      const ready = pulls >= mech.wishUnlock;
      lines.push({
        label: "心愿功能",
        value: ready ? "已开启" : `还差 ${mech.wishUnlock - pulls} 抽`,
        highlight: ready,
      });
      if (ready && mech.wishResetOnHit) {
        lines.push({ label: "心愿说明", value: "下次 SSR 必为所选 UP，命中后需再攒 300 抽" });
      }
    }
  }

  if (mech.kind === "step") {
    if (mech.pityHard) {
      const toPity = pullsToNextPity(pulls, mech.pityHard);
      lines.push({ label: "UP 保底", value: `每 ${mech.pityHard} 抽` });
      lines.push({ label: "距下次 UP 保底", value: `约 ${toPity} 抽`, highlight: true });
    }
    const { claimed, next } = getStepProgress(pulls, mech.stepRewards);
    if (next) {
      lines.push({
        label: "下一 STEP",
        value: `第 ${next.at} 抽 · ${next.rewardSc || "奖励"}`,
        sub: `还差 ${next.remaining} 抽`,
        highlight: true,
      });
    }
    if (claimed.length) {
      lines.push({ label: "已达成 STEP", value: `${claimed.length} 档` });
    }
  }

  if (mech.kind === "wish") {
    if (mech.simMode === "fixed_ten") {
      const left = Math.max(0, (mech.maxTenPulls ?? 2) - shellTenPullsUsed);
      lines.push({ label: "十连次数", value: `已用 ${shellTenPullsUsed} / ${mech.maxTenPulls ?? 2}` });
      lines.push({
        label: "剩余机会",
        value: left ? `还可 ${left} 次十连` : "已用完",
        highlight: left > 0,
      });
      lines.push({
        label: "单次消耗",
        value: `魂晶 ×${mech.soulCostPerTen ?? 35}`,
      });
      if (mech.wishPickCount) {
        lines.push({ label: "心愿位", value: `选 ${mech.wishPickCount} 名 SSR` });
      }
    } else {
      if (mech.wishPickCount) {
        lines.push({ label: "心愿位", value: `选 ${mech.wishPickCount} 名 · 出 SSR 必为心愿` });
      }
      if (mech.pityHard) {
        const toPity = pullsToNextPity(pulls, mech.pityHard);
        lines.push({ label: "UP 保底", value: `每 ${mech.pityHard} 抽 · 距下次约 ${toPity} 抽`, highlight: true });
      }
      const { next } = getStepProgress(pulls, mech.stepRewards);
      if (next) {
        lines.push({
          label: "下一 STEP",
          value: `第 ${next.at} 抽 · ${next.rewardSc || "奖励"}`,
          sub: `还差 ${next.remaining} 抽`,
        });
      }
    }
  }

  lines.push({ label: "累计抽数", value: `${pulls} 抽` });

  const stepHtml = renderStepTrackHtml(mech, pulls);

  return {
    lines,
    stepHtml,
    simCounts: mech.simCounts || [1, 3, 10],
    simMode: mech.simMode || "standard",
    maxObtainable:
      mech.simMode === "fixed_ten"
        ? Math.max(0, (mech.maxTenPulls ?? 2) - shellTenPullsUsed)
        : null,
  };
}

function renderStepTrackHtml(mech, pulls) {
  if (!mech?.stepRewards?.length) return "";
  const { sorted, claimed } = getStepProgress(pulls, mech.stepRewards);
  const maxAt = sorted[sorted.length - 1]?.at || 100;
  const cap = Math.max(maxAt, pulls, mech.pityHard || 0);
  const pct = cap > 0 ? Math.min(100, (pulls / cap) * 100) : 0;
  return `<div class="banner-step-track">
    <div class="banner-step-track-bar"><div class="banner-step-track-fill" style="width:${pct.toFixed(1)}%"></div></div>
    <div class="banner-step-track-marks">
      ${sorted
        .map((s) => {
          const done = pulls >= s.at;
          const pos = cap > 0 ? (s.at / cap) * 100 : 0;
          return `<span class="banner-step-mark${done ? " done" : ""}" style="left:${Math.min(98, pos)}%" title="${escapeHtml(s.rewardSc || "")}">${s.at}</span>`;
        })
        .join("")}
    </div>
  </div>`;
}

function renderActiveBannerMechanicsPanel() {
  const wrap = document.getElementById("gachaMechanics");
  if (!wrap) return;
  const mech = getActiveBannerMechanics();
  if (!mech) {
    wrap.style.display = "none";
    return;
  }
  const inputs = readBannerMechanicsInputs();
  const state = computeMechanicsState(mech, inputs);
  const kindLabel =
    { limited: "限定", rerun: "复刻", step: "STEP", wish: "心愿" }[mech.kind] || mech.kind;
  const curLabel = mech.currencyType === "soul" ? "魂晶" : "魔晶";

  wrap.style.display = "block";
  wrap.innerHTML = `
    <div class="banner-mechanics-head">
      <strong>${escapeHtml(mech.nameSc || "当前卡池")}</strong>
      <span class="banner-tag-currency banner-tag-${mech.currencyType || "crystal"}">${curLabel}</span>
      <span class="banner-tag-${mech.kind}">${kindLabel}</span>
      ${mech.currencySc ? `<span class="banner-mech-currency">${escapeHtml(mech.currencySc)}</span>` : ""}
    </div>
    <div class="banner-mechanics-grid">
      ${state.lines
        .map(
          (ln) =>
            `<span class="banner-mech-stat${ln.highlight ? " highlight" : ""}">${escapeHtml(ln.label)} <strong>${ln.value}</strong>${ln.sub ? `<em>${escapeHtml(ln.sub)}</em>` : ""}</span>`
        )
        .join("")}
    </div>
    ${state.stepHtml}
    ${mech.noteSc ? `<p class="banner-mech-note">${escapeHtml(mech.noteSc)}</p>` : ""}`;
}

function renderBannerPullProgressHint() {
  const mech = getActiveBannerMechanics();
  if (!mech) return "";
  const inputs = readBannerMechanicsInputs();
  const state = computeMechanicsState(mech, inputs);
  const highlights = state.lines.filter((l) => l.highlight).map((l) => `${l.label} ${l.value}`);
  if (mech.simMode === "fixed_ten") {
    const left = state.maxObtainable ?? 0;
    return `<p class="banner-summary-desc" style="margin-top:0.5rem">眷恋贝壳 · 剩余 <strong>${left}</strong> 次十连 · 配队模拟按最多再获得 <strong>${left}</strong> 名 SSR 估算</p>`;
  }
  if (!highlights.length) {
    return `<p class="banner-summary-desc" style="margin-top:0.5rem">已累计 <strong>${inputs.pulls}</strong> 抽 · ${escapeHtml(mech.nameSc || "")}</p>`;
  }
  return `<p class="banner-summary-desc" style="margin-top:0.5rem">${highlights.map((h) => escapeHtml(h)).join(" · ")}</p>`;
}

function getSimCountsForActiveBanner() {
  const mech = getActiveBannerMechanics();
  if (!mech) return [1, 3, 10];
  const inputs = readBannerMechanicsInputs();
  const state = computeMechanicsState(mech, inputs);
  let counts = state.simCounts || [1, 3, 10];
  if (state.maxObtainable != null) {
    counts = counts.filter((n) => n <= state.maxObtainable);
    if (!counts.length && state.maxObtainable > 0) counts = [state.maxObtainable];
    if (!counts.length) counts = [0];
  }
  return counts;
}

function configureBannerMechanicsForm() {
  const mech = getActiveBannerMechanics();
  const pullsWrap = document.getElementById("pullsOnBannerWrap");
  const shellWrap = document.getElementById("shellTenPullsWrap");
  const pullsLabel = document.getElementById("pullsOnBannerLabel");
  const pullsInput = document.getElementById("pullsOnBanner");
  if (!pullsWrap) return;

  const isShell = mech?.simMode === "fixed_ten";
  pullsWrap.style.display = isShell ? "none" : "";
  if (shellWrap) shellWrap.style.display = isShell ? "" : "none";

  if (pullsLabel && mech) {
    const labels = {
      limited: "本池已抽次数",
      rerun: "本池已抽次数",
      step: "本池累计抽数",
      wish: "本池累计抽数",
    };
    pullsLabel.textContent = labels[mech.kind] || "本池已抽次数";
  }

  if (pullsInput && !isShell) {
    const titles = {
      limited: "用于估算距100保底/300心愿",
      rerun: "用于估算距100保底",
      step: "用于估算距60/80保底与STEP档位",
      wish: "用于估算保底与STEP",
    };
    pullsInput.title = titles[mech?.kind] || titles.limited;
  }

  if (pullsInput) {
    pullsInput.value = String(getStoredBannerPulls());
  }
  const shellInput = document.getElementById("shellTenPullsUsed");
  if (shellInput) {
    shellInput.value = String(getStoredShellTens());
  }
}

function bindBannerMechanicsInputs() {
  const onChange = () => {
    syncBannerMechanicsInputsToStorage();
    renderActiveBannerMechanicsPanel();
  };
  document.getElementById("pullsOnBanner")?.addEventListener("input", onChange);
  document.getElementById("shellTenPullsUsed")?.addEventListener("change", onChange);
}

if (typeof window !== "undefined") {
  window.resolveBannerMechanics = resolveBannerMechanics;
  window.getActiveBannerMechanics = getActiveBannerMechanics;
  window.computeMechanicsState = computeMechanicsState;
  window.renderActiveBannerMechanicsPanel = renderActiveBannerMechanicsPanel;
  window.renderBannerPullProgressHint = renderBannerPullProgressHint;
  window.getSimCountsForActiveBanner = getSimCountsForActiveBanner;
  window.configureBannerMechanicsForm = configureBannerMechanicsForm;
  window.bindBannerMechanicsInputs = bindBannerMechanicsInputs;
}
