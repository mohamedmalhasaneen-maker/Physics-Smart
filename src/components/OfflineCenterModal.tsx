import React, { useEffect, useMemo, useState } from 'react';
import {
  Language,
  Lesson,
  QuestionItem,
  StudyLanguage,
  UserProfile,
} from '../types/physics';
import {
  DownloadPackRecord,
  FavoriteRecord,
  StorageBreakdownStats,
  StudyNoteRecord,
  clearOfflineMediaOnly,
  formatBytes,
  getStorageStats,
  requestPersistentStorage,
  saveOfflineNote,
  toggleFavoriteItem,
} from '../lib/offlineDb';
import {
  buildPackageEstimate,
  cancelPackageDownload,
  downloadContentPackage,
  isLessonAvailableOffline,
  pausePackageDownload,
  removeDownloadedPackage,
} from '../lib/contentDownloader';
import { SyncStatusSnapshot } from '../lib/offlineSync';
import { pickStudyText } from '../lib/bilingual';
import {
  Bookmark,
  CheckCircle2,
  CloudOff,
  Download,
  HardDrive,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { OfflineDiagnosticsPanel } from './OfflineDiagnosticsPanel';

interface OfflineCenterModalProps {
  open: boolean;
  initialTab: 'downloads' | 'storage' | 'saved';
  onClose: () => void;
  lang: Language;
  studyLang: StudyLanguage;
  profile: UserProfile;
  lessons: Lesson[];
  questions: QuestionItem[];
  downloadPacks: DownloadPackRecord[];
  onDownloadPacksChange: (next: DownloadPackRecord[]) => void;
  favorites: FavoriteRecord[];
  notes: StudyNoteRecord[];
  onRefreshSaved: () => Promise<void>;
  onOpenLesson: (lessonId: string) => void;
  syncStatus: SyncStatusSnapshot;
  isOnline: boolean;
  onTriggerSync: () => Promise<void>;
}

export function OfflineCenterModal({
  open,
  initialTab,
  onClose,
  lang,
  studyLang,
  profile,
  lessons,
  questions,
  downloadPacks,
  onDownloadPacksChange,
  favorites,
  notes,
  onRefreshSaved,
  onOpenLesson,
  syncStatus,
  isOnline,
  onTriggerSync,
}: OfflineCenterModalProps) {
  const [tab, setTab] = useState<'downloads' | 'storage' | 'saved'>(initialTab);
  const [stats, setStats] = useState<StorageBreakdownStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [storageMsg, setStorageMsg] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  const refreshStats = async () => {
    setLoadingStats(true);
    try {
      const s = await getStorageStats(profile.uid);
      setStats(s);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    if (open) {
      refreshStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, downloadPacks.length, favorites.length, notes.length]);

  const scopedLessons = useMemo(
    () =>
      lessons
        .filter((l) => l.track === profile.track && l.grade === profile.grade)
        .sort((a, b) => a.order - b.order),
    [lessons, profile.track, profile.grade]
  );

  const unitsList = useMemo(() => {
    const map = new Map<string, { unitId: string; titleAr: string; titleEn: string; items: Lesson[] }>();
    for (const l of scopedLessons) {
      if (!map.has(l.unitId)) {
        map.set(l.unitId, {
          unitId: l.unitId,
          titleAr: l.unitTitleAr,
          titleEn: l.unitTitleEn,
          items: [],
        });
      }
      map.get(l.unitId)!.items.push(l);
    }
    return Array.from(map.values());
  }, [scopedLessons]);

  const upsertPackInState = (updated: DownloadPackRecord) => {
    onDownloadPacksChange((() => {
      const exists = downloadPacks.some((p) => p.id === updated.id);
      if (updated.status === 'idle') {
        return downloadPacks.filter((p) => p.id !== updated.id);
      }
      return exists
        ? downloadPacks.map((p) => (p.id === updated.id ? updated : p))
        : [updated, ...downloadPacks];
    })());
  };

  const trackGradeTrack = profile.track === 'unset' ? 'thanawiya' : profile.track;

  const fullEstimate = useMemo(
    () =>
      buildPackageEstimate({
        scope: 'curriculum',
        lessons: scopedLessons,
        questions,
        track: trackGradeTrack,
        grade: profile.grade || 'grade3',
        titleAr: 'المنهج الكامل لصفك الحالي',
        titleEn: 'Full Track & Grade Curriculum',
      }),
    [scopedLessons, questions, trackGradeTrack, profile.grade]
  );

  const fullPack = downloadPacks.find((p) => p.id === fullEstimate.id);

  const handleStartDownload = async (estimate: ReturnType<typeof buildPackageEstimate>) => {
    await downloadContentPackage({
      estimate,
      allLessons: lessons,
      allQuestions: questions,
      onProgress: (pack) => upsertPackInState(pack),
    });
    await refreshStats();
  };

  const handleDeletePack = async (pack: DownloadPackRecord) => {
    await removeDownloadedPackage(pack);
    onDownloadPacksChange(downloadPacks.filter((p) => p.id !== pack.id));
    await refreshStats();
  };

  const handleClearMedia = async () => {
    await clearOfflineMediaOnly();
    onDownloadPacksChange([]);
    setStorageMsg(
      lang === 'ar'
        ? 'تم مسح ملفات التحميل المسبقة مع الحفاظ الكامل على تقدمك وملاحظاتك ومفضلاتك.'
        : 'Cleared downloaded media packages while keeping your study progress, notes & favorites intact.'
    );
    await refreshStats();
  };

  const handleRequestPersist = async () => {
    const granted = await requestPersistentStorage();
    setStorageMsg(
      granted
        ? lang === 'ar'
          ? 'تم تفعيل التخزين الدائم من المتصفح لحماية بياناتك المحلية.'
          : 'Persistent browser storage granted to protect your offline data.'
        : lang === 'ar'
        ? 'المتصفح يدير التخزين تلقائيًا في هذه الجلسة.'
        : 'Browser is managing storage persistence automatically for this session.'
    );
    await refreshStats();
  };

  if (!open) return null;

  const usagePct =
    stats && stats.quotaBytes > 0
      ? Math.min(100, Math.round((stats.usageBytes / stats.quotaBytes) * 100))
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-4xl max-h-[88vh] rounded-2xl glass-modal flex flex-col overflow-hidden glass-enter">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="glass-icon glass-icon-cyan w-9 h-9">
              <HardDrive className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-bold">
                {lang === 'ar'
                  ? 'مركز العمل دون إنترنت والتخزين الذكي'
                  : 'Offline Center, Downloads & Smart Storage'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {lang === 'ar'
                  ? 'حمّل المنهج أو الوحدات أو الدروس للدراسة دون شبكة، وتابع مساحة التخزين والمفضلة والملاحظات.'
                  : 'Download curricula, units, or lessons for offline study, inspect storage quota, and manage saved items.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl glass-btn-secondary cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-5 pt-3 flex flex-wrap gap-2 border-b border-slate-200/60 dark:border-white/10 pb-3">
          {[
            {
              id: 'downloads' as const,
              icon: <Download className="w-3.5 h-3.5" />,
              ar: 'التحميل المسبق للدروس',
              en: 'Offline Downloads',
            },
            {
              id: 'storage' as const,
              icon: <HardDrive className="w-3.5 h-3.5" />,
              ar: 'إدارة التخزين والمزامنة',
              en: 'Storage & Sync',
            },
            {
              id: 'saved' as const,
              icon: <Bookmark className="w-3.5 h-3.5" />,
              ar: `المفضلة والملاحظات (${favorites.length + notes.length})`,
              en: `Favorites & Notes (${favorites.length + notes.length})`,
            },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                tab === item.id ? 'glass-btn-primary text-white' : 'glass-btn-secondary'
              }`}
            >
              {item.icon}
              <span>{lang === 'ar' ? item.ar : item.en}</span>
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {tab === 'downloads' && (
            <div className="space-y-5">
              {/* Full Curriculum Pack */}
              <div className="rounded-2xl glass-subcard p-4 sm:p-5 space-y-3 border border-cyan-500/25">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                      {lang === 'ar' ? 'الحزمة الشاملة' : 'Complete Package'}
                    </p>
                    <h3 className="text-base font-bold">
                      {lang === 'ar'
                        ? `تحميل المنهج الكامل (${scopedLessons.length} دروس + بنك الأسئلة المرتبط)`
                        : `Download Full Curriculum (${scopedLessons.length} lessons + linked questions)`}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                      {lang === 'ar' ? 'الحجم التقديري:' : 'Estimated Size:'}{' '}
                      {formatBytes(fullPack?.totalBytes || fullEstimate.totalBytes)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {fullPack?.status === 'downloading' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => pausePackageDownload(fullPack.id)}
                          className="px-3 py-2 rounded-xl glass-btn-secondary text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>{lang === 'ar' ? 'إيقاف مؤقت' : 'Pause'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelPackageDownload(fullPack.id)}
                          className="px-3 py-2 rounded-xl glass-btn-secondary text-xs text-rose-500 font-semibold cursor-pointer"
                        >
                          {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                        </button>
                      </>
                    ) : fullPack?.status === 'paused' ? (
                      <button
                        type="button"
                        onClick={() => handleStartDownload(fullEstimate)}
                        className="px-3.5 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'استكمال التحميل' : 'Resume'}</span>
                      </button>
                    ) : fullPack?.status === 'completed' ? (
                      <>
                        <span className="px-2.5 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {lang === 'ar' ? 'متاح أوفلاين' : 'Available Offline'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeletePack(fullPack)}
                          className="p-2 rounded-xl glass-btn-secondary text-rose-500 cursor-pointer"
                          title={lang === 'ar' ? 'حذف الحزمة' : 'Delete Pack'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={scopedLessons.length === 0}
                        onClick={() => handleStartDownload(fullEstimate)}
                        className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'تحميل المنهج كاملًا' : 'Download Full Curriculum'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {fullPack && fullPack.status !== 'idle' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                      <span>{fullPack.status.toUpperCase()}</span>
                      <span>{fullPack.progressPct}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300"
                        style={{ width: `${fullPack.progressPct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Unit & Individual Lesson Downloads */}
              <div className="space-y-4">
                {unitsList.map((unit) => {
                  const unitEst = buildPackageEstimate({
                    scope: 'unit',
                    lessons: scopedLessons,
                    questions,
                    track: trackGradeTrack,
                    grade: profile.grade || 'grade3',
                    unitId: unit.unitId,
                    titleAr: unit.titleAr,
                    titleEn: unit.titleEn,
                  });
                  const unitPack = downloadPacks.find((p) => p.id === unitEst.id);

                  return (
                    <div key={unit.unitId} className="rounded-2xl glass-subcard p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold">
                            {pickStudyText(unit.titleAr, unit.titleEn, studyLang)}
                          </h4>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                            {unit.items.length} {lang === 'ar' ? 'دروس' : 'lessons'} · {formatBytes(unitEst.totalBytes)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {unitPack?.status === 'downloading' ? (
                            <>
                              <span className="text-xs font-mono-num text-cyan-500">{unitPack.progressPct}%</span>
                              <button
                                type="button"
                                onClick={() => pausePackageDownload(unitPack.id)}
                                className="px-2.5 py-1.5 rounded-lg glass-btn-secondary text-xs cursor-pointer"
                              >
                                <Pause className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : unitPack?.status === 'completed' ? (
                            <>
                              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {lang === 'ar' ? 'الوحدة محملة' : 'Unit Downloaded'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeletePack(unitPack)}
                                className="p-1.5 rounded-lg glass-btn-secondary text-rose-500 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartDownload(unitEst)}
                              className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5 text-cyan-500" />
                              <span>
                                {unitPack?.status === 'paused'
                                  ? lang === 'ar'
                                    ? 'استكمال'
                                    : 'Resume'
                                  : lang === 'ar'
                                  ? 'تحميل الوحدة'
                                  : 'Download Unit'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-white/10">
                        {unit.items.map((lesson) => {
                          const lessonEst = buildPackageEstimate({
                            scope: 'lesson',
                            lessons: scopedLessons,
                            questions,
                            track: trackGradeTrack,
                            grade: profile.grade || 'grade3',
                            lessonId: lesson.id,
                            titleAr: lesson.titleAr,
                            titleEn: lesson.titleEn,
                          });
                          const lessonPack = downloadPacks.find((p) => p.id === lessonEst.id);
                          const offlineState = isLessonAvailableOffline(lesson.id, downloadPacks);

                          return (
                            <div
                              key={lesson.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/40 dark:bg-white/[0.03] px-3 py-2.5 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold truncate">
                                  {pickStudyText(lesson.titleAr, lesson.titleEn, studyLang)}
                                </p>
                                <p className="text-[11px] text-slate-500 font-mono-num">
                                  {formatBytes(lessonPack?.totalBytes || lessonEst.totalBytes)}
                                  {lesson.resourceUrls?.pdf ? ' · PDF' : ''}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {lessonPack?.status === 'downloading' ? (
                                  <>
                                    <span className="font-mono-num text-cyan-500">{lessonPack.progressPct}%</span>
                                    <button
                                      type="button"
                                      onClick={() => pausePackageDownload(lessonPack.id)}
                                      className="p-1 rounded-lg glass-btn-secondary cursor-pointer"
                                    >
                                      <Pause className="w-3 h-3" />
                                    </button>
                                  </>
                                ) : offlineState.available ? (
                                  <>
                                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      {lang === 'ar' ? 'متاح أوفلاين' : 'Offline Ready'}
                                    </span>
                                    {lessonPack && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeletePack(lessonPack)}
                                        className="p-1 rounded-lg glass-btn-secondary text-rose-500 cursor-pointer"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleStartDownload(lessonEst)}
                                    className="px-2.5 py-1 rounded-lg glass-btn-secondary font-medium flex items-center gap-1 cursor-pointer"
                                  >
                                    <Download className="w-3 h-3 text-cyan-500" />
                                    <span>{lang === 'ar' ? 'تحميل' : 'Download'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'storage' && (
            <div className="space-y-5">
              {/* Storage Quota Summary */}
              <div className="rounded-2xl glass-subcard p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold">
                      {lang === 'ar' ? 'المساحة المستخدمة على الجهاز' : 'Local Device Storage Usage'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                      {loadingStats
                        ? lang === 'ar'
                          ? 'جارٍ الحساب...'
                          : 'Calculating...'
                        : stats
                        ? `${formatBytes(stats.usageBytes)} / ${
                            stats.quotaBytes > 0 ? formatBytes(stats.quotaBytes) : '—'
                          }`
                        : '—'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleRequestPersist}
                      className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span>
                        {stats?.persistentGranted
                          ? lang === 'ar'
                            ? 'التخزين محمي'
                            : 'Persistent Active'
                          : lang === 'ar'
                          ? 'تثبيت البيانات محليًا'
                          : 'Protect Local Data'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleClearMedia}
                      className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-semibold text-rose-500 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{lang === 'ar' ? 'حذف ملفات التحميل المسبقة' : 'Clear Downloaded Packs'}</span>
                    </button>
                  </div>
                </div>

                {stats && stats.quotaBytes > 0 && (
                  <div className="h-2.5 w-full rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                      style={{ width: `${Math.max(usagePct, 2)}%` }}
                    />
                  </div>
                )}

                {storageMsg && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-xl px-3 py-2">
                    {storageMsg}
                  </p>
                )}
              </div>

              {/* Breakdown Grid */}
              {stats && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  {[
                    {
                      ar: 'الدروس والمناهج والأسئلة',
                      en: 'Curricula & Question Bank',
                      val: formatBytes(stats.estimatedByStore.contentBytes),
                      sub: `${stats.counts.lessons} ${lang === 'ar' ? 'درس' : 'lessons'} · ${stats.counts.questions} ${lang === 'ar' ? 'سؤال' : 'questions'}`,
                    },
                    {
                      ar: 'ملفات الوسائط و PDF',
                      en: 'Downloaded PDFs & Media',
                      val: formatBytes(stats.estimatedByStore.mediaCacheBytes),
                      sub: `${stats.counts.downloadedPacks} ${lang === 'ar' ? 'حزم مكتملة' : 'packs ready'}`,
                    },
                    {
                      ar: 'التقدم ومحاولات الامتحانات',
                      en: 'Progress & Exam Attempts',
                      val: formatBytes(stats.estimatedByStore.userDataBytes),
                      sub: `${stats.counts.progress} ${lang === 'ar' ? 'تقدم' : 'progress'} · ${stats.counts.examAttempts} ${lang === 'ar' ? 'امتحان' : 'exams'}`,
                    },
                    {
                      ar: 'محادثات المدرس الذكي والصف',
                      en: 'AI Tutor History & Outbox',
                      val: formatBytes(stats.estimatedByStore.tutorHistoryBytes),
                      sub: `${stats.counts.tutorSessions} ${lang === 'ar' ? 'جلسة' : 'sessions'} · ${stats.counts.tutorOutbox} ${lang === 'ar' ? 'بالانتظار' : 'queued'}`,
                    },
                    {
                      ar: 'المفضلة والملاحظات الشخصية',
                      en: 'Favorites & Study Notes',
                      val: formatBytes(stats.estimatedByStore.favoritesNotesBytes),
                      sub: `${stats.counts.favorites} ${lang === 'ar' ? 'مفضلة' : 'favorites'} · ${stats.counts.notes} ${lang === 'ar' ? 'ملاحظة' : 'notes'}`,
                    },
                    {
                      ar: 'طابور المزامنة السحابية',
                      en: 'Cloud Sync Queue',
                      val: `${stats.counts.pendingSync} ${lang === 'ar' ? 'عناصر' : 'items'}`,
                      sub: formatBytes(stats.estimatedByStore.syncQueueBytes),
                    },
                  ].map((item, idx) => (
                    <div key={idx} className="rounded-xl glass-subcard p-3.5 space-y-1">
                      <p className="text-slate-500 dark:text-slate-400">{lang === 'ar' ? item.ar : item.en}</p>
                      <p className="text-base font-bold font-mono-num">{item.val}</p>
                      <p className="text-[11px] text-slate-500">{item.sub}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Sync Queue Control */}
              <div className="rounded-2xl glass-subcard p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs space-y-1">
                  <p className="font-bold flex items-center gap-2">
                    {!isOnline && <CloudOff className="w-4 h-4 text-amber-500" />}
                    {lang === 'ar' ? 'حالة المزامنة مع السحابة (Firebase)' : 'Cloud Sync Status (Firebase)'}
                  </p>
                  <p className="text-slate-500 dark:text-slate-400">
                    {syncStatus.pendingCount > 0
                      ? lang === 'ar'
                        ? `يوجد ${syncStatus.pendingCount} تعديلات محفوظة محليًا بانتظار الاتصال للمزامنة.`
                        : `${syncStatus.pendingCount} local updates waiting to sync automatically when online.`
                      : lang === 'ar'
                      ? 'جميع بياناتك المحلية متزامنة بالكامل.'
                      : 'All local progress, exams, and notes are up to date.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isOnline || syncStatus.state === 'syncing'}
                  onClick={onTriggerSync}
                  className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncStatus.state === 'syncing' ? 'animate-spin' : ''}`} />
                  <span>{lang === 'ar' ? 'مزامنة الآن' : 'Sync Now'}</span>
                </button>
              </div>

              {/* Developer PWA & Offline Diagnostics */}
              <OfflineDiagnosticsPanel lang={lang} />
            </div>
          )}

          {tab === 'saved' && (
            <div className="space-y-5">
              {/* Favorites Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-amber-500" />
                  {lang === 'ar' ? 'العناصر المحفوظة في المفضلة' : 'Bookmarked Favorites'}
                </h3>
                {favorites.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 glass-subcard rounded-xl p-4">
                    {lang === 'ar'
                      ? 'اضغط على أيقونة المفضلة داخل أي درس أو قانون لحفظه هنا والوصول إليه فورًا دون إنترنت.'
                      : 'Tap the bookmark icon on any lesson or formula to access it instantly offline.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {favorites.map((fav) => (
                      <div
                        key={fav.key}
                        className="rounded-xl glass-subcard px-4 py-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="text-[10px] uppercase font-mono-num text-cyan-600 dark:text-cyan-400">
                            {fav.itemType}
                          </span>
                          <p className="font-semibold text-sm truncate">
                            {pickStudyText(fav.titleAr, fav.titleEn, studyLang)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {fav.itemType === 'lesson' && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenLesson(fav.itemId);
                                onClose();
                              }}
                              className="px-3 py-1.5 rounded-lg glass-btn-primary text-xs font-semibold cursor-pointer"
                            >
                              {lang === 'ar' ? 'فتح الدرس' : 'Open Lesson'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              await toggleFavoriteItem({
                                uid: fav.uid,
                                itemType: fav.itemType,
                                itemId: fav.itemId,
                                titleAr: fav.titleAr,
                                titleEn: fav.titleEn,
                              });
                              await onRefreshSaved();
                            }}
                            className="p-1.5 rounded-lg glass-btn-secondary text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Study Notes Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <StickyNote className="w-4 h-4 text-cyan-500" />
                  {lang === 'ar' ? 'ملاحظاتك الدراسية المحفوظة أوفلاين' : 'Offline Study Notes'}
                </h3>
                {notes.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 glass-subcard rounded-xl p-4">
                    {lang === 'ar'
                      ? 'يمكنك كتابة ملاحظاتك داخل أي درس وستُحفظ محليًا تلقائيًا دون اتصال.'
                      : 'Write personal study notes inside any lesson and they are saved automatically offline.'}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {notes.map((n) => (
                      <div key={n.key} className="rounded-xl glass-subcard p-4 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm">{n.title}</span>
                          <div className="flex items-center gap-2">
                            {n.itemType === 'lesson' && (
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenLesson(n.itemId);
                                  onClose();
                                }}
                                className="text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                              >
                                {lang === 'ar' ? 'الدرس' : 'Open'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={async () => {
                                await saveOfflineNote({
                                  uid: n.uid,
                                  itemType: n.itemType,
                                  itemId: n.itemId,
                                  title: n.title,
                                  content: '',
                                });
                                await onRefreshSaved();
                              }}
                              className="text-rose-500 hover:underline cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300 leading-relaxed">
                          {n.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
