import { TrackId } from '../types/physics';
import mechanicsLabImg from '../assets/images/track_mechanics_lab_1794579388169.jpg';
import wavesOpticsLabImg from '../assets/images/track_waves_optics_lab_1794579389296.jpg';
import electromagnetismLabImg from '../assets/images/track_electromagnetism_lab_1794579389569.jpg';

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
    image: mechanicsLabImg,
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
    image: wavesOpticsLabImg,
    grades: [
      { id: 'bac_year1', labelAr: 'السنة الأولى - المسار العام', labelEn: 'Year 1 - Foundation Physics' },
      { id: 'bac_year2', labelAr: 'السنة الثانية - مسار طب وعلوم الحياة', labelEn: 'Year 2 - Life Sciences Track' },
      { id: 'bac_year3_adv', labelAr: 'السنة الثالثة - الفيزياء المتقدمة', labelEn: 'Year 3 - Advanced Baccalaureate Physics' },
    ],
  },
  {
    id: 'american',
    nameAr: 'الدبلومة الأمريكية (American Diploma)',
    nameEn: 'American Diploma Physics',
    subtitleAr: 'مقررات المرحلة الثانوية و AP Physics — نظام ثنائي اللغة (عربي / English)',
    subtitleEn: 'High School, Honors & AP Physics — Full Bilingual Support (AR / EN)',
    descriptionAr:
      'نظام تعليمي ثنائي اللغة بالكامل: شروحات عربية وإنجليزية، مصطلحات علمية متقابلة، قوانين الفيزياء، ومسائل وبنك أسئلة واختبارات بكل من العربية والإنجليزية أو معًا.',
    descriptionEn:
      'Complete bilingual system: Arabic & English explanations, paired scientific terminology, physics laws, AP-style problems, question bank, and exams in Arabic, English, or Bilingual mode.',
    image: electromagnetismLabImg,
    grades: [
      { id: 'am_hs', labelAr: 'فيزياء المرحلة الثانوية الأمريكية (الصف 10-11) · High School Physics', labelEn: 'High School Physics (Grade 10-11)' },
      { id: 'am_ap1', labelAr: 'فيزياء AP 1 (القائمة على الجبر) · AP Physics 1', labelEn: 'AP Physics 1 (Algebra-Based)' },
      { id: 'am_ap2', labelAr: 'فيزياء AP 2 والكهرومغناطيسية · AP Physics 2', labelEn: 'AP Physics 2 / Electromagnetism' },
    ],
  },
];

export function getTrackById(trackId: string) {
  return EDUCATIONAL_TRACKS.find((t) => t.id === trackId);
}

export function getTrackLabel(trackId: string, lang: 'ar' | 'en' | 'bilingual') {
  const track = getTrackById(trackId);
  if (!track) return trackId;
  if (lang === 'bilingual') {
    return track.id === 'american' ? track.nameAr : `${track.nameAr} · ${track.nameEn}`;
  }
  return lang === 'ar' ? track.nameAr : track.nameEn;
}

export function getGradeLabel(trackId: string, gradeId: string, lang: 'ar' | 'en' | 'bilingual') {
  const track = getTrackById(trackId);
  const grade = track?.grades.find((g) => g.id === gradeId);
  if (!grade) return gradeId;
  if (lang === 'bilingual') {
    return grade.labelAr.includes(grade.labelEn) ? grade.labelAr : `${grade.labelAr} · ${grade.labelEn}`;
  }
  return lang === 'ar' ? grade.labelAr : grade.labelEn;
}
