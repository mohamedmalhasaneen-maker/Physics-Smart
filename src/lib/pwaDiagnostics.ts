export interface PwaDiagErrorEntry {
  timestamp: number;
  category: 'registration' | 'install' | 'cache' | 'offline';
  message: string;
}

export interface PwaDiagnosticsSnapshot {
  checkedAt: number;
  isSupported: boolean;
  isOnline: boolean;
  isSecureContext: boolean;
  origin: string;
  registrationStatus: 'registered' | 'not_registered' | 'unsupported' | 'error';
  scriptURL: string | null;
  swState: string;
  installingState: string | null;
  waitingState: string | null;
  activeState: string | null;
  controllerStatus: {
    hasController: boolean;
    state: string | null;
    scriptURL: string | null;
  };
  scope: string | null;
  scopeCoversRoot: boolean;
  cacheNames: Array<{ name: string; count: number }>;
  hasIndexHtmlInCache: {
    found: boolean;
    matchedCache: string | null;
  };
  hasOfflineHtmlInCache: {
    found: boolean;
    matchedCache: string | null;
  };
  jsCount: number;
  cssCount: number;
  fontCount: number;
  imageCount: number;
  registrationAndCacheErrors: PwaDiagErrorEntry[];
  lastOfflineError: PwaDiagErrorEntry | null;
  swPingInfo: {
    responded: boolean;
    version?: string;
    precacheCount?: number;
    deferredMediaCount?: number;
  } | null;
  storagePersisted: boolean | null;
  storageQuotaBytes: number;
  storageUsageBytes: number;
  formFactorHint: {
    displayMode: 'standalone' | 'minimal-ui' | 'fullscreen' | 'browser';
    maxTouchPoints: number;
    isTouchDevice: boolean;
    isDesktopModeTabletHint: boolean;
    viewportWidth: number;
  };
}

const DIAG_STORAGE_KEY = 'ps_pwa_diag_errors_v1';
const MAX_DIAG_ERRORS = 15;

function sanitizeErrorMessage(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw || 'Unknown error');
  // Strip any accidental query tokens or long keys
  return msg
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
    .replace(/Bearer\s+[0-9A-Za-z._-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 260);
}

export function readPwaDiagErrors(): PwaDiagErrorEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DIAG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.timestamp === 'number' &&
        typeof item.category === 'string' &&
        typeof item.message === 'string'
    );
  } catch {
    return [];
  }
}

export function recordPwaDiagError(
  category: PwaDiagErrorEntry['category'],
  error: unknown
): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readPwaDiagErrors();
    const nextEntry: PwaDiagErrorEntry = {
      timestamp: Date.now(),
      category,
      message: sanitizeErrorMessage(error),
    };
    const next = [nextEntry, ...existing].slice(0, MAX_DIAG_ERRORS);
    window.localStorage.setItem(DIAG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // non-blocking
  }
}

export function clearPwaDiagErrors(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DIAG_STORAGE_KEY);
  } catch {
    // non-blocking
  }
}

async function pingActiveServiceWorker(controller: ServiceWorker | null): Promise<{
  responded: boolean;
  version?: string;
  precacheCount?: number;
  deferredMediaCount?: number;
} | null> {
  if (!controller || typeof MessageChannel === 'undefined') return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      resolve({ responded: false });
    }, 900);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const data = event?.data;
      if (data && typeof data === 'object') {
        resolve({
          responded: true,
          version: typeof data.version === 'string' ? data.version : undefined,
          precacheCount: typeof data.precacheCount === 'number' ? data.precacheCount : undefined,
          deferredMediaCount: typeof data.deferredMediaCount === 'number' ? data.deferredMediaCount : undefined,
        });
      } else {
        resolve({ responded: true });
      }
    };

    try {
      controller.postMessage({ type: 'GET_DIAGNOSTICS' }, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      resolve({ responded: false });
    }
  });
}

export async function collectPwaDiagnostics(): Promise<PwaDiagnosticsSnapshot> {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const isSecureContext = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
  const hasSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const hasCaches = typeof window !== 'undefined' && 'caches' in window;
  const isSupported = hasSw && hasCaches;

  let registrationStatus: PwaDiagnosticsSnapshot['registrationStatus'] = isSupported
    ? 'not_registered'
    : 'unsupported';
  let scriptURL: string | null = null;
  let installingState: string | null = null;
  let waitingState: string | null = null;
  let activeState: string | null = null;
  let scope: string | null = null;
  let scopeCoversRoot = false;
  let controllerStatus: PwaDiagnosticsSnapshot['controllerStatus'] = {
    hasController: false,
    state: null,
    scriptURL: null,
  };
  let swPingInfo: PwaDiagnosticsSnapshot['swPingInfo'] = null;

  if (hasSw) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        registrationStatus = 'registered';
        scope = reg.scope || null;
        scopeCoversRoot = Boolean(scope && origin && (scope === `${origin}/` || scope === origin));
        installingState = reg.installing?.state || null;
        waitingState = reg.waiting?.state || null;
        activeState = reg.active?.state || null;
        scriptURL =
          reg.active?.scriptURL ||
          reg.waiting?.scriptURL ||
          reg.installing?.scriptURL ||
          null;
      }

      const ctrl = navigator.serviceWorker.controller;
      if (ctrl) {
        controllerStatus = {
          hasController: true,
          state: ctrl.state || null,
          scriptURL: ctrl.scriptURL || null,
        };
        swPingInfo = await pingActiveServiceWorker(ctrl);
      }
    } catch (err) {
      registrationStatus = 'error';
      recordPwaDiagError('registration', err);
    }
  }

  const swState = activeState || waitingState || installingState || 'none';

  const cacheNames: Array<{ name: string; count: number }> = [];
  let hasIndexHtmlInCache: PwaDiagnosticsSnapshot['hasIndexHtmlInCache'] = {
    found: false,
    matchedCache: null,
  };
  let hasOfflineHtmlInCache: PwaDiagnosticsSnapshot['hasOfflineHtmlInCache'] = {
    found: false,
    matchedCache: null,
  };

  const uniqueJs = new Set<string>();
  const uniqueCss = new Set<string>();
  const uniqueFonts = new Set<string>();
  const uniqueImages = new Set<string>();

  if (hasCaches) {
    try {
      const keys = await window.caches.keys();
      for (const name of keys) {
        const bucket = await window.caches.open(name);
        const requests = await bucket.keys();
        cacheNames.push({ name, count: requests.length });

        for (const req of requests) {
          let pathname = '';
          try {
            pathname = new URL(req.url).pathname;
          } catch {
            pathname = req.url;
          }

          if (pathname === '/index.html' || pathname === '/') {
            if (!hasIndexHtmlInCache.found) {
              hasIndexHtmlInCache = { found: true, matchedCache: name };
            }
          } else if (pathname === '/offline.html') {
            if (!hasOfflineHtmlInCache.found) {
              hasOfflineHtmlInCache = { found: true, matchedCache: name };
            }
          } else if (/\.(js|mjs)$/i.test(pathname)) {
            uniqueJs.add(pathname);
          } else if (/\.css$/i.test(pathname)) {
            uniqueCss.add(pathname);
          } else if (/\.(woff2?|ttf|otf)$/i.test(pathname)) {
            uniqueFonts.add(pathname);
          } else if (/\.(png|jpe?g|webp|svg|ico)$/i.test(pathname)) {
            uniqueImages.add(pathname);
          }
        }
      }

      if (!hasIndexHtmlInCache.found) {
        const directMatch = await window.caches.match('/index.html', { ignoreSearch: true });
        if (directMatch) {
          hasIndexHtmlInCache = { found: true, matchedCache: 'CacheStorage.match' };
        }
      }
      if (!hasOfflineHtmlInCache.found) {
        const offlineMatch = await window.caches.match('/offline.html', { ignoreSearch: true });
        if (offlineMatch) {
          hasOfflineHtmlInCache = { found: true, matchedCache: 'CacheStorage.match' };
        }
      }
    } catch (err) {
      recordPwaDiagError('cache', err);
    }
  }

  let storagePersisted: boolean | null = null;
  let storageQuotaBytes = 0;
  let storageUsageBytes = 0;
  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (typeof navigator.storage.persisted === 'function') {
        storagePersisted = await navigator.storage.persisted();
      }
    } catch {
      // non-blocking
    }
    try {
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        storageQuotaBytes = est.quota || 0;
        storageUsageBytes = est.usage || 0;
      }
    } catch {
      // non-blocking
    }
  }

  let displayMode: PwaDiagnosticsSnapshot['formFactorHint']['displayMode'] = 'browser';
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    ) {
      displayMode = 'standalone';
    } else if (window.matchMedia('(display-mode: minimal-ui)').matches) {
      displayMode = 'minimal-ui';
    } else if (window.matchMedia('(display-mode: fullscreen)').matches) {
      displayMode = 'fullscreen';
    }
  }
  const maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isTouchDevice = maxTouchPoints > 0 || (typeof window !== 'undefined' && 'ontouchstart' in window);
  const isDesktopModeTabletHint =
    isTouchDevice && (/X11;\s*Linux/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1));
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;

  const allErrors = readPwaDiagErrors();
  const registrationAndCacheErrors = allErrors.filter(
    (e) => e.category === 'registration' || e.category === 'install' || e.category === 'cache'
  );
  const lastOfflineError = allErrors.find((e) => e.category === 'offline') || null;

  return {
    checkedAt: Date.now(),
    isSupported,
    isOnline,
    isSecureContext,
    origin,
    registrationStatus,
    scriptURL,
    swState,
    installingState,
    waitingState,
    activeState,
    controllerStatus,
    scope,
    scopeCoversRoot,
    cacheNames,
    hasIndexHtmlInCache,
    hasOfflineHtmlInCache,
    jsCount: uniqueJs.size,
    cssCount: uniqueCss.size,
    fontCount: uniqueFonts.size,
    imageCount: uniqueImages.size,
    registrationAndCacheErrors,
    lastOfflineError,
    swPingInfo,
    storagePersisted,
    storageQuotaBytes,
    storageUsageBytes,
    formFactorHint: {
      displayMode,
      maxTouchPoints,
      isTouchDevice,
      isDesktopModeTabletHint,
      viewportWidth,
    },
  };
}

export async function runLocalOfflineCacheTest(): Promise<{
  ok: boolean;
  indexSizeBytes: number;
  offlineFallbackSizeBytes: number;
  detail: string;
}> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return {
      ok: false,
      indexSizeBytes: 0,
      offlineFallbackSizeBytes: 0,
      detail: 'Cache Storage API is not supported in this browser.',
    };
  }
  try {
    const indexRes =
      (await window.caches.match('/index.html', { ignoreSearch: true })) ||
      (await window.caches.match('/', { ignoreSearch: true }));
    const offlineRes = await window.caches.match('/offline.html', { ignoreSearch: true });

    const indexText = indexRes ? await indexRes.clone().text() : '';
    const offlineText = offlineRes ? await offlineRes.clone().text() : '';
    const hasRootDiv = indexText.includes('id="root"') || indexText.includes("id='root'");
    const ok = Boolean(indexRes && indexRes.ok && hasRootDiv);

    if (!ok) {
      recordPwaDiagError(
        'offline',
        indexRes
          ? 'Cached /index.html response lacked #root app container.'
          : 'index.html was not found in local Cache Storage.'
      );
    }

    return {
      ok,
      indexSizeBytes: indexText.length,
      offlineFallbackSizeBytes: offlineText.length,
      detail: ok
        ? `App Shell verified locally (${indexText.length} chars) + offline fallback (${offlineText.length} chars).`
        : indexRes
        ? 'Cached index.html is invalid or incomplete.'
        : 'index.html is missing from Cache Storage (Service Worker not yet installed or running in Vite dev mode).',
    };
  } catch (err) {
    recordPwaDiagError('offline', err);
    return {
      ok: false,
      indexSizeBytes: 0,
      offlineFallbackSizeBytes: 0,
      detail: sanitizeErrorMessage(err),
    };
  }
}
