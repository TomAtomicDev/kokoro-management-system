const CACHE_NAME = "kokoro-static-v1";
const STATIC_DESTINATIONS = new Set(["document", "script", "style"]);

function isStaticAsset(request) {
  const url = new URL(request.url);
  const isApiRequest = url.pathname === "/api" || url.pathname.startsWith("/api/");
  const isTelegramRequest =
    url.pathname === "/telegram" || url.pathname.startsWith("/telegram/");

  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !isApiRequest &&
    !isTelegramRequest &&
    STATIC_DESTINATIONS.has(request.destination)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add("/")).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith("kokoro-static-") && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isStaticAsset(event.request)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch {
        if (event.request.destination === "document") {
          return (await cache.match("/")) ?? Response.error();
        }
        return Response.error();
      }
    })(),
  );
});
