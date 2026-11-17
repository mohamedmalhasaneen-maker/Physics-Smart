import { useCallback, useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

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

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Check for new versions every 30 minutes when online
      window.setInterval(() => {
        if (navigator.onLine) {
          registration.update().catch(() => {});
        }
      }, 30 * 60 * 1000);
    },
    onRegisterError(err) {
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
