import React, { useEffect, useState } from 'react';
import {
  Language,
  Lesson,
  LessonProgress,
  QuestionItem,
  StudyLanguage,
  UserProfile,
} from '../types/physics';
import { getGradeLabel, getTrackLabel } from '../data/tracks';
import { mergeBilingualOptions, pickStudyText } from '../lib/bilingual';
import { BilingualTextBlock, BilingualTitle, StudyLanguageSwitcher } from './BilingualBlock';
import { LatexBlock, LatexInline } from './MathRenderer';
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
  studyLang: StudyLanguage;
  onChangeStudyLang: (next: StudyLanguage) => void;
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
  studyLang,
  onChangeStudyLang,
  profile,
  lessons,
  questions,
  progressMap,
  selectedLessonId,
  onSelectLesson,
  onSaveProgress,
  onAskTutorWithLesson,
}: CurriculumViewProps) {
  const trackLabel = getTrackLabel(profile.track, studyLang);
  const gradeLabel = getGradeLabel(profile.track, profile.grade, studyLang);
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
    const unitsMap = new Map<
      string,
      { termAr: string; termEn: string; unitTitleAr: string; unitTitleEn: string; items: Lesson[] }
    >();
    for (const l of scopedLessons) {
      const key = `${l.termEn}::${l.unitId}`;
      if (!unitsMap.has(key)) {
        unitsMap.set(key, {
          termAr: l.termAr,
          termEn: l.termEn,
          unitTitleAr: l.unitTitleAr,
          unitTitleEn: l.unitTitleEn,
          items: [],
        });
      }
      unitsMap.get(key)!.items.push(l);
    }

    return (
      <div className="space-y-6">
        <div className="rounded-2xl glass-card p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-blue-600 dark:text-cyan-400 mb-1">
              <span>{trackLabel}</span>
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
          <StudyLanguageSwitcher
            value={studyLang}
            onChange={onChangeStudyLang}
            uiLang={lang}
            label={lang === 'ar' ? 'لغة الدرس:' : 'Study Language:'}
          />
        </div>

        {Array.from(unitsMap.entries()).map(([key, group]) => (
          <div key={key} className="rounded-2xl glass-card p-6 space-y-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {pickStudyText(group.termAr, group.termEn, studyLang)}
              </p>
              <BilingualTitle
                ar={group.unitTitleAr}
                en={group.unitTitleEn}
                studyLang={studyLang}
                as="h2"
                className="text-lg font-bold mt-0.5"
              />
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
                      <BilingualTitle
                        ar={lesson.titleAr}
                        en={lesson.titleEn}
                        studyLang={studyLang}
                        as="h3"
                        className="text-base font-bold"
                      />
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                        {pickStudyText(lesson.introAr, lesson.introEn, studyLang)}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400/80">
                        {pickStudyText(lesson.sourceLabelAr, lesson.sourceLabelEn, studyLang)}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setQuizAnswers({});
                        setQuizSubmitted(false);
                        onSelectLesson(lesson.id);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl glass-btn-primary text-xs font-semibold cursor-pointer"
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

  const objectiveLen = Math.max(activeLesson.objectivesAr.length, activeLesson.objectivesEn.length);
  const conceptLen = Math.max(activeLesson.conceptsAr.length, activeLesson.conceptsEn.length);
  const everydayLen = Math.max(activeLesson.everydayExamplesAr.length, activeLesson.everydayExamplesEn.length);
  const mistakesLen = Math.max(activeLesson.commonMistakesAr.length, activeLesson.commonMistakesEn.length);
  const practicalLen = Math.max(activeLesson.practicalAppsAr.length, activeLesson.practicalAppsEn.length);
  const summaryLen = Math.max(activeLesson.summaryAr.length, activeLesson.summaryEn.length);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Lesson Header */}
      <div className="rounded-2xl glass-card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => onSelectLesson(null)}
            className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <BackArrow className="w-4 h-4" />
            {lang === 'ar' ? 'العودة إلى قائمة الدروس' : 'Back to Curriculum'}
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            <StudyLanguageSwitcher
              value={studyLang}
              onChange={onChangeStudyLang}
              uiLang={lang}
              compact
            />
            <button
              onClick={() => onAskTutorWithLesson(activeLesson)}
              className="px-3.5 py-2 rounded-xl glass-btn-secondary text-blue-600 dark:text-cyan-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Bot className="w-4 h-4" />
              {lang === 'ar' ? 'اشرح لي هذا الدرس بالذكاء الاصطناعي' : 'Discuss Lesson with AI Tutor'}
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {pickStudyText(activeLesson.unitTitleAr, activeLesson.unitTitleEn, studyLang)} ·{' '}
            {pickStudyText(activeLesson.sourceLabelAr, activeLesson.sourceLabelEn, studyLang)}
          </p>
          <BilingualTitle
            ar={activeLesson.titleAr}
            en={activeLesson.titleEn}
            studyLang={studyLang}
            as="h1"
            className="text-2xl sm:text-3xl font-bold mt-1"
            subClassName="text-sm font-medium text-cyan-600 dark:text-cyan-300 mt-1"
          />
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
        <BilingualTextBlock
          ar={activeLesson.introAr}
          en={activeLesson.introEn}
          studyLang={studyLang}
          className="text-sm sm:text-[15px] leading-7 text-slate-700 dark:text-slate-300"
        />
        <div className="pt-2">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
            {lang === 'ar' ? 'بنهاية هذا الدرس ستكون قادرًا على:' : 'By the end of this lesson you will be able to:'}
          </p>
          <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
            {Array.from({ length: objectiveLen }).map((_, idx) => (
              <li key={idx} className="rounded-xl glass-subcard px-3.5 py-2">
                <BilingualTextBlock
                  ar={activeLesson.objectivesAr[idx] || activeLesson.objectivesEn[idx] || ''}
                  en={activeLesson.objectivesEn[idx] || activeLesson.objectivesAr[idx] || ''}
                  studyLang={studyLang}
                  className="text-sm text-slate-700 dark:text-slate-200"
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Section 2, 7, 13: Detailed Parts + Diagrams + Interactive Check Questions */}
      {activeLesson.parts.map((part, idx) => {
        const isPartDone = completedParts.includes(part.id);
        const chosenCheck = checkAnswers[part.id];
        const checkOptions = part.checkQuestion
          ? mergeBilingualOptions(part.checkQuestion.optionsAr, part.checkQuestion.optionsEn, studyLang)
          : [];
        return (
          <section key={part.id} className="rounded-2xl glass-card p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <BilingualTitle
                ar={part.titleAr}
                en={part.titleEn}
                studyLang={studyLang}
                as="h2"
                className="text-lg font-bold"
              />
              <button
                onClick={() => togglePartComplete(part.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
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

            <BilingualTextBlock
              ar={part.explanationAr}
              en={part.explanationEn}
              studyLang={studyLang}
              rich
              collapsibleTranslation={studyLang === 'bilingual'}
              className="text-slate-700 dark:text-slate-300"
            />

            {part.equationsLatex && part.equationsLatex.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" dir="ltr">
                {part.equationsLatex.map((eq, eIdx) => (
                  <LatexBlock key={eIdx} latex={eq} />
                ))}
              </div>
            )}

            {part.diagramType && <PhysicsDiagramSVG type={part.diagramType} lang={lang} studyLang={studyLang} />}

            {/* Interactive check question after part */}
            {part.checkQuestion && (
              <div className="mt-4 rounded-xl glass-subcard !border-cyan-500/25 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-600 dark:text-cyan-400 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4" />
                  {lang === 'ar' ? `تحقق من فهمك (الجزء ${idx + 1})` : `Quick Check (Part ${idx + 1})`}
                </p>
                <BilingualTextBlock
                  ar={part.checkQuestion.questionAr}
                  en={part.checkQuestion.questionEn}
                  studyLang={studyLang}
                  rich
                  className="text-sm font-medium"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {checkOptions.map((opt, oIdx) => {
                    const isPicked = chosenCheck === oIdx;
                    const isRight = part.checkQuestion!.correctIndex === oIdx;
                    return (
                      <button
                        key={oIdx}
                        onClick={() => setCheckAnswers((prev) => ({ ...prev, [part.id]: oIdx }))}
                        className={`p-2.5 rounded-xl border text-start text-xs font-medium transition-all cursor-pointer ${
                          chosenCheck === undefined
                            ? 'glass-btn-secondary'
                            : isRight
                            ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : isPicked
                            ? 'border-rose-500/70 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                            : 'border-slate-200/40 dark:border-white/10 opacity-60'
                        }`}
                      >
                        {studyLang === 'bilingual' && opt.ar !== opt.en ? (
                          <div className="space-y-0.5">
                            <p dir="rtl">{opt.ar}</p>
                            <p dir="ltr" className="text-[11px] opacity-80">{opt.en}</p>
                          </div>
                        ) : (
                          <span>{opt.single}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {chosenCheck !== undefined && (
                  <BilingualTextBlock
                    ar={part.checkQuestion.explanationAr}
                    en={part.checkQuestion.explanationEn}
                    studyLang={studyLang}
                    rich
                    className="text-xs text-slate-600 dark:text-slate-300 pt-1"
                  />
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
          {Array.from({ length: conceptLen }).map((_, i) => {
            const cAr = activeLesson.conceptsAr[i];
            const cEn = activeLesson.conceptsEn[i];
            return (
              <div key={i} className="pt-2.5 border-t border-slate-200/70 dark:border-white/10 first:border-0 first:pt-0 space-y-1">
                <BilingualTitle
                  ar={cAr?.title || cEn?.title || ''}
                  en={cEn?.title || cAr?.title || ''}
                  studyLang={studyLang}
                  as="p"
                  className="text-sm font-semibold text-blue-600 dark:text-cyan-400"
                />
                <BilingualTextBlock
                  ar={cAr?.body || cEn?.body || ''}
                  en={cEn?.body || cAr?.body || ''}
                  studyLang={studyLang}
                  className="text-xs sm:text-sm text-slate-600 dark:text-slate-300"
                />
              </div>
            );
          })}
        </section>

        <section className="rounded-2xl glass-card p-6 space-y-3">
          <h2 className="text-base font-bold">
            {lang === 'ar' ? 'المصطلحات العلمية (عربي / English)' : 'Bilingual Scientific Terminology'}
          </h2>
          {activeLesson.terms.map((term, i) => (
            <div key={i} className="pt-2.5 border-t border-slate-200/70 dark:border-white/10 first:border-0 first:pt-0 space-y-1">
              <p className="text-sm font-semibold">
                <span dir="rtl">{term.termAr}</span> ·{' '}
                <span dir="ltr" className="text-blue-600 dark:text-cyan-400">{term.termEn}</span>
              </p>
              <BilingualTextBlock
                ar={term.definitionAr}
                en={term.definitionEn}
                studyLang={studyLang}
                className="text-xs text-slate-600 dark:text-slate-300"
              />
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
            <div key={idx} className="rounded-xl glass-subcard p-4 space-y-2">
              <BilingualTitle
                ar={law.nameAr}
                en={law.nameEn}
                studyLang={studyLang}
                as="p"
                className="text-sm font-semibold"
              />
              <div dir="ltr">
                <LatexBlock latex={law.latex} />
              </div>
              <BilingualTextBlock
                ar={law.noteAr}
                en={law.noteEn}
                studyLang={studyLang}
                className="text-xs text-slate-500 dark:text-slate-400"
              />
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
                  <td className="py-2 px-3 font-mono-num" dir="ltr">
                    <LatexInline latex={row.symbol} />
                  </td>
                  <td className="py-2 px-3">{pickStudyText(row.nameAr, row.nameEn, studyLang)}</td>
                  <td className="py-2 px-3 font-mono-num text-blue-600 dark:text-cyan-400" dir="ltr">
                    {pickStudyText(row.unitAr, row.unitEn, studyLang)}
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

        <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
          {Array.from({ length: everydayLen }).map((_, i) => (
            <li key={i} className="rounded-xl glass-subcard px-3.5 py-2">
              <BilingualTextBlock
                ar={activeLesson.everydayExamplesAr[i] || activeLesson.everydayExamplesEn[i] || ''}
                en={activeLesson.everydayExamplesEn[i] || activeLesson.everydayExamplesAr[i] || ''}
                studyLang={studyLang}
                className="text-sm text-slate-700 dark:text-slate-200"
              />
            </li>
          ))}
        </ul>

        {activeLesson.solvedExamples.map((ex) => {
          const givensLen = Math.max(ex.givensAr.length, ex.givensEn.length);
          const stepsLen = Math.max(ex.stepsAr.length, ex.stepsEn.length);
          return (
            <div key={ex.id} className="rounded-xl glass-subcard p-5 space-y-3">
              <BilingualTitle
                ar={ex.titleAr}
                en={ex.titleEn}
                studyLang={studyLang}
                as="h3"
                className="text-base font-bold text-blue-600 dark:text-cyan-400"
              />
              <BilingualTextBlock
                ar={ex.problemAr}
                en={ex.problemEn}
                studyLang={studyLang}
                rich
                className="text-sm leading-relaxed"
              />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-slate-500 dark:text-slate-400">
                  {lang === 'ar' ? 'المعطيات:' : 'Givens:'}
                </p>
                <div className="flex flex-wrap gap-2 font-mono-num" dir="ltr">
                  {Array.from({ length: givensLen }).map((_, i) => (
                    <span key={i} className="px-2.5 py-1 rounded-lg bg-slate-900/10 dark:bg-white/[0.06]">
                      {pickStudyText(ex.givensAr[i], ex.givensEn[i], studyLang)}
                    </span>
                  ))}
                </div>
              </div>
              <div dir="ltr">
                <LatexBlock latex={ex.formulaLatex} />
              </div>
              <ol className="space-y-2 text-sm">
                {Array.from({ length: stepsLen }).map((_, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="font-mono-num font-bold text-cyan-500 shrink-0">{i + 1}.</span>
                    <div className="flex-1">
                      <BilingualTextBlock
                        ar={ex.stepsAr[i] || ex.stepsEn[i] || ''}
                        en={ex.stepsEn[i] || ex.stepsAr[i] || ''}
                        studyLang={studyLang}
                        rich
                        className="text-sm"
                      />
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-sm font-bold font-mono-num text-emerald-600 dark:text-emerald-400">
                {lang === 'ar' ? 'الناتج النهائي:' : 'Final Answer:'} <span dir="ltr">{ex.finalAnswer}</span>
              </p>
            </div>
          );
        })}
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
              <BilingualTextBlock
                ar={prob.problemAr}
                en={prob.problemEn}
                studyLang={studyLang}
                rich
                className="text-sm"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => setRevealedHints((p) => ({ ...p, [idx]: !p[idx] }))}
                  className="px-3 py-1 rounded-lg glass-btn-secondary text-xs font-medium cursor-pointer"
                >
                  {lang === 'ar' ? 'إظهار تلميح' : 'Show Hint'}
                </button>
                <button
                  onClick={() => setRevealedAnswers((p) => ({ ...p, [idx]: !p[idx] }))}
                  className="px-3 py-1 rounded-lg glass-btn-primary text-xs font-medium cursor-pointer"
                >
                  {lang === 'ar' ? 'إظهار الإجابة' : 'Reveal Answer'}
                </button>
              </div>
              {revealedHints[idx] && (
                <BilingualTextBlock
                  ar={prob.hintAr}
                  en={prob.hintEn}
                  studyLang={studyLang}
                  rich
                  className="text-xs text-amber-600 dark:text-amber-400"
                />
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
          {Array.from({ length: mistakesLen }).map((_, i) => {
            const mAr = activeLesson.commonMistakesAr[i];
            const mEn = activeLesson.commonMistakesEn[i];
            return (
              <div key={i} className="text-sm space-y-1.5 pt-2.5 border-t border-slate-200/70 dark:border-white/10 first:border-0 first:pt-0">
                <BilingualTextBlock
                  ar={mAr?.mistake || mEn?.mistake || ''}
                  en={mEn?.mistake || mAr?.mistake || ''}
                  studyLang={studyLang}
                  className="text-rose-600 dark:text-rose-400 font-medium"
                />
                <BilingualTextBlock
                  ar={mAr?.correction || mEn?.correction || ''}
                  en={mEn?.correction || mAr?.correction || ''}
                  studyLang={studyLang}
                  className="text-emerald-600 dark:text-emerald-400 text-xs"
                />
              </div>
            );
          })}
        </section>

        <section className="rounded-2xl glass-card p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2.5 mb-2">
              <span className="glass-icon glass-icon-cyan w-8 h-8">
                <Wrench className="w-4 h-4" />
              </span>
              {lang === 'ar' ? 'تطبيقات عملية وتكنولوجية' : 'Practical Applications'}
            </h2>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {Array.from({ length: practicalLen }).map((_, i) => (
                <li key={i} className="rounded-xl glass-subcard px-3 py-2">
                  <BilingualTextBlock
                    ar={activeLesson.practicalAppsAr[i] || activeLesson.practicalAppsEn[i] || ''}
                    en={activeLesson.practicalAppsEn[i] || activeLesson.practicalAppsAr[i] || ''}
                    studyLang={studyLang}
                    className="text-xs sm:text-sm"
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
            <h3 className="text-base font-bold mb-2">
              {lang === 'ar' ? 'الملخص الشامل للدرس' : 'Comprehensive Summary'}
            </h3>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {Array.from({ length: summaryLen }).map((_, i) => (
                <li key={i} className="rounded-xl glass-subcard px-3 py-2">
                  <BilingualTextBlock
                    ar={activeLesson.summaryAr[i] || activeLesson.summaryEn[i] || ''}
                    en={activeLesson.summaryEn[i] || activeLesson.summaryAr[i] || ''}
                    studyLang={studyLang}
                    className="text-xs sm:text-sm"
                  />
                </li>
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
            {lessonQuizQuestions.map((q, qIdx) => {
              const mergedOpts = mergeBilingualOptions(q.optionsAr, q.optionsEn, studyLang);
              const stepsLen = Math.max(q.stepsAr?.length || 0, q.stepsEn?.length || 0);
              return (
                <div key={q.id} className="p-4 rounded-xl glass-subcard space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="text-sm font-bold text-cyan-500 font-mono-num">{qIdx + 1}.</span>
                    <div className="flex-1">
                      <BilingualTextBlock
                        ar={q.textAr}
                        en={q.textEn}
                        studyLang={studyLang}
                        rich
                        className="text-sm font-semibold"
                      />
                    </div>
                  </div>
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
                      {mergedOpts.map((opt, oIdx) => (
                        <button
                          key={oIdx}
                          disabled={quizSubmitted}
                          onClick={() => setQuizAnswers((p) => ({ ...p, [q.id]: String(oIdx) }))}
                          className={`p-2.5 rounded-xl border text-start text-xs font-medium transition-all cursor-pointer ${
                            quizAnswers[q.id] === String(oIdx)
                              ? 'glass-btn-primary text-white'
                              : 'glass-btn-secondary'
                          }`}
                        >
                          {studyLang === 'bilingual' && opt.ar !== opt.en ? (
                            <div className="space-y-0.5">
                              <p dir="rtl">{opt.ar}</p>
                              <p dir="ltr" className="text-[11px] opacity-80">{opt.en}</p>
                            </div>
                          ) : (
                            <span>{opt.single}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {quizSubmitted && (
                    <div className="space-y-2 pt-1">
                      <BilingualTextBlock
                        ar={q.explanationAr}
                        en={q.explanationEn}
                        studyLang={studyLang}
                        rich
                        className="text-xs text-slate-600 dark:text-slate-300"
                      />
                      {stepsLen > 0 && (
                        <ol className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                          {Array.from({ length: stepsLen }).map((_, sIdx) => (
                            <li key={sIdx} className="flex items-start gap-1.5">
                              <span className="font-mono-num font-bold text-cyan-500">{sIdx + 1}.</span>
                              <BilingualTextBlock
                                ar={q.stepsAr?.[sIdx] || q.stepsEn?.[sIdx] || ''}
                                en={q.stepsEn?.[sIdx] || q.stepsAr?.[sIdx] || ''}
                                studyLang={studyLang}
                                rich
                                className="text-xs"
                              />
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleQuizSubmit}
                disabled={quizSubmitted}
                className="px-5 py-2.5 rounded-xl glass-btn-primary text-sm font-semibold disabled:opacity-60 cursor-pointer"
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

