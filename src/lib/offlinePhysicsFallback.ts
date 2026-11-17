import type { FormulaItem, Lesson, StudyLanguage } from '../types/physics';
import { pickStudyText } from './bilingual';

export interface OfflineStudyMatch {
  kind: 'lesson' | 'law' | 'formula' | 'example';
  lessonId?: string;
  title: string;
  snippet: string;
  latex?: string;
}

export function searchOfflinePhysicsKnowledge(params: {
  query: string;
  lessons: Lesson[];
  formulas: FormulaItem[];
  studyLang: StudyLanguage;
  limit?: number;
}): OfflineStudyMatch[] {
  const raw = params.query.trim().toLowerCase();
  const terms = raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_+-]/gu, ''))
    .filter((t) => t.length >= 2);

  if (terms.length === 0) return [];

  const matches: Array<{ score: number; item: OfflineStudyMatch }> = [];

  for (const f of params.formulas) {
    const haystack = `${f.nameAr} ${f.nameEn} ${f.symbolsSearch} ${f.conditionsAr} ${f.conditionsEn} ${f.latex}`.toLowerCase();
    const score = terms.reduce((acc, term) => (haystack.includes(term) ? acc + 2 : acc), 0);
    if (score > 0) {
      matches.push({
        score,
        item: {
          kind: 'formula',
          lessonId: f.linkedLessonIds[0],
          title: pickStudyText(f.nameAr, f.nameEn, params.studyLang),
          snippet: pickStudyText(f.conditionsAr, f.conditionsEn, params.studyLang),
          latex: f.latex,
        },
      });
    }
  }

  for (const lesson of params.lessons) {
    const baseHay = `${lesson.titleAr} ${lesson.titleEn} ${lesson.introAr} ${lesson.introEn}`.toLowerCase();
    let score = terms.reduce((acc, term) => (baseHay.includes(term) ? acc + 2 : acc), 0);

    for (const law of lesson.lawsLatex) {
      const lawHay = `${law.nameAr} ${law.nameEn} ${law.noteAr} ${law.noteEn}`.toLowerCase();
      const s = terms.reduce((acc, term) => (lawHay.includes(term) ? acc + 2 : acc), 0);
      if (s > 0) {
        matches.push({
          score: s + 1,
          item: {
            kind: 'law',
            lessonId: lesson.id,
            title: `${pickStudyText(law.nameAr, law.nameEn, params.studyLang)} (${pickStudyText(lesson.titleAr, lesson.titleEn, params.studyLang)})`,
            snippet: pickStudyText(law.noteAr, law.noteEn, params.studyLang),
            latex: law.latex,
          },
        });
      }
    }

    for (const ex of lesson.solvedExamples) {
      const exHay = `${ex.titleAr} ${ex.titleEn} ${ex.problemAr} ${ex.problemEn}`.toLowerCase();
      const s = terms.reduce((acc, term) => (exHay.includes(term) ? acc + 2 : acc), 0);
      if (s > 0) {
        matches.push({
          score: s,
          item: {
            kind: 'example',
            lessonId: lesson.id,
            title: pickStudyText(ex.titleAr, ex.titleEn, params.studyLang),
            snippet: `${pickStudyText(ex.problemAr, ex.problemEn, params.studyLang)} — ${ex.finalAnswer}`,
            latex: ex.formulaLatex,
          },
        });
      }
    }

    if (score > 0) {
      matches.push({
        score,
        item: {
          kind: 'lesson',
          lessonId: lesson.id,
          title: pickStudyText(lesson.titleAr, lesson.titleEn, params.studyLang),
          snippet: pickStudyText(lesson.introAr, lesson.introEn, params.studyLang),
        },
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, params.limit || 4).map((m) => m.item);
}
