import { Language, StudyLanguage } from '../types/physics';

/**
 * Resolves the effective study language mode for content rendering.
 */
export function resolveStudyLanguage(
  studyLang: StudyLanguage | undefined,
  uiLang: Language,
  track?: string
): StudyLanguage {
  if (studyLang === 'ar' || studyLang === 'en' || studyLang === 'bilingual') {
    return studyLang;
  }
  if (track === 'american') return 'bilingual';
  return uiLang;
}

/**
 * Picks a concise inline string based on the active StudyLanguage.
 * Avoids noisy repetition when Arabic and English strings are identical.
 */
export function pickStudyText(
  ar: string | undefined,
  en: string | undefined,
  studyLang: StudyLanguage
): string {
  const cleanAr = (ar || '').trim();
  const cleanEn = (en || '').trim();
  if (!cleanAr && !cleanEn) return '';
  if (studyLang === 'ar') return cleanAr || cleanEn;
  if (studyLang === 'en') return cleanEn || cleanAr;
  if (!cleanAr) return cleanEn;
  if (!cleanEn || cleanAr === cleanEn) return cleanAr;
  return `${cleanAr} — ${cleanEn}`;
}

/**
 * Merges two option arrays cleanly when displaying Bilingual MCQs/TF choices.
 */
export function mergeBilingualOptions(
  optsAr: string[] | undefined,
  optsEn: string[] | undefined,
  studyLang: StudyLanguage
): Array<{ ar: string; en: string; single: string }> {
  const arList = optsAr || [];
  const enList = optsEn || [];
  const len = Math.max(arList.length, enList.length);
  const result: Array<{ ar: string; en: string; single: string }> = [];
  for (let i = 0; i < len; i++) {
    const ar = (arList[i] || enList[i] || '').trim();
    const en = (enList[i] || arList[i] || '').trim();
    const single = studyLang === 'en' ? en : ar;
    result.push({ ar, en, single });
  }
  return result;
}
