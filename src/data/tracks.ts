import { TrackId } from '../types/physics';

export interface TrackDefinition {
  id: TrackId;
  nameAr: string;
  nameEn: string;
  subtitleAr: string;
  subtitleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  image: string;
  grades: Array<{
    id: string;
    labelAr: string;
    labelEn: string;
  }>;
}

export const EDUCATIONAL_TRACKS: TrackDefinition[] = [
  {
    id: 'thanawiya',
    nameAr: 'الثانوية العامة المصرية',
    nameEn: 'Egyptian Thanawiya Amma',
    subtitleAr: 'المسار العلمي للفيزياء',
    subtitleEn: 'National Science Physics Track',
    descriptionAr:
      'تنظيم متكامل حسب الصف الدراسي والمنهج المعتمد، مع تدريبات وأنماط امتحانات تحاكي النظام المصري وقابلية استيراد الكتب الرسمية.',
    descriptionEn:
      'Structured by national grade levels, chapters, and units with Egyptian exam-style questions and official textbook import support.',
    image: '/src/assets/images/track_mechanics_lab_1794579388169.jpg',
    grades: [
      { id: 'grade10', labelAr: 'الصف الأول الثانوي', labelEn: 'Grade 10 (1st Secondary)' },
      { id: 'grade11', labelAr: 'الصف الثاني الثانوي', labelEn: 'Grade 11 (2nd Secondary)' },
      { id: 'grade12', labelAr: 'الصف الثالث الثانوي', labelEn: 'Grade 12 (3rd Secondary)' },
    ],
  },
  {
    id: 'baccalaureate',
    nameAr: 'البكالوريا المصرية',
    nameEn: 'Egyptian Baccalaureate',
    subtitleAr: 'مسار الفيزياء المتقدمة والتطبيقية',
    subtitleEn: 'Baccalaureate Physics & Engineering Track',
    descriptionAr:
      'فصل كامل حسب المسارات والمقررات، شروحات مفاهيمية معمّقة، مسائل تطبيقية متنوعة، واختبارات لكل وحدة وموضوع.',
    descriptionEn:
      'Separated by Baccalaureate tracks and courses with deep conceptual explanations, applied numerical problems, and unit assessments.',
    image: '/src/assets/images/track_waves_optics_lab_1794579389296.jpg',
    grades: [
      { id: 'bac_year1', labelAr: 'السنة الأولى - المسار العام', labelEn: 'Year 1 - Foundation Physics' },
      { id: 'bac_year2_eng', labelAr: 'السنة الثانية - مسار الهندسة والعلوم', labelEn: 'Year 2 - Engineering & Physical Sciences' },
      { id: 'bac_year3_adv', labelAr: 'السنة الثالثة - الفيزياء المتقدمة', labelEn: 'Year 3 - Advanced Baccalaureate Physics' },
    ],
  },
  {
    id: 'american',
    nameAr: 'American Diploma',
    nameEn: 'American Diploma Physics',
    subtitleAr: 'AP & High School Physics Courses',
    subtitleEn: 'High School, Honors & AP Physics',
    descriptionAr:
      'دعم كامل للمصطلحات العلمية باللغة الإنجليزية والعربية، قوانين الفيزياء، ومسائل حسابية وتطبيقية وفق المقررات الأمريكية.',
    descriptionEn:
      'Full English & bilingual scientific terminology, calculus/algebra-based physics laws, AP-style problems, and inquiry labs.',
    image: '/src/assets/images/track_electromagnetism_lab_1794579389569.jpg',
    grades: [
      { id: 'am_hs', labelAr: 'High School Physics (Grade 10-11)', labelEn: 'High School Physics (Grade 10-11)' },
      { id: 'am_ap1', labelAr: 'AP Physics 1 (Algebra-Based)', labelEn: 'AP Physics 1 (Algebra-Based)' },
      { id: 'am_ap2', labelAr: 'AP Physics 2 / Electromagnetism', labelEn: 'AP Physics 2 / Electromagnetism' },
    ],
  },
];

export function getTrackById(trackId: string) {
  return EDUCATIONAL_TRACKS.find((t) => t.id === trackId);
}

export function getGradeLabel(trackId: string, gradeId: string, lang: 'ar' | 'en') {
  const track = getTrackById(trackId);
  const grade = track?.grades.find((g) => g.id === gradeId);
  if (!grade) return gradeId;
  return lang === 'ar' ? grade.labelAr : grade.labelEn;
}
