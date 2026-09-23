/** 出招顺序解析与格式化（参考 TenkaAssist comp.js setCommand） */
const ACT_LABEL = { 평: "攻", 궁: "大", 방: "防" };
const ACT_CLASS = { 평: "act-normal", 궁: "act-ult", 방: "act-def" };

function parseCommandActions(description) {
  if (!description) return [];
  return description
    .split("\n")
    .flatMap((line) => line.match(/\d+[평궁방]/g) || [])
    .map((token) => ({
      slot: Number(token[0]),
      actKey: token[1],
      actLabel: ACT_LABEL[token[1]] || token[1],
    }));
}

/** 按回合分组（同一槽位出现两次则换回合） */
function groupCommandTurns(actions) {
  const turns = [];
  let actCheck = [false, false, false, false, false];
  let current = [];

  for (const a of actions) {
    const idx = a.slot - 1;
    if (actCheck[idx]) {
      if (current.length) turns.push(current);
      actCheck = [false, false, false, false, false];
      current = [];
    }
    actCheck[idx] = true;
    current.push(a);
  }
  if (current.length) turns.push(current);
  return turns;
}

function getSlotLabel(slot, compIds, useNames) {
  const idx = slot - 1;
  if (useNames && compIds?.[idx]) {
    const ch = getCharacter(compIds[idx]);
    if (ch) return charDisplayName(ch);
  }
  return `${slot}号`;
}

/** 纯文本出招顺序（含角色名） */
function formatCommandText(description, compIds, useNames = true) {
  const actions = parseCommandActions(description);
  if (!actions.length) return "无出招顺序";

  const turns = groupCommandTurns(actions);
  return turns
    .map((turnActions, i) => {
      const steps = turnActions.map((a) => {
        const name = getSlotLabel(a.slot, compIds, useNames);
        return `${name}·${a.actLabel}`;
      });
      return `${i + 1}回合 : ${steps.join(" > ")}`;
    })
    .join("\n");
}

/** HTML 出招顺序（原站风格 + 角色名 + 颜色） */
function formatCommandHtml(description, compIds, useNames = true) {
  const actions = parseCommandActions(description);
  if (!actions.length) {
    return '<span class="empty-hint">无出招顺序</span>';
  }

  const turns = groupCommandTurns(actions);
  return turns
    .map((turnActions, i) => {
      const steps = turnActions.map((a, j) => {
        const name = escapeHtml(getSlotLabel(a.slot, compIds, useNames));
        const cls = ACT_CLASS[a.actKey] || "";
        const sep = j > 0 ? '<span class="cmd-sep"> · </span>' : "";
        return `${sep}<span class="cmd-step ${cls}"><span class="cmd-slot">${a.slot}</span>${name}<span class="cmd-act">${a.actLabel}</span></span>`;
      });
      return `<div class="command-turn"><span class="cmd-turn-num">${i + 1}回合</span><span class="cmd-turn-body">${steps.join("")}</span></div>`;
    })
    .join("");
}

/** 紧凑单行预览（列表用） */
function formatCommandPreview(description, compIds, maxTurns = 3) {
  const text = formatCommandText(description, compIds, true);
  const lines = text.split("\n");
  if (lines.length <= maxTurns) return text;
  return lines.slice(0, maxTurns).join("\n") + `\n…共 ${lines.length} 回合`;
}

function renderDeckWithSlots(compIds, bonds) {
  return compIds
    .map((id, i) => {
      const ch = getCharacter(id);
      if (!ch) return "";
      const n = charDisplayName(ch);
      const bond = bonds?.[i] ?? "";
      const hpUp = i === 0 && ch.hpUp ? `<span class="hp-badge">生命+${ch.hpUp}</span>` : "";
      const lib =
        ch.isLiberation ||
        (typeof liberationList !== "undefined" && liberationList.includes(ch.name));
      return `<div class="deck-char slot-char" title="${n}">
        <span class="slot-num-badge">${i + 1}</span>
        <img src="${charImageUrl(id)}" alt="${n}">
        <span class="element-dot element-${ch.element}"></span>
        ${bond ? `<span class="bond-badge" style="top:auto;bottom:14px;right:2px">${bond}</span>` : ""}
        ${hpUp}${lib ? `<span class="lib-badge">+</span>` : ""}
        <span class="deck-char-name">${n}</span>
      </div>`;
    })
    .join("");
}

/** 推荐页可编辑花数（羁绊）的配队展示 */
function renderEditableDeckWithSlots(compId, compIds, bonds) {
  return compIds
    .map((id, i) => {
      const ch = getCharacter(id);
      if (!ch) return "";
      const n = charDisplayName(ch);
      const bond = bonds?.[i] ?? 1;
      const hpUp = i === 0 && ch.hpUp ? `<span class="hp-badge">生命+${ch.hpUp}</span>` : "";
      const lib =
        ch.isLiberation ||
        (typeof liberationList !== "undefined" && liberationList.includes(ch.name));
      const options = [1, 2, 3, 4, 5]
        .map((b) => `<option value="${b}"${bond === b ? " selected" : ""}>${b} 花</option>`)
        .join("");
      return `<div class="deck-char slot-char deck-char-editable" title="${n}">
        <span class="slot-num-badge">${i + 1}</span>
        <img src="${charImageUrl(id)}" alt="${n}">
        <span class="element-dot element-${ch.element}"></span>
        ${hpUp}${lib ? `<span class="lib-badge">+</span>` : ""}
        <select class="deck-bond-select" onclick="event.stopPropagation()" onchange="smartSetCompBond(${compId}, ${i}, this.value)" aria-label="${n} 花数">${options}</select>
        <span class="deck-char-name">${n}</span>
      </div>`;
    })
    .join("");
}

function copyCommandText(description, compIds) {
  const text = formatCommandText(description, compIds, true);
  copyText(text, "出招顺序已复制");
}
