import React from 'react';
import {
  ExamAttempt,
  Language,
  Lesson,
  LessonProgress,
  NavSection,
  StudyLanguage,
  StudyTask,
  UserProfile,
} from '../types/physics';
import { getGradeLabel, getTrackLabel } from '../data/tracks';
import { pickStudyText } from '../lib/bilingual';
import { BilingualTextBlock, BilingualTitle, StudyLanguageSwitcher } from './BilingualBlock';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  Calculator,
  CalendarClock,
  CheckCircle2,
  FlaskConical,
  Languages,
  LineChart,
  Play,
  Sparkles,
  Target,
  Trophy,
} from 'lucide-react';

interface DashboardViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  onChangeStudyLang: (next: StudyLanguage) => void;
  profile: UserProfile;
  lessons: Lesson[];
  progressMap: Record<string, LessonProgress>;
  examAttempts: ExamAttempt[];
  studyTasks: StudyTask[];
  announcements: Array<{ id: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }>;
  onNavigate: (section: NavSection) => void;
  onOpenLesson: (lessonId: string) => void;
  onToggleTask: (task: StudyTask) => void;
}

export function DashboardView({
  lang,
  studyLang,
  onChangeStudyLang,
  profile,
  lessons,
  progressMap,
  examAttempts,
  studyTasks,
  announcements,
  onNavigate,
  onOpenLesson,
  onToggleTask,
}: DashboardViewProps) {
  const trackLabel = getTrackLabel(profile.track, studyLang);
  const gradeLabel = getGradeLabel(profile.track, profile.grade, studyLang);

  // Strict track + grade filtered lessons
  const scopedLessons = lessons.filter((l) => l.track === profile.track && l.grade === profile.grade);
  const completedLessons = scopedLessons.filter((l) => progressMap[l.id]?.isCompleted);
  const completionPct =
    scopedLessons.length > 0 ? Math.round((completedLessons.length / scopedLessons.length) * 100) : 0;

  // Last studied lesson
  const sortedProgress = Object.values(progressMap)
    .filter((p) => scopedLessons.some((l) => l.id === p.lessonId))
    .sort((a, b) => {
      const ta = a.updatedAt?.seconds || 0;
      const tb = b.updatedAt?.seconds || 0;
      return tb - ta;
    });
  const lastLessonId = sortedProgress[0]?.lessonId || scopedLessons[0]?.id;
  const lastLesson = scopedLessons.find((l) => l.id === lastLessonId) || scopedLessons[0];

  const submittedAttempts = examAttempts.filter((a) => a.status === 'submitted');
  const latestAttempt = submittedAttempts[0];

  // Strengths & weaknesses derived from real quiz/exam data
  const weakLessons = scopedLessons.filter(
    (l) => progressMap[l.id] && progressMap[l.id].quizScore > 0 && progressMap[l.id].quizScore < 70
  );
  const strongLessons = scopedLessons.filter(
    (l) => progressMap[l.id] && progressMap[l.id].quizScore >= 80
  );
  const nextSuggested = scopedLessons.filter((l) => !progressMap[l.id]?.isCompleted).slice(0, 3);

  const todayTasks = studyTasks.filter((t) => !t.completed).slice(0, 4);
  const DirArrow = lang === 'ar' ? ArrowLeft : ArrowRight;

  // 7-day activity data from progressMap
  const chartData = React.useMemo(() => {
    const days: Array<{ dateStr: string; label: string; studyMinutes: number; completedCount: number }> = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      days.push({ dateStr, label, studyMinutes: 0, completedCount: 0 });
    }

    Object.values(progressMap).forEach((p) => {
      const ts = p.lastAccessedAt || p.updatedAt;
      let dateKey = '';
      if (ts && typeof ts === 'object' && 'seconds' in ts) {
        dateKey = new Date(ts.seconds * 1000).toISOString().slice(0, 10);
      } else if (typeof ts === 'string') {
        dateKey = ts.slice(0, 10);
      } else if (ts instanceof Date) {
        dateKey = ts.toISOString().slice(0, 10);
      }
      const match = days.find((day) => day.dateStr === dateKey);
      if (match) {
        match.studyMinutes += p.studyMinutes || 15;
        if (p.isCompleted) match.completedCount += 1;
      }
    });

    return days;
  }, [progressMap, lang]);

  const shortcuts: Array<{ id: NavSection; labelAr: string; labelEn: string; icon: React.ReactNode }> = [
    { id: 'curriculum', labelAr: 'المناهج والدروس', labelEn: 'Curriculum', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'tutor', labelAr: 'المدرس الذكي', labelEn: 'AI Tutor', icon: <Bot className="w-4 h-4" /> },
    { id: 'solver', labelAr: 'حل المسائل', labelEn: 'Problem Solver', icon: <Calculator className="w-4 h-4" /> },
    { id: 'lab', labelAr: 'المعمل الافتراضي', labelEn: 'Virtual Lab', icon: <FlaskConical className="w-4 h-4" /> },
    { id: 'exams', labelAr: 'الامتحانات', labelEn: 'Exams', icon: <Target className="w-4 h-4" /> },
    { id: 'graphing', labelAr: 'الرسم البياني', labelEn: 'Graphing', icon: <LineChart className="w-4 h-4" /> },
    { id: 'challenges', labelAr: 'التحديات', labelEn: 'Challenges', icon: <Trophy className="w-4 h-4" /> },
    { id: 'planner', labelAr: 'خطة المذاكرة', labelEn: 'Planner', icon: <CalendarClock className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Banner + Resume Learning */}
      <section className="rounded-2xl glass-card p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-blue-600 dark:text-cyan-400">
              {trackLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span>{gradeLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num">
              {lang === 'ar' ? `المستوى ${profile.level}` : `Level ${profile.level}`} ({profile.points} pts)
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white text-balance">
            {lang === 'ar'
              ? `مرحبًا، ${profile.displayName}`
              : `Welcome back, ${profile.displayName}`}
          </h1>

          <p className="text-sm text-slate-600 dark:text-slate-300">
            {lastLesson
              ? lang === 'ar'
                ? `آخر درس تمت دراسته: ${pickStudyText(lastLesson.titleAr, lastLesson.titleEn, studyLang)}`
                : `Last studied lesson: ${pickStudyText(lastLesson.titleAr, lastLesson.titleEn, studyLang)}`
              : lang === 'ar'
              ? 'ابدأ بأول درس في منهجك الدراسي الآن.'
              : 'Start your first physics lesson in this curriculum track.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {lastLesson && (
            <button
              onClick={() => onOpenLesson(lastLesson.id)}
              className="px-5 py-3 rounded-xl glass-btn-primary text-sm font-semibold flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>{lang === 'ar' ? 'استكمال المذاكرة' : 'Continue Studying'}</span>
            </button>
          )}
          <button
            onClick={() => onNavigate('tutor')}
            className="px-4 py-3 rounded-xl glass-btn-secondary text-sm font-medium flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Bot className="w-4 h-4 text-blue-600 dark:text-cyan-400" />
            <span>{lang === 'ar' ? 'اسأل المدرس الذكي' : 'Ask AI Tutor'}</span>
          </button>
        </div>
      </section>

      {/* Study Language Setting Card */}
      <section className="rounded-2xl glass-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="glass-icon glass-icon-cyan w-9 h-9 shrink-0">
            <Languages className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {lang === 'ar' ? 'إعداد لغة الدراسة والمحتوى العلمي' : 'Study Content Language Preference'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {profile.track === 'american'
                ? lang === 'ar'
                  ? 'يمكنك التبديل في أي وقت بين العربية والإنجليزية أو اللغتين معًا لنظام American Diploma دون فقدان أي تقدم.'
                  : 'Switch anytime between Arabic, English, or Bilingual study across your American Diploma curriculum without losing progress.'
                : lang === 'ar'
                  ? 'اختر عرض الدروس والأسئلة والمدرس الذكي بالعربية أو الإنجليزية أو باللغتين معًا.'
                  : 'Choose whether lessons, questions, and AI explanations display in Arabic, English, or Bilingual mode.'}
            </p>
          </div>
        </div>
        <StudyLanguageSwitcher value={studyLang} onChange={onChangeStudyLang} uiLang={lang} />
      </section>

      {/* 7-Day Study Activity Chart */}
      <section className="rounded-2xl glass-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2.5">
              <span className="glass-icon glass-icon-blue w-8 h-8">
                <LineChart className="w-4 h-4" />
              </span>
              {lang === 'ar' ? 'نشاط المذاكرة خلال آخر 7 أيام' : '7-Day Study Activity & Consistency'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {lang === 'ar'
                ? 'تتبع دقائق المذاكرة وإنجاز الدروس يومياً لضمان الاستمرارية.'
                : 'Track daily study duration and lesson progress for consistent learning.'}
            </p>
          </div>
          <div className="text-xs font-mono-num font-semibold text-blue-600 dark:text-cyan-400 bg-blue-500/10 px-3 py-1.5 rounded-xl border border-blue-500/20">
            {chartData.reduce((acc, d) => acc + d.studyMinutes, 0)} {lang === 'ar' ? 'دقيقة إجمالية' : 'total mins'}
          </div>
        </div>

        <div className="h-48 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="studyMinsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
              <XAxis dataKey="label" stroke="currentColor" opacity={0.5} fontSize={11} />
              <YAxis stroke="currentColor" opacity={0.5} fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(8px)',
                  borderRadius: '0.75rem',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  fontSize: '12px',
                }}
                formatter={(val: any) => [`${val} ${lang === 'ar' ? 'دقيقة' : 'mins'}`, lang === 'ar' ? 'وقت المذاكرة' : 'Study Time']}
                labelStyle={{ fontWeight: 'bold', marginBottom: '2px' }}
              />
              <Area
                type="monotone"
                dataKey="studyMinutes"
                stroke="#06b6d4"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#studyMinsGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 4-column KPI strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl glass-card p-5">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {lang === 'ar' ? 'نسبة إنجاز المنهج' : 'Curriculum Completion'}
          </p>
          <p className="text-2xl font-bold font-mono-num mt-1">{completionPct}%</p>
          <div className="mt-3 h-2 w-full rounded-full bg-slate-200/70 dark:bg-white/10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all" style={{ width: `${completionPct}%` }} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono-num">
            {completedLessons.length} / {scopedLessons.length}{' '}
            {lang === 'ar' ? 'دروس مكتملة' : 'lessons completed'}
          </p>
        </div>

        <div className="rounded-2xl glass-card p-5">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {lang === 'ar' ? 'آخر نتيجة اختبار' : 'Latest Exam Score'}
          </p>
          <p className="text-2xl font-bold font-mono-num mt-1">
            {latestAttempt ? `${latestAttempt.score}/${latestAttempt.maxScore}` : '—'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 truncate">
            {latestAttempt
              ? latestAttempt.examTitle
              : lang === 'ar'
              ? 'لم تؤدِّ اختبارات بعد'
              : 'No exams submitted yet'}
          </p>
        </div>

        <div className="rounded-2xl glass-card p-5">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {lang === 'ar' ? 'المهام اليومية المتبقية' : 'Pending Daily Tasks'}
          </p>
          <p className="text-2xl font-bold font-mono-num mt-1">{todayTasks.length}</p>
          <button
            onClick={() => onNavigate('planner')}
            className="mt-2 text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
          >
            <span>{lang === 'ar' ? 'فتح خطة المذاكرة' : 'Open Study Planner'}</span>
            <DirArrow className="w-3 h-3" />
          </button>
        </div>

        <div className="rounded-2xl glass-card p-5">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {lang === 'ar' ? 'نقاط الإنجاز والترتيب' : 'Achievement Points'}
          </p>
          <p className="text-2xl font-bold font-mono-num mt-1">{profile.points}</p>
          <button
            onClick={() => onNavigate('challenges')}
            className="mt-2 text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
          >
            <span>{lang === 'ar' ? 'سؤال اليوم والتحديات' : 'Daily Challenge'}</span>
            <DirArrow className="w-3 h-3" />
          </button>
        </div>
      </section>

      {/* Quick Shortcuts Strip */}
      <section className="rounded-2xl glass-card p-5">
        <h2 className="text-sm font-semibold mb-4 text-slate-700 dark:text-slate-200">
          {lang === 'ar' ? 'اختصارات سريعة للأقسام' : 'Quick Module Shortcuts'}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {shortcuts.map((sc, idx) => {
            const iconVariants = [
              'glass-icon-blue',
              'glass-icon-cyan',
              'glass-icon-violet',
              'glass-icon-emerald',
              'glass-icon-amber',
              'glass-icon-cyan',
              'glass-icon-amber',
              'glass-icon-blue',
            ];
            return (
              <button
                key={sc.id}
                onClick={() => onNavigate(sc.id)}
                className="p-3.5 rounded-2xl glass-card-interactive flex flex-col items-center text-center gap-2.5"
              >
                <span className={`glass-icon ${iconVariants[idx % iconVariants.length]} w-9 h-9`}>
                  {sc.icon}
                </span>
                <span className="text-xs font-medium leading-tight">
                  {lang === 'ar' ? sc.labelAr : sc.labelEn}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main 2-Column Grid: Tasks & Suggested Lessons | Strengths/Weaknesses & Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Suggested Lessons & Study Schedule */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-2xl glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold flex items-center gap-2.5">
                <span className="glass-icon glass-icon-blue w-8 h-8">
                  <Sparkles className="w-4 h-4" />
                </span>
                {lang === 'ar' ? 'الدروس المقترحة لمسارك' : 'Recommended Lessons for Your Track'}
              </h2>
              <button
                onClick={() => onNavigate('curriculum')}
                className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline"
              >
                {lang === 'ar' ? 'عرض الكل' : 'View All'}
              </button>
            </div>
            {nextSuggested.length > 0 ? (
              <div className="divide-y divide-slate-200/70 dark:divide-white/10">
                {nextSuggested.map((lesson) => (
                  <div key={lesson.id} className="py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <BilingualTitle
                        ar={lesson.titleAr}
                        en={lesson.titleEn}
                        studyLang={studyLang}
                        as="p"
                        className="text-sm font-semibold truncate"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {pickStudyText(lesson.unitTitleAr, lesson.unitTitleEn, studyLang)} ·{' '}
                        <span className="font-mono-num">{lesson.estimatedMinutes}</span>{' '}
                        {lang === 'ar' ? 'دقيقة' : 'min'}
                      </p>
                    </div>
                    <button
                      onClick={() => onOpenLesson(lesson.id)}
                      className="px-3.5 py-1.5 rounded-xl glass-btn-secondary hover:!border-cyan-400/50 text-xs font-medium whitespace-nowrap shrink-0"
                    >
                      {lang === 'ar' ? 'ابدأ الدرس' : 'Open Lesson'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                {lang === 'ar'
                  ? 'أتممت جميع الدروس المتاحة حاليًا لهذا الصف! راجع بنك الأسئلة أو الامتحانات.'
                  : 'All current lessons for this grade are completed! Try the Question Bank or Exams.'}
              </p>
            )}
          </div>

          {/* Daily Tasks & Schedule */}
          <div className="rounded-2xl glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">
                {lang === 'ar' ? 'جدول المذاكرة والمهام اليومية' : 'Study Schedule & Daily Tasks'}
              </h2>
              <button
                onClick={() => onNavigate('planner')}
                className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline"
              >
                {lang === 'ar' ? 'إدارة الخطة' : 'Manage'}
              </button>
            </div>
            {todayTasks.length > 0 ? (
              <div className="space-y-2.5">
                {todayTasks.map((task) => (
                  <label
                    key={task.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl glass-subcard hover:border-cyan-400/40 cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => onToggleTask(task)}
                        className="w-4 h-4 rounded accent-blue-600"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                          {task.scheduledDate} · {task.durationMinutes} {lang === 'ar' ? 'د' : 'min'}
                        </p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500 flex items-center justify-between gap-3">
                <span>
                  {lang === 'ar' ? 'لا توجد مهام مجدولة لليوم.' : 'No tasks scheduled for today.'}
                </span>
                <button
                  onClick={() => onNavigate('planner')}
                  className="px-3.5 py-1.5 rounded-xl glass-btn-primary text-xs font-medium whitespace-nowrap"
                >
                  {lang === 'ar' ? 'أنشئ خطة ذكية' : 'Create Smart Plan'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Strengths/Weaknesses, Recent Activity, Notifications */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-2xl glass-card p-6 space-y-4">
            <h2 className="text-base font-bold">
              {lang === 'ar' ? 'نقاط القوة والضعف' : 'Strengths & Focus Areas'}
            </h2>
            <div>
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1.5">
                {lang === 'ar' ? 'نقاط القوة (إتقان ≥ 80%)' : 'Strengths (Mastery ≥ 80%)'}
              </p>
              {strongLessons.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {strongLessons.map((l) => (
                    <li key={l.id} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="truncate">{pickStudyText(l.titleAr, l.titleEn, studyLang)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'ar' ? 'ستظهر هنا الدروس التي تحرز فيها ≥ 80%.' : 'Lessons where you score ≥ 80% appear here.'}
                </p>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1.5">
                {lang === 'ar' ? 'موضوعات تحتاج مراجعة (< 70%)' : 'Needs Review (< 70%)'}
              </p>
              {weakLessons.length > 0 ? (
                <ul className="space-y-1.5 text-sm">
                  {weakLessons.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{pickStudyText(l.titleAr, l.titleEn, studyLang)}</span>
                      <button
                        onClick={() => onOpenLesson(l.id)}
                        className="text-xs text-blue-600 dark:text-cyan-400 hover:underline shrink-0"
                      >
                        {lang === 'ar' ? 'مراجعة' : 'Review'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'ar' ? 'لا توجد نقاط ضعف مسجلة حاليًا.' : 'No weak areas flagged yet.'}
                </p>
              )}
            </div>
          </div>

          {/* Notifications & Recent Activity */}
          <div className="rounded-2xl glass-card p-6 space-y-4">
            <h2 className="text-base font-bold flex items-center gap-2.5">
              <span className="glass-icon glass-icon-violet w-8 h-8">
                <Bell className="w-4 h-4" />
              </span>
              {lang === 'ar' ? 'الإشعارات وآخر النشاطات' : 'Notifications & Recent Activity'}
            </h2>
            <div className="space-y-3 text-xs">
              {announcements.map((ann) => (
                <div key={ann.id} className="p-3.5 rounded-xl glass-subcard space-y-1.5">
                  <BilingualTitle
                    ar={ann.titleAr}
                    en={ann.titleEn}
                    studyLang={studyLang}
                    as="p"
                    className="font-semibold text-slate-900 dark:text-white"
                  />
                  <BilingualTextBlock
                    ar={ann.bodyAr}
                    en={ann.bodyEn}
                    studyLang={studyLang}
                    className="text-slate-600 dark:text-slate-300"
                  />
                </div>
              ))}

              {submittedAttempts.slice(0, 3).map((att) => (
                <div key={att.id} className="flex items-center justify-between text-slate-600 dark:text-slate-300 py-1">
                  <span className="truncate">
                    {lang === 'ar' ? `أنهيت امتحان: ${att.examTitle}` : `Completed exam: ${att.examTitle}`}
                  </span>
                  <span className="font-mono-num font-semibold text-blue-600 dark:text-cyan-400 shrink-0">
                    {att.score}/{att.maxScore}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
