/**
 * 打桩网 Service Worker
 * 策略：静态资源 cache-first，数据文件 network-first（保证配队库新鲜）
 */
const CACHE_VERSION = "dazhuang-v1";
const STATIC_ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "assets/css/common.css",
  "assets/js/common.js",
  "assets/js/api.js",
  "assets/js/accounts.js",
  "assets/js/datasync.js",
  "assets/js/compdata.js",
  "assets/js/compbrowse.js",
  "assets/images/icon.svg",
  "assets/js/vendor/pako.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 只处理同源 GET 请求
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  // 数据文件 → network-first（compdata 等大文件保持新鲜）
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 静态资源 → cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        // 只缓存成功响应
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
