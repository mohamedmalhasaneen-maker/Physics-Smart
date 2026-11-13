import React from 'react';
import {
  ExamAttempt,
  Language,
  Lesson,
  LessonProgress,
  StudyLanguage,
  UserProfile,
} from '../types/physics';
import { pickStudyText } from '../lib/bilingual';
import { Award, BarChart3, BookOpen, CheckCircle2, Clock, TrendingUp } from 'lucide-react';

interface AnalyticsViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  profile: UserProfile;
  lessons: Lesson[];
  progressMap: Record<string, LessonProgress>;
  attempts: ExamAttempt[];
  onOpenLesson: (lessonId: string) => void;
}

export function AnalyticsView({
  lang,
  studyLang,
  profile,
  lessons,
  progressMap,
  attempts,
  onOpenLesson,
}: AnalyticsViewProps) {
  const scopedLessons = lessons.filter((l) => l.track === profile.track && l.grade === profile.grade);
  const completedLessons = scopedLessons.filter((l) => progressMap[l.id]?.isCompleted);
  const remainingLessons = scopedLessons.filter((l) => !progressMap[l.id]?.isCompleted);

  const completionPct =
    scopedLessons.length > 0 ? Math.round((completedLessons.length / scopedLessons.length) * 100) : 0;

  const totalStudyMinutes = Object.values(progressMap).reduce((acc, p) => acc + (p.studyMinutes || 0), 0);
  const submitted = attempts.filter((a) => a.status === 'submitted');
  const avgScore =
    submitted.length > 0
      ? Math.round(submitted.reduce((acc, a) => acc + (a.score / (a.maxScore || 1)) * 100, 0) / submitted.length)
      : 0;

  const improvementRate =
    submitted.length >= 2
      ? Math.round(
          (submitted[0].score / (submitted[0].maxScore || 1)) * 100 -
            (submitted[submitted.length - 1].score / (submitted[submitted.length - 1].maxScore || 1)) * 100
        )
      : 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="glass-card rounded-2xl p-6 flex items-start gap-3.5">
        <span className="glass-icon glass-icon-blue w-10 h-10 shrink-0">
          <BarChart3 className="w-5 h-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">
            {lang === 'ar' ? 'لوحة متابعة مستوى الطالب والتقارير' : 'Student Performance & Mastery Analytics'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {lang === 'ar'
              ? 'تحليل متزامن لنسبة إتمام المنهج، درجات الاختبارات، معدل التحسن، وتوصيات المراجعة الذكية.'
              : 'Real-time synced progress across curriculum completion, exam accuracy, improvement trends, and study time.'}
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'ar' ? 'نسبة إتمام المنهج' : 'Curriculum Progress'}
            </p>
            <p className="text-2xl font-bold font-mono-num mt-1.5">{completionPct}%</p>
          </div>
          <span className="glass-icon glass-icon-blue w-9 h-9 shrink-0">
            <BookOpen className="w-4 h-4" />
          </span>
        </div>

        <div className="glass-card rounded-2xl p-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'ar' ? 'متوسط درجات الامتحانات' : 'Average Exam Score'}
            </p>
            <p className="text-2xl font-bold font-mono-num mt-1.5">{avgScore}%</p>
          </div>
          <span className="glass-icon glass-icon-cyan w-9 h-9 shrink-0">
            <Award className="w-4 h-4" />
          </span>
        </div>

        <div className="glass-card rounded-2xl p-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'ar' ? 'الوقت المستغرق في الدراسة' : 'Study Time Logged'}
            </p>
            <p className="text-2xl font-bold font-mono-num mt-1.5">
              {totalStudyMinutes} {lang === 'ar' ? 'د' : 'min'}
            </p>
          </div>
          <span className="glass-icon glass-icon-violet w-9 h-9 shrink-0">
            <Clock className="w-4 h-4" />
          </span>
        </div>

        <div className="glass-card rounded-2xl p-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'ar' ? 'معدل التحسن' : 'Improvement Delta'}
            </p>
            <p className="text-2xl font-bold font-mono-num mt-1.5">
              {improvementRate >= 0 ? `+${improvementRate}%` : `${improvementRate}%`}
            </p>
          </div>
          <span className="glass-icon glass-icon-emerald w-9 h-9 shrink-0">
            <TrendingUp className="w-4 h-4" />
          </span>
        </div>
      </div>

      {/* Mastery per Lesson */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h2 className="text-base font-bold">
          {lang === 'ar' ? 'مستوى إتقان الدروس والوحدات' : 'Lesson & Unit Mastery Breakdown'}
        </h2>
        <div className="space-y-3">
          {scopedLessons.map((lesson) => {
            const p = progressMap[lesson.id];
            const score = p?.quizScore ?? 0;
            const done = !!p?.isCompleted;
            return (
              <div key={lesson.id} className="glass-subcard rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                  <span className="font-medium flex items-center gap-2 min-w-0">
                    {done && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                    <span dir="auto" className="truncate">
                      {pickStudyText(lesson.titleAr, lesson.titleEn, studyLang)}
                    </span>
                  </span>
                  <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    {done ? `${score}%` : lang === 'ar' ? 'متبقي' : 'Remaining'}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-800/80 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      score >= 80
                        ? 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                        : score >= 50
                          ? 'bg-gradient-to-r from-blue-600 to-cyan-500'
                          : 'bg-gradient-to-r from-amber-500 to-orange-400'
                    }`}
                    style={{ width: `${done ? Math.max(score, 15) : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Smart Revision Recommendations */}
      <div className="glass-card rounded-2xl p-6 space-y-3">
        <h2 className="text-base font-bold">
          {lang === 'ar' ? 'توصيات ذكية للمراجعة واستكمال المنهج' : 'Smart Revision Recommendations'}
        </h2>
        {remainingLessons.length > 0 ? (
          <div className="space-y-2">
            {remainingLessons.map((l) => (
              <div
                key={l.id}
                className="glass-subcard rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-sm"
              >
                <span dir="auto">{pickStudyText(l.titleAr, l.titleEn, studyLang)}</span>
                <button
                  onClick={() => onOpenLesson(l.id)}
                  className="glass-btn-secondary px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-cyan-400 cursor-pointer shrink-0"
                >
                  {lang === 'ar' ? 'دراسة الآن' : 'Study Now'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-subcard rounded-xl p-4 text-sm text-emerald-600 dark:text-emerald-400">
            {lang === 'ar'
              ? 'أتممت جميع دروس هذا الصف! نوصي بحل الامتحانات الشاملة وتحديات الدقة.'
              : 'All lessons in this grade are complete! Try Comprehensive Exams and Calculation Challenges.'}
          </div>
        )}
      </div>
    </div>
  );
}
