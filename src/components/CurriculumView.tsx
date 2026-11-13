import React, { useEffect, useState } from 'react';
import {
  Language,
  Lesson,
  LessonProgress,
  QuestionItem,
  UserProfile,
} from '../types/physics';
import { getGradeLabel, getTrackById } from '../data/tracks';
import { LatexBlock, LatexInline, RichPhysicsText } from './MathRenderer';
import { PhysicsDiagramSVG } from './PhysicsDiagramSVG';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  HelpCircle,
  Lightbulb,
  Wrench,
} from 'lucide-react';

interface CurriculumViewProps {
  lang: Language;
  profile: UserProfile;
  lessons: Lesson[];
  questions: QuestionItem[];
  progressMap: Record<string, LessonProgress>;
  selectedLessonId: string | null;
  onSelectLesson: (id: string | null) => void;
  onSaveProgress: (lessonId: string, completedParts: string[], isCompleted: boolean, quizScore: number) => Promise<void>;
  onAskTutorWithLesson: (lesson: Lesson) => void;
}

export function CurriculumView({
  lang,
  profile,
  lessons,
  questions,
  progressMap,
  selectedLessonId,
  onSelectLesson,
  onSaveProgress,
  onAskTutorWithLesson,
}: CurriculumViewProps) {
  const trackInfo = getTrackById(profile.track);
  const gradeLabel = getGradeLabel(profile.track, profile.grade, lang);
  // Strict Track + Grade Isolation
  const scopedLessons = lessons
    .filter((l) => l.track === profile.track && l.grade === profile.grade)
    .sort((a, b) => a.order - b.order);

  const activeLesson = scopedLessons.find((l) => l.id === selectedLessonId) || null;
  const [checkAnswers, setCheckAnswers] = useState<Record<string, number>>({});
  const [revealedHints, setRevealedHints] = useState<Record<number, boolean>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  useEffect(() => {
    setCheckAnswers({});
    setRevealedHints({});
    setRevealedAnswers({});
    setQuizAnswers({});
    setQuizSubmitted(false);
  }, [selectedLessonId]);

  const BackArrow = lang === 'ar' ? ChevronRight : ChevronLeft;

  if (!activeLesson) {
    // Group by Term -> Unit
    const unitsMap = new Map<string, { term: string; unitTitle: string; items: Lesson[] }>();
    for (const l of scopedLessons) {
      const key = `${l.termEn}::${l.unitId}`;
      if (!unitsMap.has(key)) {
        unitsMap.set(key, {
          term: lang === 'ar' ? l.termAr : l.termEn,
          unitTitle: lang === 'ar' ? l.unitTitleAr : l.unitTitleEn,
          items: [],
        });
      }
      unitsMap.get(key)!.items.push(l);
    }

    return (
      <div className="space-y-6">
        <div className="rounded-2xl glass-card p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-blue-600 dark:text-cyan-400 mb-1">
            <span>{lang === 'ar' ? trackInfo?.nameAr : trackInfo?.nameEn}</span>
            <span aria-hidden="true">·</span>
            <span>{gradeLabel}</span>
          </div>
          <h1 className="text-2xl font-bold">
            {lang === 'ar' ? 'مكتبة المناهج والدروس التفصيلية' : 'Structured Curriculum & Lessons Library'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {lang === 'ar'
              ? 'محتوى مخصص بالكامل لنظامك وصفك الدراسي. كل درس مقسم إلى 15 قسمًا علميًا متكاملًا.'
              : 'Strictly scoped to your educational track and grade. Each lesson contains 15 comprehensive pedagogical sections.'}
          </p>
        </div>

        {Array.from(unitsMap.entries()).map(([key, group]) => (
          <div
            key={key}
            className="rounded-2xl glass-card p-6 space-y-4"
          >
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{group.term}</p>
              <h2 className="text-lg font-bold mt-0.5">{group.unitTitle}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {group.items.map((lesson) => {
                const prog = progressMap[lesson.id];
                return (
                  <div
                    key={lesson.id}
                    className="rounded-2xl glass-card-interactive p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono-num">
                          {lang === 'ar' ? `الدرس ${lesson.order}` : `Lesson ${lesson.order}`} · {lesson.estimatedMinutes}{' '}
                          {lang === 'ar' ? 'د' : 'min'}
                        </span>
                        {prog?.isCompleted && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {lang === 'ar' ? 'مكتمل' : 'Completed'}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-bold">
                        {lang === 'ar' ? lesson.titleAr : lesson.titleEn}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                        {lang === 'ar' ? lesson.introAr : lesson.introEn}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400/80">
                        {lang === 'ar' ? lesson.sourceLabelAr : lesson.sourceLabelEn}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setQuizAnswers({});
                        setQuizSubmitted(false);
                        onSelectLesson(lesson.id);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl glass-btn-primary text-xs font-semibold"
                    >
                      {prog?.isCompleted
                        ? lang === 'ar'
                          ? 'مراجعة الدرس'
                          : 'Review Lesson'
                        : lang === 'ar'
                        ? 'بدء دراسة الدرس'
                        : 'Study Full Lesson'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Active Lesson View with ALL 15 Mandatory Sections
  const prog = progressMap[activeLesson.id];
  const completedParts = prog?.completedParts || [];
  const lessonQuizQuestions = questions.filter((q) => activeLesson.finalQuizQuestionIds.includes(q.id));

  const togglePartComplete = async (partId: string) => {
    const nextParts = completedParts.includes(partId)
      ? completedParts.filter((p) => p !== partId)
      : [...completedParts, partId];
    const allPartsDone = nextParts.length >= activeLesson.parts.length;
    await onSaveProgress(activeLesson.id, nextParts, allPartsDone || !!prog?.isCompleted, prog?.quizScore || 0);
  };

  const handleQuizSubmit = async () => {
    if (lessonQuizQuestions.length === 0) return;
    let correct = 0;
    for (const q of lessonQuizQuestions) {
      const userAns = (quizAnswers[q.id] || '').trim();
      if (q.type === 'numerical' && typeof q.numericValue === 'number') {
        const num = parseFloat(userAns);
        if (!Number.isNaN(num) && Math.abs(num - q.numericValue) <= Math.max(Math.abs(q.numericValue) * (q.tolerance || 0.02), 0.01)) {
          correct++;
        }
      } else if (userAns === q.correctAnswer) {
        correct++;
      }
    }
    const scorePct = Math.round((correct / lessonQuizQuestions.length) * 100);
    setQuizSubmitted(true);
    await onSaveProgress(
      activeLesson.id,
      activeLesson.parts.map((p) => p.id),
      true,
      scorePct
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Lesson Header */}
      <div className="rounded-2xl glass-card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => onSelectLesson(null)}
            className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
          >
            <BackArrow className="w-4 h-4" />
            {lang === 'ar' ? 'العودة إلى قائمة الدروس' : 'Back to Curriculum'}
          </button>

          <button
            onClick={() => onAskTutorWithLesson(activeLesson)}
            className="px-3.5 py-2 rounded-xl glass-btn-secondary text-blue-600 dark:text-cyan-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <Bot className="w-4 h-4" />
            {lang === 'ar' ? 'اشرح لي هذا الدرس بالذكاء الاصطناعي' : 'Discuss Lesson with AI Tutor'}
          </button>
        </div>

        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {lang === 'ar' ? activeLesson.unitTitleAr : activeLesson.unitTitleEn} ·{' '}
            {lang === 'ar' ? activeLesson.sourceLabelAr : activeLesson.sourceLabelEn}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold mt-1">
            {lang === 'ar' ? activeLesson.titleAr : activeLesson.titleEn}
          </h1>
        </div>

        {activeLesson.resourceUrls && (activeLesson.resourceUrls.pdf || activeLesson.resourceUrls.video) && (
          <div className="flex flex-wrap gap-3 pt-2">
            {activeLesson.resourceUrls.pdf && (
              <a
                href={activeLesson.resourceUrls.pdf}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'مرجع PDF المرفق' : 'Attached PDF Reference'}
              </a>
            )}
            {activeLesson.resourceUrls.video && (
              <a
                href={activeLesson.resourceUrls.video}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'فيديو الشرح المرفق' : 'Attached Lesson Video'}
              </a>
            )}
          </div>
        )}
      </div>

      {/* Section 1: Introduction & Objectives */}
      <section className="rounded-2xl glass-card p-6 space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2.5">
          <span className="glass-icon glass-icon-blue w-8 h-8">
            <BookOpen className="w-4 h-4" />
          </span>
          {lang === 'ar' ? '1. مقدمة وأهداف الدرس' : '1. Introduction & Learning Objectives'}
        </h2>
        <p className="text-sm sm:text-[15px] leading-7 text-slate-700 dark:text-slate-300">
          {lang === 'ar' ? activeLesson.introAr : activeLesson.introEn}
        </p>
        <div className="pt-2">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
            {lang === 'ar' ? 'بنهاية هذا الدرس ستكون قادرًا على:' : 'By the end of this lesson you will be able to:'}
          </p>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 list-disc list-inside">
            {(lang === 'ar' ? activeLesson.objectivesAr : activeLesson.objectivesEn).map((obj, idx) => (
              <li key={idx}>{obj}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Section 2, 7, 13: Detailed Parts + Diagrams + Interactive Check Questions */}
      {activeLesson.parts.map((part, idx) => {
        const isPartDone = completedParts.includes(part.id);
        const chosenCheck = checkAnswers[part.id];
        return (
          <section
            key={part.id}
            className="rounded-2xl glass-card p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-bold">
                {lang === 'ar' ? part.titleAr : part.titleEn}
              </h2>
              <button
                onClick={() => togglePartComplete(part.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                  isPartDone
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
                    : 'glass-btn-secondary'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isPartDone
                  ? lang === 'ar'
                    ? 'تم الفهم'
                    : 'Understood'
                  : lang === 'ar'
                  ? 'تحديد كمكتمل'
                  : 'Mark Complete'}
              </button>
            </div>

            <RichPhysicsText
              text={lang === 'ar' ? part.explanationAr : part.explanationEn}
              className="text-slate-700 dark:text-slate-300"
            />

            {part.equationsLatex && part.equationsLatex.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {part.equationsLatex.map((eq, eIdx) => (
                  <LatexBlock key={eIdx} latex={eq} />
                ))}
              </div>
            )}

            {part.diagramType && <PhysicsDiagramSVG type={part.diagramType} lang={lang} />}

            {/* Interactive check question after part */}
            {part.checkQuestion && (
              <div className="mt-4 rounded-xl glass-subcard !border-cyan-500/25 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-600 dark:text-cyan-400 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4" />
                  {lang === 'ar' ? `تحقق من فهمك (الجزء ${idx + 1})` : `Quick Check (Part ${idx + 1})`}
                </p>
                <p className="text-sm font-medium">
                  {lang === 'ar' ? part.checkQuestion.questionAr : part.checkQuestion.questionEn}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(lang === 'ar' ? part.checkQuestion.optionsAr : part.checkQuestion.optionsEn).map((opt, oIdx) => {
                    const isPicked = chosenCheck === oIdx;
                    const isRight = part.checkQuestion!.correctIndex === oIdx;
                    return (
                      <button
                        key={oIdx}
                        onClick={() => setCheckAnswers((prev) => ({ ...prev, [part.id]: oIdx }))}
                        className={`p-2.5 rounded-xl border text-start text-xs font-medium transition-all ${
                          chosenCheck === undefined
                            ? 'glass-btn-secondary'
                            : isRight
                            ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : isPicked
                            ? 'border-rose-500/70 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                            : 'border-slate-200/40 dark:border-white/10 opacity-60'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {chosenCheck !== undefined && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 pt-1">
                    {lang === 'ar' ? part.checkQuestion.explanationAr : part.checkQuestion.explanationEn}
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* Sections 3 & 4: Concepts & Bilingual Scientific Terms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-2xl glass-card p-6 space-y-3">
          <h2 className="text-base font-bold">
            {lang === 'ar' ? 'المفاهيم والتعريفات الأساسية' : 'Key Concepts & Definitions'}
          </h2>
          {(lang === 'ar' ? activeLesson.conceptsAr : activeLesson.conceptsEn).map((c, i) => (
            <div key={i} className="pt-2.5 border-t border-slate-200/70 dark:border-white/10 first:border-0 first:pt-0">
              <p className="text-sm font-semibold text-blue-600 dark:text-cyan-400">{c.title}</p>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">{c.body}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl glass-card p-6 space-y-3">
          <h2 className="text-base font-bold">
            {lang === 'ar' ? 'المصطلحات العلمية (عربي / English)' : 'Bilingual Scientific Terminology'}
          </h2>
          {activeLesson.terms.map((term, i) => (
            <div key={i} className="pt-2.5 border-t border-slate-200/70 dark:border-white/10 first:border-0 first:pt-0">
              <p className="text-sm font-semibold">
                {term.termAr} · <span dir="ltr" className="text-blue-600 dark:text-cyan-400">{term.termEn}</span>
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                {lang === 'ar' ? term.definitionAr : term.definitionEn}
              </p>
            </div>
          ))}
        </section>
      </div>

      {/* Sections 5 & 6: Laws, Equations, Symbols & Units */}
      <section className="rounded-2xl glass-card p-6 space-y-5">
        <h2 className="text-lg font-bold">
          {lang === 'ar' ? 'القوانين والمعادلات وشرح الرموز والوحدات' : 'Laws, Equations, Symbols & SI Units'}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeLesson.lawsLatex.map((law, idx) => (
            <div key={idx} className="rounded-xl glass-subcard p-4">
              <p className="text-sm font-semibold">{lang === 'ar' ? law.nameAr : law.nameEn}</p>
              <LatexBlock latex={law.latex} />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'ar' ? law.noteAr : law.noteEn}
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start border-collapse">
            <thead>
              <tr className="border-b border-slate-200/70 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400">
                <th className="py-2 px-3 text-start">{lang === 'ar' ? 'الرمز' : 'Symbol'}</th>
                <th className="py-2 px-3 text-start">{lang === 'ar' ? 'الكمية الفيزيائية' : 'Physical Quantity'}</th>
                <th className="py-2 px-3 text-start">{lang === 'ar' ? 'وحدة القياس' : 'SI Unit'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-white/10">
              {activeLesson.symbolsTable.map((row, idx) => (
                <tr key={idx}>
                  <td className="py-2 px-3 font-mono-num">
                    <LatexInline latex={row.symbol} />
                  </td>
                  <td className="py-2 px-3">{lang === 'ar' ? row.nameAr : row.nameEn}</td>
                  <td className="py-2 px-3 font-mono-num text-blue-600 dark:text-cyan-400">
                    {lang === 'ar' ? row.unitAr : row.unitEn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sections 8 & 9: Everyday Examples & Worked Solved Examples */}
      <section className="rounded-2xl glass-card p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2.5">
          <span className="glass-icon glass-icon-amber w-8 h-8">
            <Lightbulb className="w-4 h-4" />
          </span>
          {lang === 'ar' ? 'أمثلة من الحياة اليومية وأمثلة محلولة بالتفصيل' : 'Everyday Examples & Worked Solutions'}
        </h2>

        <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 list-disc list-inside">
          {(lang === 'ar' ? activeLesson.everydayExamplesAr : activeLesson.everydayExamplesEn).map((ex, i) => (
            <li key={i}>{ex}</li>
          ))}
        </ul>

        {activeLesson.solvedExamples.map((ex) => (
          <div key={ex.id} className="rounded-xl glass-subcard p-5 space-y-3">
            <h3 className="text-base font-bold text-blue-600 dark:text-cyan-400">
              {lang === 'ar' ? ex.titleAr : ex.titleEn}
            </h3>
            <p className="text-sm leading-relaxed">{lang === 'ar' ? ex.problemAr : ex.problemEn}</p>
            <div className="text-xs space-y-1">
              <p className="font-semibold text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'المعطيات:' : 'Givens:'}</p>
              <div className="flex flex-wrap gap-3 font-mono-num">
                {(lang === 'ar' ? ex.givensAr : ex.givensEn).map((g, i) => (
                  <span key={i}>{g}</span>
                ))}
              </div>
            </div>
            <LatexBlock latex={ex.formulaLatex} />
            <ol className="space-y-1.5 text-sm list-decimal list-inside">
              {(lang === 'ar' ? ex.stepsAr : ex.stepsEn).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p className="text-sm font-bold font-mono-num text-emerald-600 dark:text-emerald-400">
              {lang === 'ar' ? 'الناتج النهائي:' : 'Final Answer:'} <span dir="ltr">{ex.finalAnswer}</span>
            </p>
          </div>
        ))}
      </section>

      {/* Section 10: Graded Problems */}
      <section className="rounded-2xl glass-card p-6 space-y-4">
        <h2 className="text-lg font-bold">
          {lang === 'ar' ? 'مسائل حسابية متدرجة للتدريب' : 'Graded Numerical Practice Problems'}
        </h2>
        <div className="space-y-3">
          {activeLesson.gradedProblems.map((prob, idx) => (
            <div key={idx} className="rounded-xl glass-subcard p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold uppercase">{prob.level}</span>
              </div>
              <p className="text-sm">{lang === 'ar' ? prob.problemAr : prob.problemEn}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => setRevealedHints((p) => ({ ...p, [idx]: !p[idx] }))}
                  className="px-3 py-1 rounded-lg glass-btn-secondary text-xs font-medium"
                >
                  {lang === 'ar' ? 'إظهار تلميح' : 'Show Hint'}
                </button>
                <button
                  onClick={() => setRevealedAnswers((p) => ({ ...p, [idx]: !p[idx] }))}
                  className="px-3 py-1 rounded-lg glass-btn-primary text-xs font-medium"
                >
                  {lang === 'ar' ? 'إظهار الإجابة' : 'Reveal Answer'}
                </button>
              </div>
              {revealedHints[idx] && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {lang === 'ar' ? prob.hintAr : prob.hintEn}
                </p>
              )}
              {revealedAnswers[idx] && (
                <p className="text-xs font-mono-num font-bold text-emerald-600 dark:text-emerald-400" dir="ltr">
                  Answer: {prob.answer}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Sections 11, 12, 14: Common Mistakes, Practical Apps, Comprehensive Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-2xl glass-card p-6 space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2.5">
            <span className="glass-icon glass-icon-amber w-8 h-8">
              <AlertTriangle className="w-4 h-4" />
            </span>
            {lang === 'ar' ? 'الأخطاء الشائعة وكيفية تجنبها' : 'Common Mistakes & Corrections'}
          </h2>
          {(lang === 'ar' ? activeLesson.commonMistakesAr : activeLesson.commonMistakesEn).map((m, i) => (
            <div key={i} className="text-sm space-y-1 pt-2.5 border-t border-slate-200/70 dark:border-white/10 first:border-0 first:pt-0">
              <p className="text-rose-600 dark:text-rose-400 font-medium">{m.mistake}</p>
              <p className="text-emerald-600 dark:text-emerald-400 text-xs">{m.correction}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl glass-card p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2.5 mb-2">
              <span className="glass-icon glass-icon-cyan w-8 h-8">
                <Wrench className="w-4 h-4" />
              </span>
              {lang === 'ar' ? 'تطبيقات عملية وتكنولوجية' : 'Practical Applications'}
            </h2>
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300 list-disc list-inside">
              {(lang === 'ar' ? activeLesson.practicalAppsAr : activeLesson.practicalAppsEn).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>

          <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
            <h3 className="text-base font-bold mb-2">
              {lang === 'ar' ? 'الملخص الشامل للدرس' : 'Comprehensive Summary'}
            </h3>
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300 list-disc list-inside">
              {(lang === 'ar' ? activeLesson.summaryAr : activeLesson.summaryEn).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* Section 15: End of Lesson Quiz */}
      <section className="rounded-2xl glass-card p-6 space-y-4">
        <h2 className="text-lg font-bold">
          {lang === 'ar' ? '15. الاختبار النهائي للدرس' : '15. Final Lesson Assessment'}
        </h2>

        {lessonQuizQuestions.length === 0 ? (
          <p className="text-sm text-slate-500">
            {lang === 'ar' ? 'لا توجد أسئلة مربوطة بهذا الدرس حاليًا.' : 'No quiz questions linked yet.'}
          </p>
        ) : (
          <div className="space-y-4">
            {lessonQuizQuestions.map((q, qIdx) => (
              <div key={q.id} className="p-4 rounded-xl glass-subcard space-y-3">
                <p className="text-sm font-semibold">
                  {qIdx + 1}. {lang === 'ar' ? q.textAr : q.textEn}
                </p>
                {q.type === 'numerical' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      disabled={quizSubmitted}
                      placeholder={lang === 'ar' ? 'أدخل القيمة العددية...' : 'Enter numeric value...'}
                      value={quizAnswers[q.id] || ''}
                      onChange={(e) => setQuizAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                      className="px-3 py-2 rounded-xl glass-input text-sm font-mono-num"
                    />
                    {q.numericUnit && <span className="text-xs font-mono-num text-slate-500">{q.numericUnit}</span>}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(lang === 'ar' ? q.optionsAr || [] : q.optionsEn || []).map((opt, oIdx) => (
                      <button
                        key={oIdx}
                        disabled={quizSubmitted}
                        onClick={() => setQuizAnswers((p) => ({ ...p, [q.id]: String(oIdx) }))}
                        className={`p-2.5 rounded-xl border text-start text-xs font-medium transition-all ${
                          quizAnswers[q.id] === String(oIdx)
                            ? 'glass-btn-primary text-white'
                            : 'glass-btn-secondary'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {quizSubmitted && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 pt-1">
                    {lang === 'ar' ? q.explanationAr : q.explanationEn}
                  </p>
                )}
              </div>
            ))}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleQuizSubmit}
                disabled={quizSubmitted}
                className="px-5 py-2.5 rounded-xl glass-btn-primary text-sm font-semibold disabled:opacity-60"
              >
                {quizSubmitted
                  ? lang === 'ar'
                    ? `تم التصحيح (${prog?.quizScore ?? 0}%)`
                    : `Graded (${prog?.quizScore ?? 0}%)`
                  : lang === 'ar'
                  ? 'تصحيح الاختبار وحفظ التقدم'
                  : 'Submit & Save Progress'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
