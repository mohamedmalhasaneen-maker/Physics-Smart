import React, { useCallback, useEffect, useState } from 'react';
import { Language } from '../types/physics';
import {
  PwaDiagnosticsSnapshot,
  clearPwaDiagErrors,
  collectPwaDiagnostics,
  recordPwaDiagError,
  runLocalOfflineCacheTest,
} from '../lib/pwaDiagnostics';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Play,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

interface OfflineDiagnosticsPanelProps {
  lang: Language;
}

export function OfflineDiagnosticsPanel({ lang }: OfflineDiagnosticsPanelProps) {
  const [diag, setDiag] = useState<PwaDiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [cacheTestResult, setCacheTestResult] = useState<{
    ok: boolean;
    detail: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await collectPwaDiagnostics();
      setDiag(snap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCheckSwUpdate = async () => {
    if (!('serviceWorker' in navigator)) return;
    setActionMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setActionMsg(
          lang === 'ar'
            ? 'لا يوجد Service Worker مسجّل حاليًا لإجراء تحديث.'
            : 'No Service Worker registration found.'
        );
        return;
      }
      await reg.update();
      setActionMsg(
        lang === 'ar'
          ? 'تم فحص تحديثات Service Worker وإعادة فحص التخزين المحلي.'
          : 'Checked Service Worker updates and refreshed cache status.'
      );
      await refresh();
    } catch (err) {
      recordPwaDiagError('registration', err);
      setActionMsg(err instanceof Error ? err.message : String(err));
      await refresh();
    }
  };

  const handleActivateWaiting = async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        setActionMsg(
          lang === 'ar'
            ? 'تم إرسال أمر التفعيل الفوري (SKIP_WAITING) للنسخة المنتظرة.'
            : 'Sent SKIP_WAITING to the waiting Service Worker.'
        );
        window.setTimeout(() => refresh(), 500);
      }
    } catch (err) {
      recordPwaDiagError('install', err);
      await refresh();
    }
  };

  const handleRunCacheReadbackTest = async () => {
    const res = await runLocalOfflineCacheTest();
    setCacheTestResult({ ok: res.ok, detail: res.detail });
    await refresh();
  };

  const handleClearErrors = async () => {
    clearPwaDiagErrors();
    setCacheTestResult(null);
    setActionMsg(null);
    await refresh();
  };

  const isDevSw = Boolean(diag?.scriptURL && diag.scriptURL.includes('dev-sw.js'));

  return (
    <div className="rounded-2xl glass-subcard p-4 sm:p-5 space-y-4 border border-slate-300/60 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="glass-icon glass-icon-cyan w-8 h-8">
            <Activity className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold">
              {lang === 'ar'
                ? 'تشخيص المطور: حالة PWA والعمل دون إنترنت'
                : 'Developer Diagnostics: PWA & Offline Health'}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {lang === 'ar'
                ? 'فحص مباشر من المتصفح لـ Service Worker وCache Storage (دون عرض أي مفاتيح أو بيانات شخصية).'
                : 'Live browser inspection of Service Worker & Cache Storage (no API keys or PII exposed).'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{lang === 'ar' ? 'تحديث الفحص' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            onClick={handleCheckSwUpdate}
            className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-semibold cursor-pointer"
          >
            {lang === 'ar' ? 'فحص تحديث SW' : 'Update SW'}
          </button>
          <button
            type="button"
            onClick={handleRunCacheReadbackTest}
            className="px-3 py-1.5 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3 h-3" />
            <span>{lang === 'ar' ? 'اختبار قراءة App Shell' : 'Test App Shell Cache'}</span>
          </button>
        </div>
      </div>

      {isDevSw && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
          <span>
            {lang === 'ar'
              ? 'أنت حاليًا على بيئة التطوير/المعاينة (/dev-sw.js?dev-sw)، وفيها لا يولّد Vite حزم الـ precache النهائية. لاختبار Offline الحقيقي، اختبر نسخة الإنتاج المبنية (dist / Vercel).'
              : 'Currently running in Vite dev preview (/dev-sw.js?dev-sw), where precache bundles are empty. Real offline launch requires the built Production bundle (dist / Vercel).'}
          </span>
        </div>
      )}

      {diag && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
            {/* 1. Registration Status */}
            <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-1 border border-slate-200/60 dark:border-white/10">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Service Worker Registration
              </p>
              <p className="font-bold flex items-center gap-1.5">
                {diag.registrationStatus === 'registered' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                )}
                <span className="font-mono-num">{diag.registrationStatus}</span>
              </p>
              <p className="text-[11px] font-mono-num text-slate-500 truncate" title={diag.scriptURL || ''}>
                {diag.scriptURL ? new URL(diag.scriptURL).pathname + new URL(diag.scriptURL).search : 'none'}
              </p>
            </div>

            {/* 2. SW State */}
            <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-1 border border-slate-200/60 dark:border-white/10">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Service Worker State
              </p>
              <p className="font-bold font-mono-num">{diag.swState}</p>
              <p className="text-[11px] text-slate-500 font-mono-num">
                active:{diag.activeState || '-'} · wait:{diag.waitingState || '-'} · inst:{diag.installingState || '-'}
              </p>
            </div>

            {/* 3. Controller Status */}
            <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-1 border border-slate-200/60 dark:border-white/10">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Controller Status
              </p>
              <p className="font-bold flex items-center gap-1.5">
                {diag.controllerStatus.hasController ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                )}
                <span>
                  {diag.controllerStatus.hasController
                    ? `Controlling (${diag.controllerStatus.state || 'active'})`
                    : 'Not Controlling (null)'}
                </span>
              </p>
              {diag.swPingInfo && (
                <p className="text-[11px] font-mono-num text-cyan-600 dark:text-cyan-400">
                  {diag.swPingInfo.responded
                    ? `SW Ping OK · ${diag.swPingInfo.version || ''} (${diag.swPingInfo.precacheCount ?? 0} entries)`
                    : 'SW Ping No Response'}
                </p>
              )}
            </div>

            {/* 4. Scope */}
            <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-1 border border-slate-200/60 dark:border-white/10">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Service Worker Scope
              </p>
              <p className="font-bold font-mono-num truncate" title={diag.scope || ''}>
                {diag.scope || '—'}
              </p>
              <p className="text-[11px] text-slate-500">
                {diag.scopeCoversRoot
                  ? lang === 'ar'
                    ? 'يشمل الصفحة الرئيسية (/) وجميع المسارات'
                    : 'Covers root (/) & all SPA routes'
                  : lang === 'ar'
                  ? 'لا يغطي الجذر (/)'
                  : 'Root scope not covered'}
              </p>
            </div>

            {/* 5. index.html in Cache */}
            <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-1 border border-slate-200/60 dark:border-white/10">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {lang === 'ar' ? 'هل index.html محفوظ في Cache؟' : 'index.html in Cache?'}
              </p>
              <p className="font-bold flex items-center gap-1.5">
                {diag.hasIndexHtmlInCache.found ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                )}
                <span>
                  {diag.hasIndexHtmlInCache.found
                    ? lang === 'ar'
                      ? 'نعم (محفوظ)'
                      : 'Yes (Cached)'
                    : lang === 'ar'
                    ? 'لا (غير موجود)'
                    : 'No (Missing)'}
                </span>
              </p>
              <p className="text-[11px] font-mono-num text-slate-500 truncate">
                {diag.hasIndexHtmlInCache.matchedCache || '—'} · offline.html:{' '}
                {diag.hasOfflineHtmlInCache.found ? 'OK' : 'Missing'}
              </p>
            </div>

            {/* 6. JS & CSS Count */}
            <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-1 border border-slate-200/60 dark:border-white/10">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {lang === 'ar' ? 'ملفات JS و CSS المخزنة' : 'Cached JS & CSS Files'}
              </p>
              <p className="font-bold font-mono-num">
                JS: {diag.jsCount} · CSS: {diag.cssCount}
              </p>
              <p className="text-[11px] font-mono-num text-slate-500">
                Fonts: {diag.fontCount} · Images: {diag.imageCount}
              </p>
            </div>
          </div>

          {diag.waitingState && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2.5 text-xs">
              <span>
                {lang === 'ar'
                  ? 'توجد نسخة Service Worker في حالة انتظار (waiting).'
                  : 'A Service Worker update is currently waiting.'}
              </span>
              <button
                type="button"
                onClick={handleActivateWaiting}
                className="px-3 py-1 rounded-lg glass-btn-primary text-xs font-semibold cursor-pointer"
              >
                {lang === 'ar' ? 'تفعيل الآن' : 'Activate Now'}
              </button>
            </div>
          )}

          {/* Cache Storage Names */}
          <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-2 border border-slate-200/60 dark:border-white/10 text-xs">
            <p className="font-semibold flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-cyan-500" />
              <span>
                Cache Storage Names ({diag.cacheNames.length})
              </span>
            </p>
            {diag.cacheNames.length === 0 ? (
              <p className="text-[11px] text-rose-500">
                {lang === 'ar' ? 'لا توجد أي مخازن Cache Storage حاليًا.' : 'No Cache Storage buckets found.'}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {diag.cacheNames.map((c) => (
                  <span
                    key={c.name}
                    className="px-2.5 py-1 rounded-lg bg-slate-200/70 dark:bg-white/[0.06] font-mono-num text-[11px]"
                  >
                    {c.name} ({c.count})
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Errors & Last Offline Error */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-1.5 border border-slate-200/60 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {lang === 'ar' ? 'أخطاء التخزين والتسجيل' : 'Registration & Cache Errors'}
                </span>
                {(diag.registrationAndCacheErrors.length > 0 || diag.lastOfflineError) && (
                  <button
                    type="button"
                    onClick={handleClearErrors}
                    className="text-[11px] text-rose-500 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{lang === 'ar' ? 'مسح السجل' : 'Clear'}</span>
                  </button>
                )}
              </div>
              {diag.registrationAndCacheErrors.length === 0 ? (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  {lang === 'ar' ? 'لا توجد أخطاء مسجلة.' : 'No registration or cache errors recorded.'}
                </p>
              ) : (
                <ul className="space-y-1 max-h-28 overflow-y-auto font-mono-num text-[11px] text-rose-600 dark:text-rose-400">
                  {diag.registrationAndCacheErrors.map((e, i) => (
                    <li key={`${e.timestamp}-${i}`}>
                      [{e.category}] {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl bg-white/50 dark:bg-white/[0.03] p-3 space-y-1.5 border border-slate-200/60 dark:border-white/10">
              <p className="font-semibold">
                {lang === 'ar' ? 'آخر خطأ أثناء التشغيل Offline' : 'Last Offline Runtime Error'}
              </p>
              {diag.lastOfflineError ? (
                <p className="font-mono-num text-[11px] text-rose-600 dark:text-rose-400 break-words">
                  {new Date(diag.lastOfflineError.timestamp).toLocaleTimeString()} — {diag.lastOfflineError.message}
                </p>
              ) : (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  {lang === 'ar' ? 'لا يوجد خطأ Offline مسجّل.' : 'No offline launch error recorded.'}
                </p>
              )}
            </div>
          </div>

          {cacheTestResult && (
            <div
              className={`rounded-xl px-3.5 py-2.5 text-xs border ${
                cacheTestResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              }`}
            >
              {cacheTestResult.detail}
            </div>
          )}

          {actionMsg && (
            <p className="text-xs text-cyan-600 dark:text-cyan-300 bg-cyan-500/10 rounded-xl px-3 py-2">
              {actionMsg}
            </p>
          )}
        </>
      )}
    </div>
  );
}
