import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Language } from '../types/physics';
import { SyncStatusSnapshot } from '../lib/offlineSync';
import { usePWAInstall } from '../hooks/usePWA';
import {
  CheckCircle2,
  CloudOff,
  Download,
  HardDrive,
  RefreshCw,
  Share,
  Smartphone,
  Sparkles,
  Wifi,
  X,
} from 'lucide-react';

interface OfflineStatusBarProps {
  lang: Language;
  isOnline: boolean;
  syncStatus: SyncStatusSnapshot;
  downloadedPacksCount: number;
  favoritesCount: number;
  offlineReady: boolean;
  onDismissOfflineReady: () => void;
  needRefresh: boolean;
  updating: boolean;
  onApplyUpdate: () => void;
  onDismissUpdate: () => void;
  onTriggerSync: () => void;
  onOpenOfflineCenter: (tab?: 'downloads' | 'storage' | 'saved') => void;
}

export function OfflineStatusBar({
  lang,
  isOnline,
  syncStatus,
  downloadedPacksCount,
  offlineReady,
  onDismissOfflineReady,
  needRefresh,
  updating,
  onApplyUpdate,
  onDismissUpdate,
  onTriggerSync,
  onOpenOfflineCenter,
}: OfflineStatusBarProps) {
  const { canInstall, hasNativePrompt, isIOS, promptInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const handleInstallClick = async () => {
    if (hasNativePrompt) {
      await promptInstall();
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  // Determine sleek status badge label + tone
  let statusText = lang === 'ar' ? 'متصل' : 'Online';
  let statusIcon = <Wifi className="w-3.5 h-3.5 text-emerald-500" />;
  let statusTone = 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';

  if (!isOnline || syncStatus.state === 'offline') {
    statusText =
      syncStatus.pendingCount > 0
        ? lang === 'ar'
          ? `أوفلاين (${syncStatus.pendingCount} للمزامنة)`
          : `Offline (${syncStatus.pendingCount} queued)`
        : lang === 'ar'
        ? 'بدون إنترنت'
        : 'Offline Mode';
    statusIcon = <CloudOff className="w-3.5 h-3.5 text-amber-500" />;
    statusTone = 'border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300';
  } else if (syncStatus.state === 'syncing') {
    statusText = lang === 'ar' ? 'تتم المزامنة...' : 'Syncing...';
    statusIcon = <RefreshCw className="w-3.5 h-3.5 text-cyan-500 animate-spin" />;
    statusTone = 'border-cyan-500/30 bg-cyan-500/12 text-cyan-700 dark:text-cyan-300';
  } else if (syncStatus.pendingCount > 0) {
    statusText =
      lang === 'ar'
        ? `${syncStatus.pendingCount} بانتظار المزامنة`
        : `${syncStatus.pendingCount} pending sync`;
    statusIcon = <RefreshCw className="w-3.5 h-3.5 text-blue-500" />;
    statusTone = 'border-blue-500/30 bg-blue-500/12 text-blue-700 dark:text-blue-300';
  } else if (syncStatus.state === 'synced') {
    statusText = lang === 'ar' ? 'تم التحديث والمزامنة' : 'Synced';
    statusIcon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
  }

  return (
    <>
      <div className="flex items-center gap-2 shrink-0">
        {/* Connectivity & Sync State Pill */}
        <button
          type="button"
          onClick={() => (isOnline && syncStatus.pendingCount > 0 ? onTriggerSync() : onOpenOfflineCenter('storage'))}
          title={
            lang === 'ar'
              ? 'حالة الاتصال والمزامنة وإدارة التخزين'
              : 'Connectivity, sync queue & storage status'
          }
          className={`min-w-[40px] min-h-[40px] lg:min-w-0 lg:min-h-0 px-2.5 py-2 lg:py-1.5 rounded-xl border backdrop-blur-md text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer whitespace-nowrap ${statusTone}`}
        >
          {statusIcon}
          <span className="hidden sm:inline">{statusText}</span>
        </button>

        {/* Offline Center / Downloads Manager trigger */}
        <button
          type="button"
          onClick={() => onOpenOfflineCenter('downloads')}
          title={lang === 'ar' ? 'مكتبة أوفلاين وإدارة التخزين والمفضلة' : 'Offline Downloads, Storage & Saved'}
          className="min-w-[40px] min-h-[40px] lg:min-w-0 lg:min-h-0 px-2.5 py-2 lg:py-1.5 rounded-xl glass-btn-secondary text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer whitespace-nowrap"
        >
          <HardDrive className="w-4 h-4 lg:w-3.5 lg:h-3.5 text-blue-600 dark:text-cyan-400" />
          <span className="hidden xl:inline">
            {lang === 'ar' ? 'التحميلات أوفلاين' : 'Offline Pack'}
          </span>
          {downloadedPacksCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-md bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 font-mono-num text-[10px]">
              {downloadedPacksCount}
            </span>
          )}
        </button>

        {/* PWA Install Button */}
        {canInstall && (
          <button
            type="button"
            onClick={handleInstallClick}
            title={lang === 'ar' ? 'تثبيت التطبيق على جهازك' : 'Install Physics Smart App'}
            className="min-w-[40px] min-h-[40px] lg:min-w-0 lg:min-h-0 px-2.5 py-2 lg:py-1.5 rounded-xl glass-btn-primary text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
            <span className="hidden md:inline">
              {lang === 'ar' ? 'تثبيت التطبيق' : 'Install App'}
            </span>
          </button>
        )}
      </div>

      {/* Portal floating notifications & iOS guide to document.body so header backdrop-filter never traps position:fixed */}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            {/* Offline Ready Toast (bottom side corner of viewport) */}
            {offlineReady && (
              <div className="fixed bottom-5 end-5 z-50 w-[calc(100vw-2.5rem)] max-w-xs sm:max-w-sm rounded-2xl glass-modal p-3.5 shadow-xl flex items-start gap-3 glass-enter">
                <span className="glass-icon glass-icon-emerald w-8 h-8 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </span>
                <div className="flex-1 text-xs space-y-1">
                  <p className="font-bold text-slate-900 dark:text-white">
                    {lang === 'ar' ? 'التطبيق جاهز للعمل دون إنترنت' : 'App Ready for Offline Use'}
                  </p>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {lang === 'ar'
                      ? 'تم حفظ ملفات المنصة الأساسية محليًا. يمكنك أيضًا تحميل الدروس من مدير التحميلات.'
                      : 'Core app files cached locally. You can also download units from the Offline Manager.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onDismissOfflineReady}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Safe Update Available Toast (never blocks or shows during active exam) */}
            {needRefresh && (
              <div className="fixed bottom-5 start-5 z-50 w-[calc(100vw-2.5rem)] max-w-xs sm:max-w-sm rounded-2xl glass-modal p-4 shadow-xl space-y-3 glass-enter border border-cyan-500/30">
                <div className="flex items-start gap-3">
                  <span className="glass-icon glass-icon-cyan w-9 h-9 shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <div className="flex-1 text-xs space-y-1">
                    <p className="font-bold text-slate-900 dark:text-white">
                      {lang === 'ar' ? 'يتوفر تحديث جديد للمنصة' : 'New Version Available'}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                      {lang === 'ar'
                        ? 'تم تحميل التحديث في الخلفية ولن تتأثر بياناتك أو تقدمك المحفوظ.'
                        : 'Update cached safely in background. Your offline progress & notes remain preserved.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onDismissUpdate}
                    className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium cursor-pointer"
                  >
                    {lang === 'ar' ? 'لاحقًا' : 'Later'}
                  </button>
                  <button
                    type="button"
                    disabled={updating}
                    onClick={onApplyUpdate}
                    className="px-3.5 py-1.5 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${updating ? 'animate-spin' : ''}`} />
                    <span>{lang === 'ar' ? 'تحديث الآن' : 'Update Now'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* iOS Safari Installation Guide Modal */}
            {showIOSGuide && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm" onClick={() => setShowIOSGuide(false)} />
                <div className="relative z-10 w-full max-w-md rounded-2xl glass-modal p-6 space-y-4 glass-enter">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="glass-icon glass-icon-cyan w-9 h-9">
                        <Smartphone className="w-4 h-4" />
                      </span>
                      <h3 className="text-base font-bold">
                        {lang === 'ar' ? 'تثبيت التطبيق على iPhone / iPad' : 'Install on iPhone / iPad'}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowIOSGuide(false)}
                      className="p-1.5 rounded-xl glass-btn-secondary cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <ol className="space-y-3 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                    <li className="flex items-center gap-2.5 glass-subcard p-3 rounded-xl">
                      <span className="font-mono-num font-bold text-cyan-500">1.</span>
                      <span className="flex-1">
                        {lang === 'ar'
                          ? 'افتح هذه الصفحة في متصفح Safari واضغط على زر المشاركة'
                          : 'Open this site in Safari and tap the Share icon'}
                      </span>
                      <Share className="w-4 h-4 text-blue-500 shrink-0" />
                    </li>
                    <li className="flex items-center gap-2.5 glass-subcard p-3 rounded-xl">
                      <span className="font-mono-num font-bold text-cyan-500">2.</span>
                      <span>
                        {lang === 'ar'
                          ? 'اختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen)'
                          : 'Select "Add to Home Screen" from the share sheet'}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5 glass-subcard p-3 rounded-xl">
                      <span className="font-mono-num font-bold text-cyan-500">3.</span>
                      <span>
                        {lang === 'ar'
                          ? 'اضغط «إضافة» وسيعمل التطبيق في وضع الشاشة الكاملة دون إنترنت.'
                          : 'Tap Add — Physics Smart will launch standalone and work offline.'}
                      </span>
                    </li>
                  </ol>
                </div>
              </div>
            )}
          </>,
          document.body
        )}
    </>
  );
}
