import React, { useState } from 'react';
import { Language, StudyLanguage } from '../types/physics';
import { RichPhysicsText } from './MathRenderer';
import { Languages } from 'lucide-react';

interface StudyLanguageSwitcherProps {
  value: StudyLanguage;
  onChange: (next: StudyLanguage) => void;
  uiLang: Language;
  compact?: boolean;
  label?: string;
}

export function StudyLanguageSwitcher({
  value,
  onChange,
  uiLang,
  compact = false,
  label,
}: StudyLanguageSwitcherProps) {
  const options: Array<{ id: StudyLanguage; ar: string; en: string; shortAr: string; shortEn: string }> = [
    { id: 'ar', ar: 'العربية', en: 'Arabic', shortAr: 'عربي', shortEn: 'AR' },
    { id: 'en', ar: 'English', en: 'English', shortAr: 'EN', shortEn: 'EN' },
    { id: 'bilingual', ar: 'اللغتان معًا', en: 'Bilingual', shortAr: 'عربي + EN', shortEn: 'AR + EN' },
  ];

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      {label && (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <Languages className="w-3.5 h-3.5 text-cyan-400" />
          <span>{label}</span>
        </span>
      )}
      <div
        className={`inline-flex items-center gap-1 rounded-xl glass-subcard ${compact ? 'p-0.5' : 'p-1'}`}
        role="group"
        aria-label={uiLang === 'ar' ? 'لغة الدراسة' : 'Study Language'}
      >
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`${compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} rounded-lg font-semibold transition-all whitespace-nowrap cursor-pointer ${
                active
                  ? 'glass-btn-primary text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/[0.06]'
              }`}
            >
              {compact
                ? uiLang === 'ar'
                  ? opt.shortAr
                  : opt.shortEn
                : uiLang === 'ar'
                  ? opt.ar
                  : opt.en}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface BilingualTextBlockProps {
  ar: string;
  en: string;
  studyLang: StudyLanguage;
  rich?: boolean;
  collapsibleTranslation?: boolean;
  className?: string;
  enClassName?: string;
}

/**
 * Renders Arabic, English, or clean dual Arabic + English blocks with proper RTL/LTR isolation.
 * KaTeX equations and physics units inside RichPhysicsText always preserve LTR.
 */
export function BilingualTextBlock({
  ar,
  en,
  studyLang,
  rich = false,
  collapsibleTranslation = false,
  className = '',
  enClassName = '',
}: BilingualTextBlockProps) {
  const [showEn, setShowEn] = useState(true);
  const cleanAr = (ar || '').trim();
  const cleanEn = (en || '').trim();

  if (studyLang === 'ar') {
    const content = cleanAr || cleanEn;
    return rich ? (
      <div dir={cleanAr ? 'rtl' : 'ltr'} className={className}>
        <RichPhysicsText text={content} />
      </div>
    ) : (
      <p dir={cleanAr ? 'rtl' : 'ltr'} className={className}>
        {content}
      </p>
    );
  }

  if (studyLang === 'en') {
    const content = cleanEn || cleanAr;
    return rich ? (
      <div dir="ltr" className={className}>
        <RichPhysicsText text={content} />
      </div>
    ) : (
      <p dir="ltr" className={className}>
        {content}
      </p>
    );
  }

  // Bilingual mode
  const sameText = !cleanEn || cleanAr === cleanEn;
  return (
    <div className="space-y-2">
      {cleanAr && (
        rich ? (
          <div dir="rtl" className={className}>
            <RichPhysicsText text={cleanAr} />
          </div>
        ) : (
          <p dir="rtl" className={className}>
            {cleanAr}
          </p>
        )
      )}

      {!sameText && cleanEn && (
        <div className="space-y-1">
          {collapsibleTranslation && (
            <button
              type="button"
              onClick={() => setShowEn((s) => !s)}
              className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
            >
              {showEn ? 'Hide English Translation · إخفاء الترجمة الإنجليزية' : 'Show English Translation · عرض الترجمة الإنجليزية'}
            </button>
          )}
          {(!collapsibleTranslation || showEn) && (
            <div
              dir="ltr"
              className={`rounded-xl glass-subcard px-3.5 py-2.5 border-s-2 !border-s-cyan-400/60 text-slate-600 dark:text-slate-300 ${enClassName}`}
            >
              {rich ? <RichPhysicsText text={cleanEn} /> : <p className="text-xs sm:text-sm leading-relaxed">{cleanEn}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface BilingualTitleProps {
  ar: string;
  en: string;
  studyLang: StudyLanguage;
  as?: 'h1' | 'h2' | 'h3' | 'span' | 'p';
  className?: string;
  subClassName?: string;
}

export function BilingualTitle({
  ar,
  en,
  studyLang,
  as: Tag = 'h3',
  className = '',
  subClassName = 'text-xs font-medium text-cyan-600 dark:text-cyan-300/90 mt-0.5',
}: BilingualTitleProps) {
  const cleanAr = (ar || '').trim();
  const cleanEn = (en || '').trim();

  if (studyLang === 'ar') {
    return (
      <Tag dir="rtl" className={className}>
        {cleanAr || cleanEn}
      </Tag>
    );
  }
  if (studyLang === 'en') {
    return (
      <Tag dir="ltr" className={className}>
        {cleanEn || cleanAr}
      </Tag>
    );
  }
  const same = !cleanEn || cleanAr === cleanEn;
  return (
    <div className="min-w-0">
      <Tag dir="rtl" className={className}>
        {cleanAr || cleanEn}
      </Tag>
      {!same && (
        <p dir="ltr" className={subClassName}>
          {cleanEn}
        </p>
      )}
    </div>
  );
}
