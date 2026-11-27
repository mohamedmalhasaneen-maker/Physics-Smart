import { useCallback, useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { recordPwaDiagError } from '../lib/pwaDiagnostics';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    setIsInstalled(standalone);

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === 'accepted';
  }, [deferredPrompt]);

  return {
    canInstall: !isInstalled && (deferredPrompt !== null || isIOS),
    hasNativePrompt: deferredPrompt !== null,
    isIOS,
    isInstalled,
    promptInstall,
  };
}

export function useSWUpdates(options?: { deferReload?: boolean }) {
  const deferReload = Boolean(options?.deferReload);
  const [offlineReadyDismissed, setOfflineReadyDismissed] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        recordPwaDiagError('offline', event.message || 'Offline script error');
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        recordPwaDiagError('offline', event.reason || 'Offline promise rejection');
      }
    };
    const onSwMessage = (event: MessageEvent) => {
      if (event?.data?.type === 'SW_DIAG_ERROR') {
        recordPwaDiagError('offline', event.data.message || 'Service Worker offline error');
      }
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onRejection);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage);
    }
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onRejection);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      }
    };
  }, []);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const watchWorker = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'redundant') {
            recordPwaDiagError('install', `Service Worker (${worker.scriptURL}) became redundant during install/update.`);
          }
        });
      };

      watchWorker(registration.installing);
      registration.addEventListener('updatefound', () => {
        watchWorker(registration.installing);
      });

      const checkUpdate = () => {
        if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
          registration.update().catch((err) => {
            recordPwaDiagError('registration', err);
          });
        }
      };

      checkUpdate();
      window.setInterval(checkUpdate, 30 * 60 * 1000);
      window.addEventListener('online', checkUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkUpdate();
        }
      });
    },
    onRegisterError(err) {
      recordPwaDiagError('registration', err);
      console.warn('Service worker registration warning:', err);
    },
  });

  // Reset dismissal when a fresh update arrives
  useEffect(() => {
    if (needRefresh) setUpdateDismissed(false);
  }, [needRefresh]);

  const applyUpdate = useCallback(async () => {
    if (deferReload || updating) return;
    setUpdating(true);
    try {
      await updateServiceWorker(true);
    } finally {
      setUpdating(false);
    }
  }, [deferReload, updating, updateServiceWorker]);

  return {
    offlineReady: offlineReady && !offlineReadyDismissed,
    dismissOfflineReady: () => {
      setOfflineReadyDismissed(true);
      setOfflineReady(false);
    },
    needRefresh: needRefresh && !updateDismissed && !deferReload,
    hasPendingUpdateWhileDeferred: needRefresh && deferReload,
    updating,
    applyUpdate,
    dismissUpdate: () => {
      setUpdateDismissed(true);
      setNeedRefresh(false);
    },
  };
}
