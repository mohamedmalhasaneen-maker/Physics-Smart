import React, { useState } from 'react';
import { Difficulty, Language, QuestionItem, QuestionType, UserProfile } from '../types/physics';
import { getGradeLabel, getTrackById } from '../data/tracks';
import { CheckCircle2, XCircle } from 'lucide-react';
import { evaluate } from 'mathjs';

interface QuestionBankViewProps {
  lang: Language;
  profile: UserProfile;
  questions: QuestionItem[];
}

export function QuestionBankView({ lang, profile, questions }: QuestionBankViewProps) {
  const trackInfo = getTrackById(profile.track);
  const gradeLabel = getGradeLabel(profile.track, profile.grade, lang);

  // Strict track + grade isolation
  const scopedQuestions = questions.filter((q) => q.track === profile.track && q.grade === profile.grade);

  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<QuestionType | 'all'>('all');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const visible = scopedQuestions.filter((q) => {
    if (difficultyFilter !== 'all' && q.difficulty !== difficultyFilter) return false;
    if (typeFilter !== 'all' && q.type !== typeFilter) return false;
    return true;
  });

  const isCorrect = (q: QuestionItem) => {
    const val = (answers[q.id] || '').trim();
    if (!val) return false;
    if (q.type === 'numerical' && typeof q.numericValue === 'number') {
      try {
        const cleaned = val.replace(/[^\d.+\-*/^()eE]/g, '');
        if (!cleaned) return false;
        const n = Number(evaluate(cleaned));
        return (
          Number.isFinite(n) &&
          Math.abs(n - q.numericValue) <= Math.max(Math.abs(q.numericValue) * (q.tolerance || 0.02), 0.01)
        );
      } catch {
        return false;
      }
    }
    return val.toLowerCase() === q.correctAnswer.trim().toLowerCase();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="rounded-2xl glass-card p-6 space-y-4">
        <div>
          <p className="text-xs text-blue-600 dark:text-cyan-400">
            {lang === 'ar' ? trackInfo?.nameAr : trackInfo?.nameEn} · {gradeLabel}
          </p>
          <h1 className="text-2xl font-bold mt-0.5">
            {lang === 'ar' ? 'بنك الأسئلة الفيزيائية' : 'Physics Question Bank'}
          </h1>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            value={difficultyFilter}
            onChange={(e) => setDifficultyFilter(e.target.value as any)}
            className="px-3 py-2 rounded-xl glass-input text-xs"
          >
            <option value="all">{lang === 'ar' ? 'كل المستويات' : 'All Difficulties'}</option>
            <option value="easy">{lang === 'ar' ? 'سهل' : 'Easy'}</option>
            <option value="medium">{lang === 'ar' ? 'متوسط' : 'Medium'}</option>
            <option value="hard">{lang === 'ar' ? 'صعب' : 'Hard'}</option>
            <option value="advanced">{lang === 'ar' ? 'متقدم' : 'Advanced'}</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="px-3 py-2 rounded-xl glass-input text-xs"
          >
            <option value="all">{lang === 'ar' ? 'كل أنواع الأسئلة' : 'All Question Types'}</option>
            <option value="mcq">{lang === 'ar' ? 'اختيار من متعدد' : 'Multiple Choice'}</option>
            <option value="true_false">{lang === 'ar' ? 'صح وخطأ' : 'True / False'}</option>
            <option value="numerical">{lang === 'ar' ? 'مسائل حسابية' : 'Numerical'}</option>
            <option value="graph_analysis">{lang === 'ar' ? 'تحليل رسوم بيانية' : 'Graph Analysis'}</option>
            <option value="experiment">{lang === 'ar' ? 'تجارب معملية' : 'Experiment-Based'}</option>
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl glass-card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          {lang === 'ar'
            ? 'لا توجد أسئلة مطابقة للتصفية الحالية.'
            : 'No questions match the selected filters.'}
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((q, idx) => {
            const wasChecked = checked[q.id];
            const right = isCorrect(q);
            return (
              <div
                key={q.id}
                className="rounded-2xl glass-card p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    #{idx + 1} · {q.difficulty.toUpperCase()} · {lang === 'ar' ? q.skillAr : q.skillEn}
                  </span>
                  <span>{lang === 'ar' ? q.sourceAr : q.sourceEn}</span>
                </div>

                <p className="text-base font-semibold leading-relaxed">
                  {lang === 'ar' ? q.textAr : q.textEn}
                </p>

                {q.type === 'numerical' || !(lang === 'ar' ? q.optionsAr : q.optionsEn)?.length ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      dir={q.type === 'numerical' ? 'ltr' : 'auto'}
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                      placeholder={
                        q.type === 'numerical'
                          ? lang === 'ar'
                            ? 'أدخل القيمة أو التعبير الرياضي...'
                            : 'Enter numeric value or expression...'
                          : lang === 'ar'
                          ? 'أدخل إجابتك...'
                          : 'Enter your answer...'
                      }
                      className="flex-1 max-w-md px-3.5 py-2 rounded-xl glass-input text-sm font-mono-num"
                    />
                    {q.numericUnit && <span className="text-xs font-mono-num text-slate-500">{q.numericUnit}</span>}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(lang === 'ar' ? q.optionsAr || [] : q.optionsEn || []).map((opt, oIdx) => {
                      const picked = answers[q.id] === String(oIdx);
                      const isRightOpt = q.correctAnswer === String(oIdx);
                      const wrongReason =
                        lang === 'ar' ? q.wrongOptionReasonsAr?.[oIdx] : q.wrongOptionReasonsEn?.[oIdx];
                      return (
                        <div key={oIdx} className="space-y-1">
                          <button
                            onClick={() => setAnswers((p) => ({ ...p, [q.id]: String(oIdx) }))}
                            className={`w-full text-start p-3 rounded-xl border text-xs font-medium transition-all ${
                              !wasChecked
                                ? picked
                                  ? 'glass-btn-primary text-white'
                                  : 'glass-btn-secondary'
                                : isRightOpt
                                ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : picked
                                ? 'border-rose-500/70 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                                : 'border-slate-200/40 dark:border-white/10 opacity-70'
                            }`}
                          >
                            {opt}
                          </button>
                          {wasChecked && !isRightOpt && wrongReason && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">{wrongReason}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setChecked((p) => ({ ...p, [q.id]: true }))}
                    className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold"
                  >
                    {lang === 'ar' ? 'تحقق من الإجابة' : 'Check Answer'}
                  </button>

                  {wasChecked && (
                    <span
                      className={`text-xs font-semibold flex items-center gap-1.5 ${
                        right ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                      }`}
                    >
                      {right ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      {right
                        ? lang === 'ar'
                          ? 'إجابة صحيحة!'
                          : 'Correct!'
                        : lang === 'ar'
                        ? `الإجابة الصحيحة: ${q.numericValue ?? q.correctAnswer}`
                        : `Correct answer: ${q.numericValue ?? q.correctAnswer}`}
                    </span>
                  )}
                </div>

                {wasChecked && (
                  <div className="rounded-xl glass-subcard p-4 text-xs leading-relaxed">
                    <p className="font-semibold mb-1">{lang === 'ar' ? 'شرح الحل:' : 'Solution Explanation:'}</p>
                    <p>{lang === 'ar' ? q.explanationAr : q.explanationEn}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
