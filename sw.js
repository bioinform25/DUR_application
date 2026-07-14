/*
 * 앱 셸(HTML/CSS/JS/아이콘)은 캐시 우선(cache-first)으로,
 * 데이터(drugs.json, dur_rules.json)는 네트워크 우선(network-first)으로 캐싱한다.
 * 데이터는 매달 갱신되니 온라인일 때는 항상 최신을 받고, 오프라인일 때만 마지막
 * 캐시본으로 대체해 "인터넷이 안 터져도 지난달 데이터로는 동작"하게 한다.
 *
 * 캐시 버전을 올리면(CACHE_VERSION) 이전 캐시가 자동 정리된다. 앱 셸 파일이
 * 바뀌었는데 사용자에게 안 보인다면 이 값을 올릴 것.
 */
const CACHE_VERSION = "v38";
const SHELL_CACHE = `dur-shell-${CACHE_VERSION}`;
const DATA_CACHE = `dur-data-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/normalize.js",
  "./js/food_interactions.js",
  "./js/lay_glossary.js",
  "./js/family-sync.js",
  "./privacy.html",
  "./terms.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  const isData = url.pathname.includes("/data/") && url.pathname.endsWith(".json");

  if (isData) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(SHELL_CACHE);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
