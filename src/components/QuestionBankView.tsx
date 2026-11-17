import React, { useEffect, useState } from 'react';
import { Difficulty, Language, QuestionItem, QuestionType, StudyLanguage, UserProfile } from '../types/physics';
import { getGradeLabel, getTrackLabel } from '../data/tracks';
import { mergeBilingualOptions, pickStudyText } from '../lib/bilingual';
import { BilingualTextBlock, StudyLanguageSwitcher } from './BilingualBlock';
import { FavoriteRecord } from '../lib/offlineDb';
import { Bookmark, CheckCircle2, XCircle } from 'lucide-react';
import { evaluate } from 'mathjs';

interface QuestionBankViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  profile: UserProfile;
  questions: QuestionItem[];
  favorites?: FavoriteRecord[];
  onToggleFavorite?: (item: { itemType: 'lesson' | 'formula' | 'question'; itemId: string; titleAr: string; titleEn: string }) => Promise<void>;
}

export function QuestionBankView({
  lang,
  studyLang,
  profile,
  questions,
  favorites = [],
  onToggleFavorite,
}: QuestionBankViewProps) {
  const [viewLang, setViewLang] = useState<StudyLanguage>(studyLang);
  const [visibleLimit, setVisibleLimit] = useState(15);

  useEffect(() => {
    setViewLang(studyLang);
  }, [studyLang]);

  const trackLabel = getTrackLabel(profile.track, viewLang);
  const gradeLabel = getGradeLabel(profile.track, profile.grade, viewLang);

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
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-blue-600 dark:text-cyan-400">
              {trackLabel} · {gradeLabel}
            </p>
            <h1 className="text-2xl font-bold mt-0.5">
              {lang === 'ar' ? 'بنك الأسئلة الفيزيائية' : 'Physics Question Bank'}
            </h1>
          </div>

          <StudyLanguageSwitcher
            value={viewLang}
            onChange={setViewLang}
            uiLang={lang}
            label={lang === 'ar' ? 'لغة الأسئلة:' : 'Question Language:'}
          />
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
          {visible.slice(0, visibleLimit).map((q, idx) => {
            const wasChecked = checked[q.id];
            const right = isCorrect(q);
            const mergedOpts = mergeBilingualOptions(q.optionsAr, q.optionsEn, viewLang);
            const stepsLen = Math.max(q.stepsAr?.length || 0, q.stepsEn?.length || 0);
            const isFav = favorites.some((f) => f.itemType === 'question' && f.itemId === q.id);
            return (
              <div key={q.id} className="rounded-2xl glass-card p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    #{idx + 1} · {q.difficulty.toUpperCase()} · {pickStudyText(q.skillAr, q.skillEn, viewLang)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span>{pickStudyText(q.sourceAr, q.sourceEn, viewLang)}</span>
                    {onToggleFavorite && (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleFavorite({
                            itemType: 'question',
                            itemId: q.id,
                            titleAr: q.textAr.slice(0, 80),
                            titleEn: q.textEn.slice(0, 80),
                          })
                        }
                        className={`p-1 rounded-lg glass-btn-secondary cursor-pointer ${
                          isFav ? 'text-amber-500' : 'text-slate-400'
                        }`}
                      >
                        <Bookmark className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-500' : ''}`} />
                      </button>
                    )}
                  </div>
                </div>

                <BilingualTextBlock
                  ar={q.textAr}
                  en={q.textEn}
                  studyLang={viewLang}
                  rich
                  className="text-base font-semibold leading-relaxed"
                />

                {q.type === 'numerical' || mergedOpts.length === 0 ? (
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
                    {mergedOpts.map((opt, oIdx) => {
                      const picked = answers[q.id] === String(oIdx);
                      const isRightOpt = q.correctAnswer === String(oIdx);
                      const wrongAr = q.wrongOptionReasonsAr?.[oIdx];
                      const wrongEn = q.wrongOptionReasonsEn?.[oIdx];
                      return (
                        <div key={oIdx} className="space-y-1">
                          <button
                            onClick={() => setAnswers((p) => ({ ...p, [q.id]: String(oIdx) }))}
                            className={`w-full text-start p-3 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
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
                            {viewLang === 'bilingual' && opt.ar !== opt.en ? (
                              <div className="space-y-0.5">
                                <p dir="rtl">{opt.ar}</p>
                                <p dir="ltr" className="text-[11px] opacity-80">{opt.en}</p>
                              </div>
                            ) : (
                              <span>{opt.single}</span>
                            )}
                          </button>
                          {wasChecked && !isRightOpt && (wrongAr || wrongEn) && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">
                              {pickStudyText(wrongAr, wrongEn, viewLang)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setChecked((p) => ({ ...p, [q.id]: true }))}
                    className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold cursor-pointer"
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
                  <div className="rounded-xl glass-subcard p-4 text-xs leading-relaxed space-y-2">
                    <p className="font-semibold">{lang === 'ar' ? 'شرح الحل:' : 'Solution Explanation:'}</p>
                    <BilingualTextBlock
                      ar={q.explanationAr}
                      en={q.explanationEn}
                      studyLang={viewLang}
                      rich
                      className="text-xs text-slate-700 dark:text-slate-300"
                    />
                    {stepsLen > 0 && (
                      <ol className="space-y-1.5 pt-2 border-t border-slate-200/60 dark:border-white/10">
                        {Array.from({ length: stepsLen }).map((_, sIdx) => (
                          <li key={sIdx} className="flex items-start gap-2">
                            <span className="font-mono-num font-bold text-cyan-500 shrink-0">{sIdx + 1}.</span>
                            <BilingualTextBlock
                              ar={q.stepsAr?.[sIdx] || q.stepsEn?.[sIdx] || ''}
                              en={q.stepsEn?.[sIdx] || q.stepsAr?.[sIdx] || ''}
                              studyLang={viewLang}
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
          {visible.length > visibleLimit && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setVisibleLimit((n) => n + 15)}
                className="px-5 py-2.5 rounded-xl glass-btn-secondary text-xs font-semibold cursor-pointer"
              >
                {lang === 'ar'
                  ? `عرض المزيد (${visible.length - visibleLimit} أسئلة متبقية)`
                  : `Show More (${visible.length - visibleLimit} remaining)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

