/** 公告过期 / 卡池提醒 — 首页与顶栏 */

let _bannerEventsCache = null;
let _bannerEventsFetchedAt = 0;

async function fetchBannerEventsCached(force = false) {
  const now = Date.now();
  if (!force && _bannerEventsCache && now - _bannerEventsFetchedAt < 120000) {
    return _bannerEventsCache;
  }
  try {
    _bannerEventsCache = await fetchJsonWithTimeout(`${getSiteBase()}/data/banner_events.json`);
    _bannerEventsFetchedAt = now;
  } catch {
    _bannerEventsCache = null;
  }
  return _bannerEventsCache;
}

function parseEventTime(iso) {
  if (!iso) return null;
  return new Date(iso);
}

function getEventAlertState(ev) {
  if (!ev?.endAt) return null;
  const end = parseEventTime(ev.endAt)?.getTime();
  if (!end) return null;
  const now = Date.now();
  const start = parseEventTime(ev.startAt)?.getTime() ?? 0;
  if (now < start) {
    return { type: "upcoming", endAt: ev.endAt, title: ev.titleSc, daysLeft: null };
  }
  if (now > end) {
    return { type: "expired", endAt: ev.endAt, title: ev.titleSc, daysLeft: 0 };
  }
  const daysLeft = Math.ceil((end - now) / 86400000);
  if (daysLeft <= 3) {
    return { type: "ending", endAt: ev.endAt, title: ev.titleSc, daysLeft };
  }
  return { type: "active", endAt: ev.endAt, title: ev.titleSc, daysLeft };
}

function renderEventAlertHtml(state) {
  if (!state || state.type === "active") return "";
  const bannerUrl = siteUrl("banner/index.html");
  if (state.type === "expired") {
    return `<div class="site-alert site-alert-warn" role="status">
      <strong>${escapeHtml(state.title || "限定召唤")}</strong> 已于 ${formatAlertDate(state.endAt)} 结束 ·
      <a href="${bannerUrl}">更新卡池选择</a>
    </div>`;
  }
  if (state.type === "ending") {
    return `<div class="site-alert site-alert-urgent" role="status">
      <strong>${escapeHtml(state.title || "限定召唤")}</strong> 还剩约 <strong>${state.daysLeft}</strong> 天（${formatAlertDate(state.endAt)} 截止） ·
      <a href="${bannerUrl}">查看卡池 ROI</a>
    </div>`;
  }
  if (state.type === "upcoming") {
    return `<div class="site-alert site-alert-info" role="status">
      ${escapeHtml(state.title || "活动")} 尚未开始
    </div>`;
  }
  return "";
}

function formatAlertDate(iso) {
  const d = parseEventTime(iso);
  if (!d) return iso;
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function mountSiteEventAlerts(containerId = "site-alerts") {
  let el = document.getElementById(containerId);
  if (!el) {
    el = document.createElement("div");
    el.id = containerId;
    el.className = "site-alerts-wrap";
    const header = document.getElementById("site-header");
    if (header?.parentNode) {
      header.parentNode.insertBefore(el, header.nextSibling);
    } else {
      document.body.prepend(el);
    }
  }
  const data = await fetchBannerEventsCached();
  const state = data?.event ? getEventAlertState(data.event) : null;
  el.innerHTML = renderEventAlertHtml(state);
  return state;
}

if (typeof window !== "undefined") {
  window.fetchBannerEventsCached = fetchBannerEventsCached;
  window.getEventAlertState = getEventAlertState;
  window.mountSiteEventAlerts = mountSiteEventAlerts;
}
