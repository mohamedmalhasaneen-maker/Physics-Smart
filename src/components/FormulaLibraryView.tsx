import React, { useState } from 'react';
import { FormulaItem, Language, StudyLanguage } from '../types/physics';
import { LatexBlock, LatexInline } from './MathRenderer';
import { BilingualTextBlock, BilingualTitle } from './BilingualBlock';
import { pickStudyText } from '../lib/bilingual';
import { Search, ArrowLeft, ArrowRight } from 'lucide-react';

interface FormulaLibraryViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  formulas: FormulaItem[];
  onOpenLesson: (lessonId: string) => void;
}

export function FormulaLibraryView({ lang, studyLang, formulas, onOpenLesson }: FormulaLibraryViewProps) {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('all');

  const categories = [
    { id: 'all', ar: 'الكل', en: 'All' },
    { id: 'kinematics', ar: 'الحركة', en: 'Kinematics' },
    { id: 'newton', ar: 'نيوتن', en: 'Newton' },
    { id: 'work_energy', ar: 'الشغل والطاقة', en: 'Work & Energy' },
    { id: 'power', ar: 'القدرة', en: 'Power' },
    { id: 'momentum', ar: 'الزخم والتصادم', en: 'Momentum' },
    { id: 'electricity', ar: 'الكهرباء', en: 'Electricity' },
    { id: 'magnetism', ar: 'المغناطيسية', en: 'Magnetism' },
    { id: 'waves', ar: 'الموجات', en: 'Waves' },
    { id: 'sound', ar: 'الصوت', en: 'Sound' },
    { id: 'optics', ar: 'البصريات', en: 'Optics' },
  ];

  const filtered = formulas.filter((f) => {
    if (cat !== 'all' && f.category !== cat) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      f.nameAr.toLowerCase().includes(q) ||
      f.nameEn.toLowerCase().includes(q) ||
      f.symbolsSearch.toLowerCase().includes(q) ||
      f.latex.toLowerCase().includes(q)
    );
  });

  const DirArrow = lang === 'ar' ? ArrowLeft : ArrowRight;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl glass-card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {lang === 'ar' ? 'موسوعة القوانين الفيزيائية' : 'Physics Formula Encyclopedia'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {lang === 'ar'
                ? 'ابحث باسم القانون أو برموزه الفيزيائية، مع شرح الرموز والوحدات وشروط التطبيق والأخطاء الشائعة.'
                : 'Search by law name or symbol (e.g., F, V, λ, Φ) with conditions, worked examples, and common errors.'}
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute top-3 start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === 'ar' ? 'ابحث باسم القانون أو رمزه...' : 'Search law or symbol...'}
              className="w-full ps-9 pe-3.5 py-2 rounded-xl glass-input text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                cat === c.id
                  ? 'glass-btn-primary text-white'
                  : 'glass-btn-secondary text-slate-600 dark:text-slate-300'
              }`}
            >
              {lang === 'ar' ? c.ar : c.en}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {filtered.map((f) => (
          <div
            key={f.id}
            className="rounded-2xl glass-card-interactive p-6 space-y-4"
          >
            <div>
              <BilingualTitle
                ar={f.nameAr}
                en={f.nameEn}
                studyLang={studyLang}
                as="h2"
                className="text-lg font-bold"
              />
              <LatexBlock latex={f.latex} />
            </div>

            <div className="space-y-1.5 text-xs">
              <p className="font-semibold text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'الرموز والوحدات:' : 'Symbols & Units:'}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {f.symbols.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <LatexInline latex={s.symbol} className="font-semibold text-blue-600 dark:text-cyan-400" />
                    <span dir="auto">
                      {pickStudyText(s.nameAr, s.nameEn, studyLang)} ({pickStudyText(s.unitAr, s.unitEn, studyLang)})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs space-y-2.5 pt-2.5 border-t border-slate-200/70 dark:border-white/10">
              <div className="space-y-1">
                <strong className="block text-slate-800 dark:text-slate-200">
                  {lang === 'ar' ? 'شروط الاستخدام:' : 'Validity Conditions:'}
                </strong>
                <BilingualTextBlock
                  ar={f.conditionsAr}
                  en={f.conditionsEn}
                  studyLang={studyLang}
                  rich
                  className="text-slate-600 dark:text-slate-300"
                />
              </div>
              <div className="space-y-1">
                <strong className="block text-slate-800 dark:text-slate-200">
                  {lang === 'ar' ? 'مثال محلول:' : 'Worked Example:'}
                </strong>
                <BilingualTextBlock
                  ar={f.exampleAr}
                  en={f.exampleEn}
                  studyLang={studyLang}
                  rich
                  className="text-slate-600 dark:text-slate-300"
                />
              </div>
              <div className="space-y-1">
                <strong className="block text-rose-600 dark:text-rose-400">
                  {lang === 'ar' ? 'خطأ شائع:' : 'Common Mistake:'}
                </strong>
                <BilingualTextBlock
                  ar={f.commonErrorsAr}
                  en={f.commonErrorsEn}
                  studyLang={studyLang}
                  rich
                  className="text-slate-600 dark:text-slate-300"
                />
              </div>
            </div>

            {f.linkedLessonIds.length > 0 && (
              <div className="pt-2 flex flex-wrap gap-2">
                {f.linkedLessonIds.map((lid) => (
                  <button
                    key={lid}
                    onClick={() => onOpenLesson(lid)}
                    className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <span>{lang === 'ar' ? 'فتح الدرس المرتبط' : 'Open Linked Lesson'}</span>
                    <DirArrow className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
