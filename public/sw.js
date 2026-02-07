const CACHE_NAME = "graphy-v4";

// Important for GitHub Pages: the site is typically served from a subpath (/<repo>/).
// Use URLs relative to the service worker's own location so caching works from any base path.
const CORE_PATHS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./image.png",
  "./og.jpg",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./screenshots/desktop.png",
  "./fonts/Fraunces-500.ttf",
  "./fonts/Fraunces-700.ttf",
  "./fonts/SpaceGrotesk-400.ttf",
  "./fonts/SpaceGrotesk-500.ttf",
  "./fonts/SpaceGrotesk-600.ttf",
];

const coreUrls = CORE_PATHS.map((p) => new URL(p, self.location.href));
const CORE_ASSETS = coreUrls.map((u) => u.href);
const APP_SHELL = new Set(
  ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json"].map(
    (p) => new URL(p, self.location.href).pathname,
  ),
);
const INDEX_PATHNAME = new URL("./index.html", self.location.href).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);

  // Only handle same-origin requests
  if (requestUrl.origin !== self.location.origin) return;
  const pathname = requestUrl.pathname;
  const isNavigation = event.request.mode === "navigate";
  const useNetworkFirst = isNavigation || APP_SHELL.has(pathname);

  if (useNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return caches.match(INDEX_PATHNAME);
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});
