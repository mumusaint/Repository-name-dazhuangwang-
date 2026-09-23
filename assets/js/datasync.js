/** 与本地 server 同步状态联动：检测 TenkaAssist 数据更新并提示刷新 */
const DATA_SYNC_STORAGE_KEY = "dazhuang_data_revision";

function invalidateCharacterCache() {
  if (typeof characterData !== "undefined") characterData = null;
  if (typeof characterMap !== "undefined") characterMap.clear();
  if (typeof manualCharacters !== "undefined") manualCharacters = null;
  if (typeof stageOverlay !== "undefined") stageOverlay = null;
  if (typeof stageMap !== "undefined") stageMap.clear();
  if (typeof localCharacterImages !== "undefined") localCharacterImages = null;
  if (typeof newCharIdSet !== "undefined") newCharIdSet = null;
}

function invalidateCompDatabaseCache() {
  if (typeof invalidateCompDatabase === "function") {
    invalidateCompDatabase();
  }
}

async function fetchSyncStatus() {
  const base = typeof getSiteBase === "function" ? getSiteBase() : ".";
  // 静态部署读 data/sync_meta.json；本地 server 亦由同步脚本写入同一文件
  const res = await fetch(`${base}/data/sync_meta.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const status = await res.json();
  if (status && !("syncing" in status)) status.syncing = false;
  return status;
}

async function triggerRemoteSync(force = false) {
  if (typeof isLocalServer === "function" && !isLocalServer()) {
    throw new Error("静态站点不支持在线同步，请在本地运行 python server.py 后同步");
  }
  const base = typeof getSiteBase === "function" ? getSiteBase() : ".";
  const res = await fetch(`${base}/api/sync/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatSyncTime(iso) {
  if (!iso) return "从未";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

async function applyDataRefresh(status) {
  invalidateCharacterCache();
  invalidateCompDatabaseCache();
  if (typeof loadCharacters === "function") {
    await loadCharacters();
  }
  if (status?.character_total && typeof showToast === "function") {
    showToast(`数据已更新 · 角色 ${status.character_total} 名`, "success", 3500);
  }
  localStorage.setItem(DATA_SYNC_STORAGE_KEY, String(status?.revision || Date.now()));
  document.dispatchEvent(new CustomEvent("dazhuang:data-synced", { detail: status }));
}

async function checkDataSync(options = {}) {
  const { silent = false, forceReload = false } = options;
  try {
    const status = await fetchSyncStatus();
    updateSyncBadge(status);
    const prev = localStorage.getItem(DATA_SYNC_STORAGE_KEY);
    const cur = status.revision != null ? String(status.revision) : null;
    const isNew = cur && prev && cur !== prev;
    if (forceReload || isNew) {
      await applyDataRefresh(status);
      return status;
    }
    if (!prev && cur) {
      localStorage.setItem(DATA_SYNC_STORAGE_KEY, cur);
    }
    if (!silent && status.syncing) {
      showToast?.("正在与 TenkaAssist 同步数据…", "info", 2500);
    }
    return status;
  } catch {
    return null;
  }
}

function updateSyncBadge(status) {
  const el = document.getElementById("sync-badge");
  if (!el || !status) return;
  if (status.syncing) {
    el.textContent = "同步中…";
    el.title = "正在与 TenkaAssist 同步";
    el.classList.remove("sync-ok");
    el.classList.add("sync-warn");
    return;
  }
  const charOk = status.characters_ok !== false;
  const compOk = status.compdata_ok !== false;
  const ok = status.last_sync_ok !== false && charOk && compOk;
  const partial = !ok && (charOk || compOk);
  const time = formatSyncTime(status.last_sync_at);
  let detail = `数据来源 TenkaAssist\n上次同步：${time}\n角色 ${status.character_total ?? "?"} 名`;
  if (status.characters_error) detail += `\n角色：${status.characters_error}`;
  if (status.compdata_error) detail += `\n配队：${status.compdata_error}`;
  el.title = detail;
  el.textContent = ok ? "已同步" : partial ? "部分同步" : "同步异常";
  el.classList.toggle("sync-ok", ok);
  el.classList.toggle("sync-warn", !ok);
}

function ensureSyncBadge() {
  if (document.getElementById("sync-badge")) return;
  const badge = document.getElementById("account-badge");
  if (!badge?.parentElement) return;
  const span = document.createElement("button");
  span.type = "button";
  span.id = "sync-badge";
  span.className = "sync-badge sync-ok";
  span.textContent = "同步中…";
  span.title = "与 TenkaAssist 数据同步";
  span.addEventListener("click", async () => {
    span.disabled = true;
    span.textContent = "同步中…";
    try {
      await triggerRemoteSync(true);
      const status = await checkDataSync({ forceReload: true });
      if (!status) throw new Error("无响应");
    } catch (e) {
      showToast?.(`同步失败：${formatErrorMessage?.(e) || e.message}`, "error", 4000);
    } finally {
      span.disabled = false;
      fetchSyncStatus().then(updateSyncBadge).catch(() => {});
    }
  });
  badge.parentElement.insertBefore(span, badge);
}

function initDataSync() {
  if (window.__dazhuangDataSyncInit) return;
  window.__dazhuangDataSyncInit = true;
  ensureSyncBadge();
  checkDataSync({ silent: true });
  setInterval(() => checkDataSync({ silent: true }), 30 * 60 * 1000);
}

window.__dazhuangDataSync = {
  init: initDataSync,
  check: checkDataSync,
  refresh: applyDataRefresh,
};
