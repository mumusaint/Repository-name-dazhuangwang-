/** 导出 Markdown 报告（智能打桩 / 卡池） */

function _charNames(ids) {
  return (ids || [])
    .map((id) => {
      const ch = typeof getCharacter === "function" ? getCharacter(id) : null;
      return charDisplayName(ch) || id;
    })
    .join(" · ");
}

function exportSmartReportMarkdown() {
  const results = window.smartResults || [];
  const owned = getOwned();
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : "本地";
  const lines = [
    `# 智能打桩报告`,
    ``,
    `- 账号：${user}`,
    `- 持有：${owned.length} 名 · 生成时间：${new Date().toLocaleString("zh-CN")}`,
    ``,
  ];

  if (results.length) {
    const batches =
      typeof buildDisjointTeamBatches === "function"
        ? buildDisjointTeamBatches(results, 4, window.smartResultsPool || results, "batchTotal")
        : [];
    const topBatch = batches[0] || results.slice(0, 4);
    lines.push(`## 主力四队参考`, ``);
    topBatch.forEach((c, i) => {
      const dmg = c.fit13t ? formatNumber(c.fit13t) : "-";
      lines.push(
        `${i + 1}. **${compDisplayName(c)}** · ${dmg}`,
        `   - 成员：${_charNames(c.compstr)}`,
        `   - 编号：${c.id}`,
        ``
      );
    });
    lines.push(`## Top 10 推荐`, ``);
    results.slice(0, 10).forEach((c, i) => {
      lines.push(
        `${i + 1}. ${compDisplayName(c)} · ${formatNumber(c.fit13t || 0)} · ${_charNames(c.compstr)}`
      );
    });
  } else {
    lines.push(`> 暂无分析结果，请先在智能打桩页运行分析。`);
  }

  const pull = window.pullResults || [];
  if (pull.length) {
    lines.push(``, `## 优先抽取`, ``);
    pull.slice(0, 8).forEach((p, i) => {
      const n = charDisplayName(getCharacter(p.missId)) || p.missId;
      lines.push(`${i + 1}. ${n} · 解锁 ${p.teamCount ?? 0} 套`);
    });
  }

  const md = lines.join("\n");
  _downloadText(md, `打桩报告-${Date.now()}.md`, "text/markdown;charset=utf-8");
  if (typeof copyToClipboard === "function") copyToClipboard(md);
  showToast("报告已下载并复制到剪贴板", "success");
  return md;
}

function exportBannerReportMarkdown(data) {
  const owned = getOwned();
  const { results, ownedInPool, bestPick, simRows, tripleCompare, pullVsBond, mechanics, mechanicsState } =
    data || {};
  const lines = [
    `# 卡池抽取报告`,
    ``,
    `- 持有：${owned.length} 名 · ${new Date().toLocaleString("zh-CN")}`,
    mechanics?.nameSc ? `- 卡池：${mechanics.nameSc}（${mechanics.kind || ""}）` : "",
    ``,
  ].filter(Boolean);

  if (mechanicsState?.lines?.length) {
    lines.push(`## 保底 / STEP 进度`, ``);
    mechanicsState.lines.forEach((ln) => {
      lines.push(`- ${ln.label}：${ln.value}${ln.sub ? `（${ln.sub}）` : ""}`);
    });
    lines.push(``);
  }

  if (bestPick) {
    const n = charDisplayName(getCharacter(bestPick)) || bestPick;
    const top = results?.[0];
    lines.push(`## 首推`, `**${n}** · 解锁约 ${top?.teamCount ?? 0} 套`);
  } else if (ownedInPool?.length) {
    lines.push(`## 卡池已齐`, `建议升羁绊而非再抽`);
  }

  if (tripleCompare?.length) {
    lines.push(``, `## 三向对比`, ``);
    tripleCompare.forEach((row, i) => {
      lines.push(
        `${i + 1}. ${row.label}${row.sub ? `（${row.sub}）` : ""} · ${row.pickName} · ${row.teams} 套 · ${row.dmg}`
      );
    });
  }

  if (simRows?.length) {
    const unit = mechanics?.simMode === "fixed_ten" ? "名 SSR" : "张";
    lines.push(``, `## 再抽模拟`, ``);
    simRows.forEach((s) => {
      lines.push(
        `- 再获得 ${s.n} ${unit}（${(s.pickNames || []).join("、") || "—"}）→ 四队 ${s.disjointTeams} 套`
      );
    });
  }

  if (pullVsBond) {
    lines.push(``, `## 抽 vs 升羁绊`, pullVsBond);
  }

  if (results?.length) {
    lines.push(``, `## 待抽取列表`, ``);
    results.slice(0, 10).forEach((r, i) => {
      const n = charDisplayName(getCharacter(r.missId)) || r.missId;
      lines.push(`${i + 1}. ${n} · ${r.teamCount ?? 0} 套`);
    });
  }

  const md = lines.join("\n");
  _downloadText(md, `卡池报告-${Date.now()}.md`, "text/markdown;charset=utf-8");
  showToast("卡池报告已下载", "success");
  return md;
}

function _downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildCompCompareMarkdown(compA, compB, owned) {
  if (!compA || !compB) return "";
  const { idSet } = buildOwnedMaps(owned || getOwned());
  const missA = compA.compstr.filter((id) => !idSet.has(id));
  const missB = compB.compstr.filter((id) => !idSet.has(id));
  return [
    `# 配队对比`,
    ``,
    `| | ${compA.name || compA.id} | ${compB.name || compB.id} |`,
    `|---|---|---|`,
    `| 重算伤害 | ${formatNumber(compA.fit13t || 0)} | ${formatNumber(compB.fit13t || 0)} |`,
    `| 缺人 | ${missA.length} | ${missB.length} |`,
    `| 成员 | ${_charNames(compA.compstr)} | ${_charNames(compB.compstr)} |`,
  ].join("\n");
}

if (typeof window !== "undefined") {
  window.exportSmartReportMarkdown = exportSmartReportMarkdown;
  window.exportBannerReportMarkdown = exportBannerReportMarkdown;
  window.buildCompCompareMarkdown = buildCompCompareMarkdown;
}
