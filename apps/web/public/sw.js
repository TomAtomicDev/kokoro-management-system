// Replaced with a hash of the built index.html by vite.config.ts before deployment. Because
// index.html contains the per-environment PWA identity, staging and production get distinct
// cache names while each environment still invalidates its cache after a redeploy.
const CACHE_NAME = "kokoro-static-__KOKORO_BUILD_ID__";
const STATIC_DESTINATIONS = new Set(["document", "script", "style"]);

function isStaticAsset(request) {
  const url = new URL(request.url);
  const isApiRequest = url.pathname === "/api" || url.pathname.startsWith("/api/");
  const isTelegramRequest = url.pathname === "/telegram" || url.pathname.startsWith("/telegram/");

  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !isApiRequest &&
    !isTelegramRequest &&
    STATIC_DESTINATIONS.has(request.destination)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add("/")));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) => cacheName.startsWith("kokoro-static-") && cacheName !== CACHE_NAME,
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (!isStaticAsset(event.request)) return;

  if (event.request.destination === "document") {
    event.respondWith(networkFirstDocument(event.request));
    return;
  }

  event.respondWith(cacheFirstAsset(event.request));
});

async function networkFirstDocument(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match("/")) ?? Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}
