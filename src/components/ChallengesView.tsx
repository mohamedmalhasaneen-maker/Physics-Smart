import React, { useState } from 'react';
import { ChallengeItem, Language, LeaderboardEntry, StudyLanguage, UserProfile } from '../types/physics';
import { BilingualTextBlock, BilingualTitle } from './BilingualBlock';
import { mergeBilingualOptions } from '../lib/bilingual';
import { Award, CheckCircle2, Flame, Trophy } from 'lucide-react';

interface ChallengesViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  profile: UserProfile;
  challenges: ChallengeItem[];
  leaderboard: LeaderboardEntry[];
  onAwardPoints: (points: number, badgeName?: string) => Promise<void>;
}

export function ChallengesView({
  lang,
  studyLang,
  profile,
  challenges,
  leaderboard,
  onAwardPoints,
}: ChallengesViewProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [solvedIds, setSolvedIds] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const submitChallenge = async (ch: ChallengeItem) => {
    const q = ch.question;
    const ans = (selectedAnswers[ch.id] || '').trim();
    if (!ans) return;

    let ok = false;
    if (q.type === 'numerical' && typeof q.numericValue === 'number') {
      const n = parseFloat(ans);
      ok = !Number.isNaN(n) && Math.abs(n - q.numericValue) <= Math.max(Math.abs(q.numericValue) * 0.02, 0.01);
    } else {
      ok = ans === q.correctAnswer;
    }

    if (ok && !solvedIds[ch.id]) {
      setSolvedIds((p) => ({ ...p, [ch.id]: true }));
      const badge = ch.kind === 'weekly' ? 'Weekly Physicist' : ch.kind === 'calculation' ? 'Precision Solver' : undefined;
      await onAwardPoints(ch.points, badge);
      setFeedback((p) => ({
        ...p,
        [ch.id]: {
          ok: true,
          msg:
            lang === 'ar'
              ? `إجابة دقيقة! تم إضافة +${ch.points} نقطة إلى رصيدك.`
              : `Accurate solution! +${ch.points} points awarded.`,
        },
      }));
    } else if (!ok) {
      setFeedback((p) => ({
        ...p,
        [ch.id]: {
          ok: false,
          msg: lang === 'ar' ? 'ليست دقيقة تمامًا — راجع القوانين وحاول مجددًا.' : 'Not quite right — review the physics principle and try again.',
        },
      }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="rounded-2xl glass-card p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {lang === 'ar' ? 'التحديات والمسابقات العلمية' : 'Physics Challenges & Leaderboard'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {lang === 'ar'
              ? 'يعتمد التقييم على دقة الفهم والحل الرياضي الصحيح وليس التسرع.'
              : 'Points reward conceptual accuracy and verified mathematical reasoning—not blind speed.'}
          </p>
        </div>

        <div className="flex items-center gap-6 font-mono-num">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'نقاطك' : 'Points'}</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-cyan-400">{profile.points}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'المستوى' : 'Level'}</p>
            <p className="text-2xl font-bold">{profile.level}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'الشارات' : 'Badges'}</p>
            <p className="text-2xl font-bold">{profile.badges?.length || 0}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Challenges */}
        <div className="lg:col-span-7 space-y-4">
          {challenges.map((ch) => {
            const q = ch.question;
            const fb = feedback[ch.id];
            const mergedOptions = mergeBilingualOptions(q.optionsAr, q.optionsEn, studyLang);
            return (
              <div key={ch.id} className="rounded-2xl glass-card p-6 space-y-3">
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="glass-icon glass-icon-cyan w-7 h-7 shrink-0">
                      <Flame className="w-3.5 h-3.5" />
                    </span>
                    <BilingualTitle
                      ar={ch.titleAr}
                      en={ch.titleEn}
                      studyLang={studyLang}
                      as="span"
                      className="font-bold text-blue-600 dark:text-cyan-400 text-xs"
                      subClassName="text-[11px] text-slate-500 dark:text-cyan-300/80"
                    />
                  </div>
                  <span className="font-mono-num font-semibold shrink-0">+{ch.points} pts</span>
                </div>

                <BilingualTextBlock
                  ar={q.textAr}
                  en={q.textEn}
                  studyLang={studyLang}
                  rich
                  className="text-sm font-medium leading-relaxed"
                />

                {q.type === 'numerical' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      disabled={!!solvedIds[ch.id]}
                      value={selectedAnswers[ch.id] || ''}
                      onChange={(e) => setSelectedAnswers((p) => ({ ...p, [ch.id]: e.target.value }))}
                      placeholder={lang === 'ar' ? 'أدخل القيمة...' : 'Enter value...'}
                      className="px-3 py-2 rounded-xl glass-input text-sm font-mono-num"
                    />
                    {q.numericUnit && <span className="text-xs font-mono-num text-slate-500">{q.numericUnit}</span>}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {mergedOptions.map((opt, idx) => (
                      <button
                        key={idx}
                        disabled={!!solvedIds[ch.id]}
                        onClick={() => setSelectedAnswers((p) => ({ ...p, [ch.id]: String(idx) }))}
                        className={`p-2.5 rounded-xl border text-start text-xs font-medium transition-all ${
                          selectedAnswers[ch.id] === String(idx)
                            ? 'glass-btn-primary text-white'
                            : 'glass-btn-secondary'
                        }`}
                      >
                        {studyLang === 'bilingual' ? (
                          <div className="space-y-0.5">
                            <span dir="rtl" className="block">{opt.ar}</span>
                            {opt.en && opt.en !== opt.ar && (
                              <span dir="ltr" className="block text-[11px] opacity-80">{opt.en}</span>
                            )}
                          </div>
                        ) : (
                          <span dir={studyLang === 'ar' ? 'rtl' : 'ltr'}>{opt.single}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    disabled={!!solvedIds[ch.id]}
                    onClick={() => submitChallenge(ch)}
                    className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold disabled:opacity-50"
                  >
                    {solvedIds[ch.id] ? (lang === 'ar' ? 'مكتمل' : 'Completed') : (lang === 'ar' ? 'تحقق وأرسل' : 'Verify & Submit')}
                  </button>
                  {fb && (
                    <span className={`text-xs font-medium ${fb.ok ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {fb.msg}
                    </span>
                  )}
                </div>

                {solvedIds[ch.id] && (q.explanationAr || q.explanationEn) && (
                  <div className="glass-subcard rounded-xl p-3 text-xs space-y-1">
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {lang === 'ar' ? 'التفسير العلمي:' : 'Scientific Explanation:'}
                    </p>
                    <BilingualTextBlock
                      ar={q.explanationAr}
                      en={q.explanationEn}
                      studyLang={studyLang}
                      rich
                      className="text-slate-600 dark:text-slate-300"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Leaderboard & Badges */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl glass-card p-6 space-y-4">
            <h2 className="text-base font-bold flex items-center gap-2.5">
              <span className="glass-icon glass-icon-amber w-8 h-8">
                <Trophy className="w-4 h-4" />
              </span>
              {lang === 'ar' ? 'لوحة الترتيب' : 'Student Leaderboard'}
            </h2>
            {leaderboard.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'ar' ? 'أكمل تحديًا لتتصدر لوحة الشرف!' : 'Solve a challenge to appear on the leaderboard!'}
              </p>
            ) : (
              <div className="divide-y divide-slate-200/70 dark:divide-white/10 text-sm">
                {leaderboard.map((entry, idx) => (
                  <div key={entry.uid} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono-num text-xs font-bold w-6 text-slate-400">#{idx + 1}</span>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{entry.displayName}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Lvl {entry.level} · {entry.track}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono-num font-bold text-blue-600 dark:text-cyan-400 shrink-0">
                      {entry.points} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl glass-card p-6 space-y-3">
            <h2 className="text-base font-bold flex items-center gap-2.5">
              <span className="glass-icon glass-icon-violet w-8 h-8">
                <Award className="w-4 h-4" />
              </span>
              {lang === 'ar' ? 'شارات الإنجاز' : 'Earned Badges'}
            </h2>
            {profile.badges && profile.badges.length > 0 ? (
              <div className="space-y-1.5 text-sm">
                {profile.badges.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'ar' ? 'حل التحديات الأسبوعية والدروس لكسب الشارات.' : 'Complete lessons and weekly challenges to unlock badges.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
