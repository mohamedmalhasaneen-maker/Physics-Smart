import { cacheNames, clientsClaim, setCacheNameDetails } from 'workbox-core';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';

interface SwGlobalScope {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
  location: Location;
  caches: CacheStorage;
  clients: {
    claim(): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: any) => void): void;
}

declare const self: SwGlobalScope;

const CACHE_VERSION = 'v2';
const OFFLINE_MEDIA_CACHE = 'physics-smart-offline-media-v1';
const IMAGES_CACHE = `physics-smart-images-${CACHE_VERSION}`;
const ASSETS_RUNTIME_CACHE = `physics-smart-assets-${CACHE_VERSION}`;
const PAGES_CACHE = `physics-smart-pages-${CACHE_VERSION}`;
const GOOGLE_FONTS_CSS_CACHE = `physics-smart-fonts-css-${CACHE_VERSION}`;
const GOOGLE_FONTS_BIN_CACHE = `physics-smart-fonts-bin-${CACHE_VERSION}`;

setCacheNameDetails({
  prefix: 'physics-smart',
  suffix: CACHE_VERSION,
  precache: 'app-shell',
  runtime: 'runtime',
});

// Deduplicate precache manifest by normalized URL so Workbox never throws
// add-to-cache-list-conflicting-entries when asset names contain hex segments.
function deduplicateManifest(entries: Array<PrecacheEntry | string>): Array<PrecacheEntry | string> {
  const byUrl = new Map<string, PrecacheEntry | string>();
  for (const entry of entries || []) {
    if (typeof entry === 'string') {
      if (!byUrl.has(entry)) byUrl.set(entry, entry);
      continue;
    }
    const existing = byUrl.get(entry.url);
    if (!existing) {
      byUrl.set(entry.url, entry);
    } else if (typeof existing !== 'string' && existing.revision == null && entry.revision != null) {
      // Prefer explicit MD5 revision when available
      byUrl.set(entry.url, entry);
    }
  }
  return Array.from(byUrl.values());
}

// 1. Never cache API, Firebase Auth, Firestore, or Gemini endpoints (or non-GET calls)
registerRoute(
  ({ url, request }) =>
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.hostname === 'firestore.googleapis.com' ||
    url.hostname === 'identitytoolkit.googleapis.com' ||
    url.hostname === 'securetoken.googleapis.com' ||
    url.hostname === 'generativelanguage.googleapis.com' ||
    url.hostname === 'apis.google.com' ||
    url.hostname === 'www.googleapis.com',
  new NetworkOnly()
);

// 2. Register App Shell navigation handler before precacheAndRoute so root "/" and all SPA
// routes always serve precached index.html (with offline.html fallback) without PrecacheRoute hijacking.
registerRoute(
  new NavigationRoute(
    ({ request }) => handleAppNavigation(request),
    {
      denylist: [/^\/api\//, /^\/assets\//, /^\/offline\.html$/],
    }
  )
);

const rawManifest = deduplicateManifest(self.__WB_MANIFEST || []);
const DEFERRED_MEDIA_PATTERN = /(?:^|\/)assets\/(hero_physics_observatory_|track_.*_lab_).*\.(jpe?g|webp)$/i;

const deferredMediaUrls: string[] = [];
const corePrecacheManifest: Array<PrecacheEntry | string> = [];

for (const entry of rawManifest) {
  const entryUrl = typeof entry === 'string' ? entry : entry.url;
  if (DEFERRED_MEDIA_PATTERN.test(entryUrl)) {
    deferredMediaUrls.push(entryUrl.startsWith('/') ? entryUrl : `/${entryUrl}`);
  } else {
    corePrecacheManifest.push(entry);
  }
}

precacheAndRoute(corePrecacheManifest, {
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^source$/, /^mode$/, /^launcher$/],
});

// Clean up outdated precaches only during activation after the new SW is ready
cleanupOutdatedCaches();
clientsClaim();

async function warmDeferredImages(): Promise<void> {
  if (deferredMediaUrls.length === 0) return;
  try {
    const cache = await self.caches.open(IMAGES_CACHE);
    await Promise.allSettled(
      deferredMediaUrls.map(async (url) => {
        try {
          const existing = await cache.match(url);
          if (existing && existing.ok) return;
          const res = await fetch(url, { credentials: 'same-origin' });
          const ct = res.headers.get('content-type') || '';
          if (res && res.ok && res.status === 200 && !ct.includes('text/html')) {
            await cache.put(url, res);
          }
        } catch {
          // Non-blocking: never fail SW activation if decorative background fetch fails
        }
      })
    );
  } catch {
    // Non-blocking
  }
}

self.addEventListener('install', () => {
  // Activate immediately so fixed/updated SW takes control without getting stuck in waiting
  void self.skipWaiting();
});

self.addEventListener('activate', (event: any) => {
  const activePrecacheName = cacheNames.precache;
  const allowedCaches = new Set([
    activePrecacheName,
    OFFLINE_MEDIA_CACHE,
    IMAGES_CACHE,
    ASSETS_RUNTIME_CACHE,
    PAGES_CACHE,
    GOOGLE_FONTS_CSS_CACHE,
    GOOGLE_FONTS_BIN_CACHE,
  ]);
  event.waitUntil(
    Promise.all([
      self.caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith('physics-smart-') && !allowedCaches.has(key))
              .map((key) => self.caches.delete(key))
          )
        )
        .catch(() => undefined),
      warmDeferredImages(),
    ])
  );
});

self.addEventListener('message', (event: any) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event?.data?.type === 'GET_DIAGNOSTICS' && event.ports?.[0]) {
    event.ports[0].postMessage({
      version: CACHE_VERSION,
      precacheCount: corePrecacheManifest.length,
      deferredMediaCount: deferredMediaUrls.length,
    });
  }
});

// Chrome rejects Service Worker navigation responses if response.redirected is true
async function ensureCleanNavigationResponse(response: Response): Promise<Response> {
  if (!response.redirected) return response;
  const headers = new Headers(response.headers);
  const body = await response.clone().arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// 3. App Shell Navigation: Serve precached index.html immediately offline & online;
// fall back to precached offline.html if index.html is unavailable.
async function handleAppNavigation(request: Request): Promise<Response> {
  try {
    const precachedShell =
      (await matchPrecache('/index.html')) ||
      (await matchPrecache('index.html')) ||
      (await self.caches.match('/index.html', { ignoreSearch: true })) ||
      (await self.caches.match('/', { ignoreSearch: true }));
    if (precachedShell && precachedShell.ok) {
      return await ensureCleanNavigationResponse(precachedShell);
    }

    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
      const cleanNet = await ensureCleanNavigationResponse(networkResponse);
      const contentType = cleanNet.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        const cache = await self.caches.open(PAGES_CACHE);
        await cache.put('/index.html', cleanNet.clone());
      }
      return cleanNet;
    }
  } catch {
    // Offline or network failed; continue to offline fallback chain below
  }

  const fallbackPage =
    (await self.caches.match('/index.html', { ignoreSearch: true })) ||
    (await matchPrecache('/offline.html')) ||
    (await matchPrecache('offline.html')) ||
    (await self.caches.match('/offline.html', { ignoreSearch: true }));

  if (fallbackPage) {
    return await ensureCleanNavigationResponse(fallbackPage);
  }

  return new Response(
    '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Physics Smart</title><body style="background:#060B18;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center"><div><h2>Physics Smart</h2><p>أنت غير متصل بالإنترنت حاليًا. يرجى إعادة المحاولة.</p></div></body></html>',
    {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

// Explicit route for /offline.html (always available from precache)
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname === '/offline.html',
  async () => {
    const cached =
      (await matchPrecache('/offline.html')) ||
      (await matchPrecache('offline.html')) ||
      (await self.caches.match('/offline.html', { ignoreSearch: true }));
    if (cached) return cached;
    return fetch('/offline.html');
  }
);

// Explicit route for /manifest.webmanifest so tablet PWA metadata never fails offline
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname === '/manifest.webmanifest',
  async () => {
    const cached =
      (await matchPrecache('/manifest.webmanifest')) ||
      (await matchPrecache('manifest.webmanifest')) ||
      (await self.caches.match('/manifest.webmanifest', { ignoreSearch: true }));
    if (cached) return cached;
    return fetch('/manifest.webmanifest');
  }
);

// 3. Offline educational PDFs (shared cache bucket with contentDownloader.ts)
registerRoute(
  ({ url }) => url.origin === self.location.origin && /^\/assets\/.*\.pdf$/i.test(url.pathname),
  new CacheFirst({
    cacheName: OFFLINE_MEDIA_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 60 * 60 * 24 * 180,
      }),
    ],
  })
);

// 4. Same-origin images & icons: Cache First (reject 404/HTML error responses)
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    (request.destination === 'image' || /\.(png|jpe?g|webp|svg|ico)$/i.test(url.pathname)),
  new CacheFirst({
    cacheName: IMAGES_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      {
        cacheWillUpdate: async ({ response }) => {
          if (!response || response.status !== 200) return null;
          const ct = response.headers.get('content-type') || '';
          if (ct.includes('text/html')) return null;
          return response;
        },
      },
      new ExpirationPlugin({
        maxEntries: 80,
        maxAgeSeconds: 60 * 60 * 24 * 90,
      }),
    ],
  })
);

// 5. Same-origin versioned JS/CSS/Fonts under /assets/: Cache First (never cache HTML error responses)
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'),
  new CacheFirst({
    cacheName: ASSETS_RUNTIME_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      {
        cacheWillUpdate: async ({ response }) => {
          if (!response || response.status !== 200) return null;
          const ct = response.headers.get('content-type') || '';
          if (ct.includes('text/html')) return null;
          return response;
        },
      },
      new ExpirationPlugin({
        maxEntries: 150,
        maxAgeSeconds: 60 * 60 * 24 * 180,
      }),
    ],
  })
);

// 6. Google Fonts stylesheets & webfonts: Cache First
registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: GOOGLE_FONTS_CSS_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 12,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  })
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: GOOGLE_FONTS_BIN_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  })
);

// Global fallback catch handler for offline errors
setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') {
    const cached =
      (await matchPrecache('/index.html')) ||
      (await matchPrecache('index.html')) ||
      (await self.caches.match('/index.html', { ignoreSearch: true })) ||
      (await matchPrecache('/offline.html')) ||
      (await matchPrecache('offline.html')) ||
      (await self.caches.match('/offline.html', { ignoreSearch: true }));
    if (cached) return await ensureCleanNavigationResponse(cached);
  }
  return Response.error();
});
