import React, { useEffect, useState } from 'react';
import {
  ExamAttempt,
  ExamBlueprint,
  Language,
  QuestionItem,
  StudyLanguage,
  UserProfile,
} from '../types/physics';
import { mergeBilingualOptions, pickStudyText } from '../lib/bilingual';
import { BilingualTextBlock, BilingualTitle, StudyLanguageSwitcher } from './BilingualBlock';
import { ActiveExamSnapshot } from '../lib/offlineDb';
import { Clock, CloudOff, Play, RotateCcw, CheckCircle2, XCircle } from 'lucide-react';
import { evaluate } from 'mathjs';

interface ExamsViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  profile: UserProfile;
  exams: ExamBlueprint[];
  questions: QuestionItem[];
  attempts: ExamAttempt[];
  onSaveAttempt: (attempt: ExamAttempt) => Promise<void>;
  activeSnapshot?: ActiveExamSnapshot | null;
  onSaveSnapshot?: (snapshot: ActiveExamSnapshot | null) => Promise<void>;
  onExamActiveChange?: (active: boolean) => void;
  isOnline?: boolean;
}

export function ExamsView({
  lang,
  studyLang,
  profile,
  exams,
  questions,
  attempts,
  onSaveAttempt,
  activeSnapshot,
  onSaveSnapshot,
  onExamActiveChange,
  isOnline = true,
}: ExamsViewProps) {
  const scopedExams = exams.filter((e) => e.track === profile.track && e.grade === profile.grade);
  const scopedQuestions = questions.filter((q) => q.track === profile.track && q.grade === profile.grade);

  const [examLang, setExamLang] = useState<StudyLanguage>(studyLang);

  useEffect(() => {
    setExamLang(studyLang);
  }, [studyLang]);

  const [activeExam, setActiveExam] = useState<{
    id: string;
    title: string;
    questions: QuestionItem[];
    durationMinutes: number;
    attemptId: string;
    examLang: StudyLanguage;
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [submittedResult, setSubmittedResult] = useState<{
    score: number;
    maxScore: number;
    details: Array<{ q: QuestionItem; correct: boolean; userAnswer: string }>;
  } | null>(null);

  // Custom Exam Generator state
  const [customMinutes, setCustomMinutes] = useState(10);
  const [customCount, setCustomCount] = useState(3);
  const [customShuffle, setCustomShuffle] = useState(true);

  useEffect(() => {
    onExamActiveChange?.(Boolean(activeExam && !submittedResult));
    return () => onExamActiveChange?.(false);
  }, [activeExam, submittedResult, onExamActiveChange]);

  useEffect(() => {
    if (!activeExam || submittedResult) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeExam?.attemptId, submittedResult]);

  // Periodically save timer & answers snapshot so reload/offline exit resumes seamlessly
  useEffect(() => {
    if (!activeExam || submittedResult || !onSaveSnapshot) return;
    if (secondsLeft > 0 && secondsLeft % 5 === 0) {
      void onSaveSnapshot({
        uid: profile.uid,
        attemptId: activeExam.attemptId,
        examId: activeExam.id,
        title: activeExam.title,
        track: profile.track === 'unset' ? 'thanawiya' : profile.track,
        questionIds: activeExam.questions.map((q) => q.id),
        durationMinutes: activeExam.durationMinutes,
        secondsLeft,
        lastTickAt: Date.now(),
        answers,
        examLang: activeExam.examLang,
        startedAtMs: Date.now(),
      });
    }
  }, [secondsLeft, activeExam, submittedResult, answers, profile.uid, profile.track, onSaveSnapshot]);

  useEffect(() => {
    if (activeExam && !submittedResult && secondsLeft === 0) {
      handleSubmitExam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, activeExam?.attemptId, submittedResult]);

  const startExam = async (
    examId: string,
    title: string,
    qList: QuestionItem[],
    durationMin: number,
    chosenLang: StudyLanguage = examLang
  ) => {
    const attemptId = `att-${Date.now()}`;
    const initialSeconds = durationMin * 60;
    setAnswers({});
    setSubmittedResult(null);
    setSecondsLeft(initialSeconds);
    setActiveExam({ id: examId, title, questions: qList, durationMinutes: durationMin, attemptId, examLang: chosenLang });
    if (onSaveSnapshot) {
      await onSaveSnapshot({
        uid: profile.uid,
        attemptId,
        examId,
        title,
        track: profile.track === 'unset' ? 'thanawiya' : profile.track,
        questionIds: qList.map((q) => q.id),
        durationMinutes: durationMin,
        secondsLeft: initialSeconds,
        lastTickAt: Date.now(),
        answers: {},
        examLang: chosenLang,
        startedAtMs: Date.now(),
      });
    }
    await onSaveAttempt({
      id: attemptId,
      userId: profile.uid,
      examId,
      examTitle: title,
      track: profile.track === 'unset' ? 'thanawiya' : profile.track,
      status: 'in_progress',
      score: 0,
      maxScore: qList.length,
      answersJson: '{}',
    });
  };

  const resumeSavedExam = (snap: ActiveExamSnapshot) => {
    const restoredQs = snap.questionIds
      .map((id) => questions.find((q) => q.id === id))
      .filter((x): x is QuestionItem => Boolean(x));
    const finalQs = restoredQs.length > 0 ? restoredQs : scopedQuestions;
    if (finalQs.length === 0) return;

    setSubmittedResult(null);
    setAnswers(snap.answers || {});
    setSecondsLeft(Math.max(10, snap.secondsLeft));
    setActiveExam({
      id: snap.examId,
      title: snap.title,
      questions: finalQs,
      durationMinutes: snap.durationMinutes,
      attemptId: snap.attemptId,
      examLang: snap.examLang || examLang,
    });
  };

  const startBlueprintExam = (bp: ExamBlueprint) => {
    const qList = bp.questionIds
      .map((id) => scopedQuestions.find((q) => q.id === id))
      .filter((x): x is QuestionItem => Boolean(x));
    const finalQs = qList.length > 0 ? qList : scopedQuestions;
    startExam(bp.id, pickStudyText(bp.titleAr, bp.titleEn, examLang), finalQs, bp.durationMinutes, examLang);
  };

  const startCustomExam = () => {
    const pool = [...scopedQuestions];
    if (customShuffle) {
      pool.sort(() => Math.random() - 0.5);
    }
    const picked = pool.slice(0, Math.min(customCount, pool.length));
    if (picked.length === 0) return;
    startExam(
      'custom-exam',
      pickStudyText('امتحان تجريبي مخصص', 'Custom Mock Exam', examLang),
      picked,
      customMinutes,
      examLang
    );
  };

  const handleAnswerChange = async (qId: string, val: string) => {
    const next = { ...answers, [qId]: val };
    setAnswers(next);
    if (activeExam) {
      if (onSaveSnapshot) {
        void onSaveSnapshot({
          uid: profile.uid,
          attemptId: activeExam.attemptId,
          examId: activeExam.id,
          title: activeExam.title,
          track: profile.track === 'unset' ? 'thanawiya' : profile.track,
          questionIds: activeExam.questions.map((q) => q.id),
          durationMinutes: activeExam.durationMinutes,
          secondsLeft,
          lastTickAt: Date.now(),
          answers: next,
          examLang: activeExam.examLang,
          startedAtMs: Date.now(),
        });
      }
      await onSaveAttempt({
        id: activeExam.attemptId,
        userId: profile.uid,
        examId: activeExam.id,
        examTitle: activeExam.title,
        track: profile.track === 'unset' ? 'thanawiya' : profile.track,
        status: 'in_progress',
        score: 0,
        maxScore: activeExam.questions.length,
        answersJson: JSON.stringify(next),
      });
    }
  };

  const gradeQuestion = (q: QuestionItem, rawAns: string): boolean => {
    const val = (rawAns || '').trim();
    if (!val) return false;
    if (q.type === 'numerical' && typeof q.numericValue === 'number') {
      try {
        const cleaned = val.replace(/[^\d.+\-*/^()eE]/g, '');
        if (!cleaned) return false;
        const evaluated = Number(evaluate(cleaned));
        if (!Number.isFinite(evaluated)) return false;
        const tol = Math.max(Math.abs(q.numericValue) * (q.tolerance || 0.02), 0.01);
        return Math.abs(evaluated - q.numericValue) <= tol;
      } catch {
        return false;
      }
    }
    return val === q.correctAnswer;
  };

  const handleSubmitExam = async () => {
    if (!activeExam) return;
    const details = activeExam.questions.map((q) => {
      const userAnswer = answers[q.id] || '';
      return { q, correct: gradeQuestion(q, userAnswer), userAnswer };
    });
    const score = details.filter((d) => d.correct).length;
    setSubmittedResult({ score, maxScore: activeExam.questions.length, details });

    if (onSaveSnapshot) {
      await onSaveSnapshot(null);
    }

    await onSaveAttempt({
      id: activeExam.attemptId,
      userId: profile.uid,
      examId: activeExam.id,
      examTitle: activeExam.title,
      track: profile.track === 'unset' ? 'thanawiya' : profile.track,
      status: 'submitted',
      score,
      maxScore: activeExam.questions.length,
      answersJson: JSON.stringify(answers),
    });
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (activeExam) {
    const currentExamLang = activeExam.examLang;
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="rounded-2xl glass-panel border p-5 flex flex-wrap items-center justify-between gap-4 sticky top-20 z-20">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{activeExam.title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num flex items-center gap-2">
              <span>
                {activeExam.questions.length} {lang === 'ar' ? 'أسئلة' : 'questions'} ·{' '}
                {lang === 'ar' ? 'يتم حفظ الإجابات محليًا تلقائيًا' : 'Auto-saving locally'}
              </span>
              {!isOnline && (
                <span className="text-amber-500 inline-flex items-center gap-1">
                  <CloudOff className="w-3 h-3" />
                  {lang === 'ar' ? 'أوفلاين' : 'Offline'}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <StudyLanguageSwitcher
              value={currentExamLang}
              onChange={(next) => setActiveExam((prev) => (prev ? { ...prev, examLang: next } : prev))}
              uiLang={lang}
              compact
            />
            <span className="font-mono-num text-sm font-bold px-3 py-1.5 rounded-xl glass-subcard flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-cyan-500" />
              {formatTimer(secondsLeft)}
            </span>
            {!submittedResult && (
              <button
                onClick={handleSubmitExam}
                className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold cursor-pointer"
              >
                {lang === 'ar' ? 'إنهاء وتصحيح الامتحان' : 'Submit & Grade'}
              </button>
            )}
          </div>
        </div>

        {submittedResult && (
          <div className="rounded-2xl glass-card !border-cyan-400/50 bg-blue-500/10 p-6 flex flex-wrap items-center justify-between gap-4 glass-enter">
            <div>
              <p className="text-xs text-blue-600 dark:text-cyan-400 font-semibold">
                {lang === 'ar' ? 'النتيجة النهائية' : 'Final Graded Score'}
              </p>
              <p className="text-3xl font-bold font-mono-num mt-1">
                {submittedResult.score} / {submittedResult.maxScore} (
                {Math.round((submittedResult.score / (submittedResult.maxScore || 1)) * 100)}%)
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  startExam(activeExam.id, activeExam.title, activeExam.questions, activeExam.durationMinutes, currentExamLang)
                }
                className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'إعادة الامتحان' : 'Retake Exam'}
              </button>
              <button
                onClick={() => setActiveExam(null)}
                className="px-4 py-2 rounded-xl glass-btn-secondary text-xs font-semibold cursor-pointer"
              >
                {lang === 'ar' ? 'العودة للامتحانات' : 'Back to Exams'}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {activeExam.questions.map((q, idx) => {
            const graded = submittedResult?.details.find((d) => d.q.id === q.id);
            const mergedOpts = mergeBilingualOptions(q.optionsAr, q.optionsEn, currentExamLang);
            const correctOption = mergedOpts[Number(q.correctAnswer)];
            const stepsLen = Math.max(q.stepsAr?.length || 0, q.stepsEn?.length || 0);
            return (
              <div key={q.id} className="rounded-2xl glass-card p-6 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>#{idx + 1}</span>
                  {graded && (
                    <span className={`font-semibold flex items-center gap-1 ${graded.correct ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {graded.correct ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      {graded.correct ? (lang === 'ar' ? 'صحيح' : 'Correct') : (lang === 'ar' ? 'خطأ' : 'Incorrect')}
                    </span>
                  )}
                </div>

                <BilingualTextBlock
                  ar={q.textAr}
                  en={q.textEn}
                  studyLang={currentExamLang}
                  rich
                  className="text-sm sm:text-base font-semibold"
                />

                {q.type === 'numerical' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      disabled={!!submittedResult}
                      value={answers[q.id] || ''}
                      onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                      placeholder={lang === 'ar' ? 'القيمة أو التعبير الحسابي (مثال: 36 أو 0.5*2*36)' : 'Numeric value or math expression'}
                      className="flex-1 max-w-xs px-3.5 py-2 rounded-xl glass-input text-sm font-mono-num"
                    />
                    {q.numericUnit && <span className="text-xs font-mono-num text-slate-500">{q.numericUnit}</span>}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {mergedOpts.map((opt, oIdx) => (
                      <button
                        key={oIdx}
                        disabled={!!submittedResult}
                        onClick={() => handleAnswerChange(q.id, String(oIdx))}
                        className={`p-3 rounded-xl border text-start text-xs font-medium transition-all cursor-pointer ${
                          answers[q.id] === String(oIdx)
                            ? 'glass-btn-primary text-white'
                            : 'glass-btn-secondary'
                        }`}
                      >
                        {currentExamLang === 'bilingual' && opt.ar !== opt.en ? (
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

                {submittedResult && (
                  <div className="p-3.5 rounded-xl glass-subcard text-xs space-y-2">
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {lang === 'ar' ? 'الإجابة النموذجية:' : 'Correct Answer:'}{' '}
                      {typeof q.numericValue === 'number'
                        ? `${q.numericValue} ${q.numericUnit || ''}`
                        : correctOption
                        ? pickStudyText(correctOption.ar, correctOption.en, currentExamLang)
                        : q.correctAnswer}
                    </p>
                    <BilingualTextBlock
                      ar={q.explanationAr}
                      en={q.explanationEn}
                      studyLang={currentExamLang}
                      rich
                      className="text-slate-600 dark:text-slate-300"
                    />
                    {stepsLen > 0 && (
                      <ol className="space-y-1 pt-1.5 border-t border-slate-200/60 dark:border-white/10">
                        {Array.from({ length: stepsLen }).map((_, sIdx) => (
                          <li key={sIdx} className="flex items-start gap-1.5">
                            <span className="font-mono-num font-bold text-cyan-500">{sIdx + 1}.</span>
                            <BilingualTextBlock
                              ar={q.stepsAr?.[sIdx] || q.stepsEn?.[sIdx] || ''}
                              en={q.stepsEn?.[sIdx] || q.stepsAr?.[sIdx] || ''}
                              studyLang={currentExamLang}
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
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {activeSnapshot && activeSnapshot.uid === profile.uid && (
        <div className="rounded-2xl glass-card border border-amber-500/35 bg-amber-500/10 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 glass-enter">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              {lang === 'ar' ? 'امتحان غير مكتمل محفوظ محليًا' : 'Unfinished Exam Saved Locally'}
            </p>
            <h2 className="text-base font-bold">{activeSnapshot.title}</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono-num">
              {Object.keys(activeSnapshot.answers || {}).length} / {activeSnapshot.questionIds.length}{' '}
              {lang === 'ar' ? 'إجابات محفوظة' : 'saved answers'} ·{' '}
              {formatTimer(activeSnapshot.secondsLeft)} {lang === 'ar' ? 'متبقية' : 'remaining'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSaveSnapshot?.(null)}
              className="px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium cursor-pointer"
            >
              {lang === 'ar' ? 'تجاهل' : 'Discard'}
            </button>
            <button
              type="button"
              onClick={() => resumeSavedExam(activeSnapshot)}
              className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'استكمال الامتحان الآن' : 'Resume Exam'}</span>
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl glass-card p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {lang === 'ar' ? 'نظام الامتحانات والاختبارات التفاعلية' : 'Exams & Assessments System'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {lang === 'ar'
                ? 'اختبارات مخصصة لصفك ونظامك التعليمي — تعمل بالكامل دون إنترنت مع حفظ تلقائي للإجابات والمزامنة عند عودة الشبكة.'
                : 'Track-scoped assessments with full offline solving, automatic answer recovery, and automatic cloud sync.'}
            </p>
          </div>
          <StudyLanguageSwitcher
            value={examLang}
            onChange={setExamLang}
            uiLang={lang}
            label={lang === 'ar' ? 'لغة أسئلة الامتحان:' : 'Exam Language:'}
          />
        </div>

        {/* Custom Exam Builder */}
        <div className="p-4 rounded-xl glass-subcard flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">
              {lang === 'ar' ? 'عدد الأسئلة' : 'Questions'}
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={customCount}
              onChange={(e) => setCustomCount(+e.target.value)}
              className="w-24 px-3 py-1.5 rounded-xl glass-input text-xs font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {lang === 'ar' ? 'الوقت (دقائق)' : 'Time (min)'}
            </label>
            <input
              type="number"
              min={1}
              max={120}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(+e.target.value)}
              className="w-24 px-3 py-1.5 rounded-xl glass-input text-xs font-mono-num"
            />
          </div>
          <label className="flex items-center gap-2 text-xs pb-1.5 cursor-pointer">
            <input type="checkbox" checked={customShuffle} onChange={(e) => setCustomShuffle(e.target.checked)} className="accent-blue-600" />
            <span>{lang === 'ar' ? 'ترتيب عشوائي' : 'Shuffle Questions'}</span>
          </label>
          <button
            onClick={startCustomExam}
            className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'إنشاء وبدء امتحان تجريبي' : 'Generate Custom Exam'}
          </button>
        </div>
      </div>

      {/* Scheduled Exams List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scopedExams.map((bp) => (
          <div key={bp.id} className="rounded-2xl glass-card-interactive p-5 flex flex-col justify-between gap-4">
            <div>
              <p className="text-xs text-blue-600 dark:text-cyan-400 font-medium uppercase">
                {bp.examType} · {bp.durationMinutes} {lang === 'ar' ? 'دقيقة' : 'min'}
              </p>
              <BilingualTitle
                ar={bp.titleAr}
                en={bp.titleEn}
                studyLang={examLang}
                as="h3"
                className="text-base font-bold mt-1"
              />
            </div>
            <button
              onClick={() => startBlueprintExam(bp)}
              className="w-full py-2.5 rounded-xl glass-btn-primary text-xs font-semibold cursor-pointer"
            >
              {lang === 'ar' ? 'بدء الامتحان' : 'Start Exam'}
            </button>
          </div>
        ))}
      </div>

      {/* Attempt History */}
      <div className="rounded-2xl glass-card p-6 space-y-3">
        <h2 className="text-base font-bold">{lang === 'ar' ? 'سجل المحاولات السابقة' : 'Previous Exam Attempts'}</h2>
        {attempts.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'لا توجد محاولات مسجلة بعد.' : 'No attempts recorded yet.'}</p>
        ) : (
          <div className="divide-y divide-slate-200/70 dark:divide-white/10 text-sm">
            {attempts.map((a) => (
              <div key={a.id} className="py-2.5 flex items-center justify-between gap-4">
                <span className="font-medium truncate">{a.examTitle}</span>
                <span className="font-mono-num text-xs text-blue-600 dark:text-cyan-400 shrink-0">
                  {a.status === 'submitted' ? `${a.score} / ${a.maxScore}` : (lang === 'ar' ? 'قيد التقدم' : 'In Progress')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

