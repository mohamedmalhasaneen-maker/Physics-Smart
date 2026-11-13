import React, { useEffect, useState } from 'react';
import {
  ExamAttempt,
  ExamBlueprint,
  Language,
  QuestionItem,
  UserProfile,
} from '../types/physics';
import { Clock, RotateCcw, CheckCircle2, XCircle, Play } from 'lucide-react';
import { evaluate } from 'mathjs';

interface ExamsViewProps {
  lang: Language;
  profile: UserProfile;
  exams: ExamBlueprint[];
  questions: QuestionItem[];
  attempts: ExamAttempt[];
  onSaveAttempt: (attempt: ExamAttempt) => Promise<void>;
}

export function ExamsView({
  lang,
  profile,
  exams,
  questions,
  attempts,
  onSaveAttempt,
}: ExamsViewProps) {
  const scopedExams = exams.filter((e) => e.track === profile.track && e.grade === profile.grade);
  const scopedQuestions = questions.filter((q) => q.track === profile.track && q.grade === profile.grade);

  const [activeExam, setActiveExam] = useState<{
    id: string;
    title: string;
    questions: QuestionItem[];
    durationMinutes: number;
    attemptId: string;
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
    if (!activeExam || submittedResult) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeExam?.attemptId, submittedResult]);

  useEffect(() => {
    if (activeExam && !submittedResult && secondsLeft === 0) {
      handleSubmitExam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, activeExam?.attemptId, submittedResult]);

  const startExam = async (examId: string, title: string, qList: QuestionItem[], durationMin: number) => {
    const attemptId = `att-${Date.now()}`;
    setAnswers({});
    setSubmittedResult(null);
    setSecondsLeft(durationMin * 60);
    setActiveExam({ id: examId, title, questions: qList, durationMinutes: durationMin, attemptId });
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

  const startBlueprintExam = (bp: ExamBlueprint) => {
    const qList = bp.questionIds
      .map((id) => scopedQuestions.find((q) => q.id === id))
      .filter((x): x is QuestionItem => Boolean(x));
    const finalQs = qList.length > 0 ? qList : scopedQuestions;
    startExam(bp.id, lang === 'ar' ? bp.titleAr : bp.titleEn, finalQs, bp.durationMinutes);
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
      lang === 'ar' ? 'امتحان تجريبي مخصص' : 'Custom Mock Exam',
      picked,
      customMinutes
    );
  };

  const handleAnswerChange = async (qId: string, val: string) => {
    const next = { ...answers, [qId]: val };
    setAnswers(next);
    if (activeExam) {
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
      // Mathematical evaluation via mathjs + tolerance check
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
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="rounded-2xl glass-panel border p-5 flex flex-wrap items-center justify-between gap-4 sticky top-20 z-20">
          <div>
            <h2 className="text-lg font-bold">{activeExam.title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              {activeExam.questions.length} {lang === 'ar' ? 'أسئلة' : 'questions'} ·{' '}
              {lang === 'ar' ? 'يتم حفظ الإجابات تلقائيًا' : 'Auto-saving answers'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono-num text-sm font-bold px-3 py-1.5 rounded-xl glass-subcard flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-cyan-500" />
              {formatTimer(secondsLeft)}
            </span>
            {!submittedResult && (
              <button
                onClick={handleSubmitExam}
                className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold"
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
                {Math.round((submittedResult.score / submittedResult.maxScore) * 100)}%)
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => startExam(activeExam.id, activeExam.title, activeExam.questions, activeExam.durationMinutes)}
                className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'إعادة الامتحان' : 'Retake Exam'}
              </button>
              <button
                onClick={() => setActiveExam(null)}
                className="px-4 py-2 rounded-xl glass-btn-secondary text-xs font-semibold"
              >
                {lang === 'ar' ? 'العودة للامتحانات' : 'Back to Exams'}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {activeExam.questions.map((q, idx) => {
            const graded = submittedResult?.details.find((d) => d.q.id === q.id);
            return (
              <div
                key={q.id}
                className="rounded-2xl glass-card p-6 space-y-3"
              >
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>#{idx + 1}</span>
                  {graded && (
                    <span className={`font-semibold flex items-center gap-1 ${graded.correct ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {graded.correct ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      {graded.correct ? (lang === 'ar' ? 'صحيح' : 'Correct') : (lang === 'ar' ? 'خطأ' : 'Incorrect')}
                    </span>
                  )}
                </div>

                <p className="text-sm sm:text-base font-semibold">{lang === 'ar' ? q.textAr : q.textEn}</p>

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
                    {(lang === 'ar' ? q.optionsAr || [] : q.optionsEn || []).map((opt, oIdx) => (
                      <button
                        key={oIdx}
                        disabled={!!submittedResult}
                        onClick={() => handleAnswerChange(q.id, String(oIdx))}
                        className={`p-3 rounded-xl border text-start text-xs font-medium transition-all ${
                          answers[q.id] === String(oIdx)
                            ? 'glass-btn-primary text-white'
                            : 'glass-btn-secondary'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {submittedResult && (
                  <div className="p-3.5 rounded-xl glass-subcard text-xs space-y-1">
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {lang === 'ar' ? 'الإجابة النموذجية:' : 'Correct Answer:'}{' '}
                      {q.numericValue ??
                        (lang === 'ar' ? q.optionsAr : q.optionsEn)?.[Number(q.correctAnswer)] ??
                        q.correctAnswer}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                      {lang === 'ar' ? q.explanationAr : q.explanationEn}
                    </p>
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
      <div className="rounded-2xl glass-card p-6 space-y-4">
        <h1 className="text-2xl font-bold">
          {lang === 'ar' ? 'نظام الامتحانات والاختبارات التفاعلية' : 'Exams & Assessments System'}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {lang === 'ar'
            ? 'اختبارات مخصصة لصفك ونظامك التعليمي، مع تصحيح رياضي دقيق للمسائل الحسابية وحفظ المحاولات.'
            : 'Track-scoped assessments with mathematical tolerance grading for numerical problems and automatic attempt history.'}
        </p>

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
            className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5"
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
              <h3 className="text-base font-bold mt-1">{lang === 'ar' ? bp.titleAr : bp.titleEn}</h3>
            </div>
            <button
              onClick={() => startBlueprintExam(bp)}
              className="w-full py-2.5 rounded-xl glass-btn-primary text-xs font-semibold"
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
