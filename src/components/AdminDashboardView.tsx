import React, { useState } from 'react';
import {
  ExamBlueprint,
  LabExperimentConfig,
  Language,
  Lesson,
  QuestionItem,
  StudyLanguage,
  TrackId,
  UserProfile,
} from '../types/physics';
import { EDUCATIONAL_TRACKS, getGradeLabel, getTrackLabel } from '../data/tracks';
import { pickStudyText } from '../lib/bilingual';
import { BilingualTextBlock, BilingualTitle } from './BilingualBlock';
import { OfflineDiagnosticsPanel } from './OfflineDiagnosticsPanel';
import { Plus, Trash2, Upload, Shield, CheckCircle2 } from 'lucide-react';

interface AdminDashboardViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  profile: UserProfile;
  lessons: Lesson[];
  questions: QuestionItem[];
  exams: ExamBlueprint[];
  labs: LabExperimentConfig[];
  students: UserProfile[];
  announcements: Array<{ id: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }>;
  onSaveLesson: (lesson: Lesson) => Promise<void>;
  onDeleteLesson: (id: string) => Promise<void>;
  onSaveQuestion: (q: QuestionItem) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  onSaveExam: (exam: ExamBlueprint) => Promise<void>;
  onDeleteExam: (id: string) => Promise<void>;
  onSaveLab: (lab: LabExperimentConfig) => Promise<void>;
  onSaveAnnouncement: (ann: { id: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }) => Promise<void>;
}

export function AdminDashboardView({
  lang,
  studyLang,
  profile,
  lessons,
  questions,
  exams,
  labs,
  students,
  announcements,
  onSaveLesson,
  onDeleteLesson,
  onSaveQuestion,
  onDeleteQuestion,
  onSaveExam,
  onDeleteExam,
  onSaveLab,
  onSaveAnnouncement,
}: AdminDashboardViewProps) {
  const [tab, setTab] = useState<'curricula' | 'questions' | 'exams' | 'labs' | 'students' | 'settings'>('curricula');
  const [statusMsg, setStatusMsg] = useState('');

  // Lesson Creator / Importer State
  const [lTrack, setLTrack] = useState<TrackId>('thanawiya');
  const [lGrade, setLGrade] = useState('grade12');
  const [lTitleAr, setLTitleAr] = useState('');
  const [lTitleEn, setLTitleEn] = useState('');
  const [lUnitAr, setLUnitAr] = useState('');
  const [lUnitEn, setLUnitEn] = useState('');
  const [lIntroAr, setLIntroAr] = useState('');
  const [lIntroEn, setLIntroEn] = useState('');
  const [lExplainAr, setLExplainAr] = useState('');
  const [lExplainEn, setLExplainEn] = useState('');
  const [lPdfUrl, setLPdfUrl] = useState('');
  const [lVideoUrl, setLVideoUrl] = useState('');
  const [importJsonText, setImportJsonText] = useState('');

  // Question Creator State
  const [qTrack, setQTrack] = useState<TrackId>('thanawiya');
  const [qGrade, setQGrade] = useState('grade12');
  const [qTextAr, setQTextAr] = useState('');
  const [qTextEn, setQTextEn] = useState('');
  const [qType, setQType] = useState<'mcq' | 'numerical'>('mcq');
  const [qDiff, setQDiff] = useState<'easy' | 'medium' | 'hard' | 'advanced'>('medium');
  const [qOptions, setQOptions] = useState('خيار أ | خيار ب | خيار ج | خيار د');
  const [qOptionsEn, setQOptionsEn] = useState('Option A | Option B | Option C | Option D');
  const [qAnswer, setQAnswer] = useState('0');
  const [qExplain, setQExplain] = useState('');
  const [qExplainEn, setQExplainEn] = useState('');

  // Exam Creator State
  const [eTrack, setETrack] = useState<TrackId>('thanawiya');
  const [eGrade, setEGrade] = useState('grade12');
  const [eTitleAr, setETitleAr] = useState('');
  const [eTitleEn, setETitleEn] = useState('');
  const [eDuration, setEDuration] = useState(20);

  // Announcement State
  const [annTitleAr, setAnnTitleAr] = useState('');
  const [annTitleEn, setAnnTitleEn] = useState('');
  const [annBodyAr, setAnnBodyAr] = useState('');
  const [annBodyEn, setAnnBodyEn] = useState('');

  if (profile.role !== 'admin') {
    return (
      <div className="glass-card rounded-2xl border-rose-500/30 p-8 text-center flex flex-col items-center gap-3">
        <span className="glass-icon glass-icon-rose w-11 h-11">
          <Shield className="w-5 h-5" />
        </span>
        <p className="font-bold text-rose-500">
          {lang === 'ar' ? 'غير مصرح بالدخول: صلاحيات الإدارة مطلوبة.' : 'Access Denied: Admin Role Required.'}
        </p>
      </div>
    );
  }

  const notify = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 4000);
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    const newLesson: Lesson = {
      id: `lesson-${Date.now()}`,
      track: lTrack,
      grade: lGrade,
      termAr: 'الفصل الدراسي',
      termEn: 'Term',
      unitId: `unit-${Date.now()}`,
      unitTitleAr: lUnitAr || 'وحدة مضافة',
      unitTitleEn: lUnitEn || 'Custom Unit',
      order: lessons.length + 1,
      sourceType: 'imported_official',
      sourceLabelAr: 'محتوى معتمد مضاف عبر لوحة الإدارة',
      sourceLabelEn: 'Official / Admin-Imported Lesson',
      titleAr: lTitleAr,
      titleEn: lTitleEn || lTitleAr,
      estimatedMinutes: 35,
      introAr: lIntroAr,
      introEn: lIntroEn || lIntroAr,
      objectivesAr: ['فهم المفاهيم الفيزيائية الأساسية للدرس وتطبيق قوانينه.'],
      objectivesEn: ['Master core concepts and apply governing equations accurately.'],
      parts: [
        {
          id: 'part-1',
          titleAr: 'الشرح العلمي التفصيلي',
          titleEn: 'Detailed Scientific Explanation',
          explanationAr: lExplainAr,
          explanationEn: lExplainEn || lExplainAr,
        },
      ],
      conceptsAr: [],
      conceptsEn: [],
      terms: [],
      lawsLatex: [],
      symbolsTable: [],
      everydayExamplesAr: [],
      everydayExamplesEn: [],
      solvedExamples: [],
      gradedProblems: [],
      commonMistakesAr: [],
      commonMistakesEn: [],
      practicalAppsAr: [],
      practicalAppsEn: [],
      summaryAr: [],
      summaryEn: [],
      finalQuizQuestionIds: [],
      resourceUrls: {
        pdf: lPdfUrl || undefined,
        video: lVideoUrl || undefined,
      },
    };
    await onSaveLesson(newLesson);
    setLTitleAr('');
    setLTitleEn('');
    setLUnitAr('');
    setLUnitEn('');
    setLIntroAr('');
    setLIntroEn('');
    setLExplainAr('');
    setLExplainEn('');
    setLPdfUrl('');
    setLVideoUrl('');
    notify(lang === 'ar' ? 'تم حفظ ونشر الدرس في Firestore بنجاح.' : 'Lesson saved to Firestore.');
  };

  const handleBulkImportJson = async () => {
    try {
      const parsed = JSON.parse(importJsonText);
      const list: Lesson[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item.id && item.track && item.grade) {
          await onSaveLesson(item);
        }
      }
      setImportJsonText('');
      notify(lang === 'ar' ? `تم استيراد ${list.length} درس بنجاح.` : `Imported ${list.length} lesson(s) successfully.`);
    } catch {
      notify(lang === 'ar' ? 'صيغة JSON غير صالحة.' : 'Invalid JSON payload.');
    }
  };

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const optsAr = qOptions.split('|').map((s) => s.trim()).filter(Boolean);
    const optsEnParsed = qOptionsEn.split('|').map((s) => s.trim()).filter(Boolean);
    const optsEn = optsEnParsed.length === optsAr.length ? optsEnParsed : optsAr;
    const newQ: QuestionItem = {
      id: `q-${Date.now()}`,
      track: qTrack,
      grade: qGrade,
      termAr: 'الفصل',
      termEn: 'Term',
      unitId: 'unit-admin',
      lessonId: lessons.find((l) => l.track === qTrack && l.grade === qGrade)?.id || 'general',
      type: qType,
      difficulty: qDiff,
      textAr: qTextAr,
      textEn: qTextEn || qTextAr,
      optionsAr: qType === 'mcq' ? optsAr : undefined,
      optionsEn: qType === 'mcq' ? optsEn : undefined,
      correctAnswer: qAnswer,
      numericValue: qType === 'numerical' ? parseFloat(qAnswer) : undefined,
      explanationAr: qExplain,
      explanationEn: qExplainEn || qExplain,
      skillAr: 'تحليل فيزيائي',
      skillEn: 'Physics Analysis',
      sourceAr: 'إدارة Physics Smart',
      sourceEn: 'Physics Smart Admin',
    };
    await onSaveQuestion(newQ);
    setQTextAr('');
    setQTextEn('');
    setQExplain('');
    setQExplainEn('');
    notify(lang === 'ar' ? 'تمت إضافة السؤال إلى البنك.' : 'Question added to bank.');
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const matchingQs = questions.filter((q) => q.track === eTrack && q.grade === eGrade).map((q) => q.id);
    await onSaveExam({
      id: `exam-${Date.now()}`,
      track: eTrack,
      grade: eGrade,
      examType: 'comprehensive',
      titleAr: eTitleAr,
      titleEn: eTitleEn || eTitleAr,
      durationMinutes: eDuration,
      difficulty: 'mixed',
      questionIds: matchingQs,
      passingScore: 50,
    });
    setETitleAr('');
    setETitleEn('');
    notify(lang === 'ar' ? 'تم إنشاء الامتحان بنجاح.' : 'Exam created.');
  };

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveAnnouncement({
      id: `ann-${Date.now()}`,
      titleAr: annTitleAr,
      titleEn: annTitleEn || annTitleAr,
      bodyAr: annBodyAr,
      bodyEn: annBodyEn || annBodyAr,
    });
    setAnnTitleAr('');
    setAnnTitleEn('');
    setAnnBodyAr('');
    setAnnBodyEn('');
    notify(lang === 'ar' ? 'تم نشر الإشعار للطلاب.' : 'Announcement published.');
  };

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="glass-icon glass-icon-blue w-10 h-10 shrink-0">
              <Shield className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold">{lang === 'ar' ? 'لوحة تحكم الإدارة' : 'Admin Control Dashboard'}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'ar'
                  ? 'إدارة المناهج والكتب المستوردة، بنك الأسئلة، الامتحانات، المعمل الافتراضي، والطلاب.'
                  : 'Manage curricula & textbook imports, question bank, exams, virtual labs, students, and platform settings.'}
              </p>
            </div>
          </div>

          {statusMsg && (
            <div className="glass-subcard rounded-xl px-3.5 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>{statusMsg}</span>
            </div>
          )}
        </div>

        <div className="glass-subcard flex flex-wrap gap-1.5 p-1.5 rounded-xl w-fit">
          {[
            { id: 'curricula', ar: 'المناهج والكتب', en: 'Curricula & Import' },
            { id: 'questions', ar: 'بنك الأسئلة', en: 'Questions' },
            { id: 'exams', ar: 'الامتحانات', en: 'Exams' },
            { id: 'labs', ar: 'المعمل الافتراضي', en: 'Virtual Labs' },
            { id: 'students', ar: 'الطلاب والإحصائيات', en: 'Students' },
            { id: 'settings', ar: 'الإشعارات والإعدادات', en: 'Settings & Alerts' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                tab === t.id
                  ? 'glass-btn-primary'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white/40 dark:hover:bg-white/5'
              }`}
            >
              {lang === 'ar' ? t.ar : t.en}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: CURRICULA & IMPORT */}
      {tab === 'curricula' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateLesson} className="lg:col-span-7 glass-card rounded-2xl p-6 space-y-3">
            <h2 className="text-base font-bold">{lang === 'ar' ? 'إضافة درس جديد أو كتاب معتمد' : 'Add Lesson / Textbook Module'}</h2>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={lTrack}
                onChange={(e) => {
                  const t = e.target.value as TrackId;
                  setLTrack(t);
                  setLGrade(EDUCATIONAL_TRACKS.find((x) => x.id === t)?.grades[0].id || '');
                }}
                className="glass-input px-3 py-2 rounded-xl text-xs"
              >
                {EDUCATIONAL_TRACKS.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {lang === 'ar' ? tr.nameAr : tr.nameEn}
                  </option>
                ))}
              </select>
              <select
                value={lGrade}
                onChange={(e) => setLGrade(e.target.value)}
                className="glass-input px-3 py-2 rounded-xl text-xs"
              >
                {(EDUCATIONAL_TRACKS.find((x) => x.id === lTrack)?.grades || []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {lang === 'ar' ? g.labelAr : g.labelEn}
                  </option>
                ))}
              </select>
              <input required placeholder="عنوان الدرس (عربي)" value={lTitleAr} onChange={(e) => setLTitleAr(e.target.value)} className="glass-input px-3 py-2 rounded-xl text-xs" />
              <input placeholder="Lesson Title (English)" value={lTitleEn} onChange={(e) => setLTitleEn(e.target.value)} className="glass-input px-3 py-2 rounded-xl text-xs" />
              <input placeholder="اسم الوحدة (عربي)" value={lUnitAr} onChange={(e) => setLUnitAr(e.target.value)} className="glass-input px-3 py-2 rounded-xl text-xs" />
              <input placeholder="Unit Name (English)" value={lUnitEn} onChange={(e) => setLUnitEn(e.target.value)} className="glass-input px-3 py-2 rounded-xl text-xs" />
              <input placeholder="رابط PDF المرجع (اختياري)" value={lPdfUrl} onChange={(e) => setLPdfUrl(e.target.value)} className="glass-input px-3 py-2 rounded-xl text-xs" />
              <input placeholder="رابط فيديو الشرح (اختياري)" value={lVideoUrl} onChange={(e) => setLVideoUrl(e.target.value)} className="glass-input px-3 py-2 rounded-xl text-xs" />
            </div>
            <textarea required rows={2} placeholder="مقدمة الدرس (عربي)..." value={lIntroAr} onChange={(e) => setLIntroAr(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
            <textarea rows={2} dir="ltr" placeholder="Lesson Introduction (English)..." value={lIntroEn} onChange={(e) => setLIntroEn(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
            <textarea required rows={3} placeholder="الشرح العلمي التفصيلي عربي (يدعم LaTeX مثل $F = ma$)..." value={lExplainAr} onChange={(e) => setLExplainAr(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
            <textarea rows={3} dir="ltr" placeholder="Detailed Scientific Explanation (English, supports LaTeX e.g. $F = ma$)..." value={lExplainEn} onChange={(e) => setLExplainEn(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
            <button type="submit" className="glass-btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <Plus className="w-4 h-4" />
              {lang === 'ar' ? 'نشر الدرس' : 'Publish Lesson'}
            </button>
          </form>

          <div className="lg:col-span-5 space-y-4">
            <div className="glass-card rounded-2xl p-6 space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-2.5">
                <span className="glass-icon glass-icon-cyan w-7 h-7">
                  <Upload className="w-3.5 h-3.5" />
                </span>
                {lang === 'ar' ? 'استيراد منهج معتمد (JSON)' : 'Bulk Import Official Curriculum (JSON)'}
              </h3>
              <textarea
                rows={4}
                dir="ltr"
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder='[{"id": "custom-1", "track": "thanawiya", "grade": "grade12", "titleAr": "...", "titleEn": "...", ...}]'
                className="glass-input w-full p-3 rounded-xl text-xs font-mono-num"
              />
              <button onClick={handleBulkImportJson} className="glass-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer">
                {lang === 'ar' ? 'استيراد إلى قاعدة البيانات' : 'Import JSON to Firestore'}
              </button>
            </div>

            <div className="glass-card rounded-2xl p-6 space-y-2.5 max-h-72 overflow-y-auto">
              <h3 className="text-sm font-bold">{lang === 'ar' ? `الدروس الحالية (${lessons.length})` : `Active Lessons (${lessons.length})`}</h3>
              {lessons.map((l) => (
                <div key={l.id} className="glass-subcard rounded-lg px-3 py-2 flex items-center justify-between text-xs gap-2">
                  <span dir="auto" className="truncate">
                    {pickStudyText(l.titleAr, l.titleEn, studyLang)} ({getTrackLabel(l.track, studyLang)})
                  </span>
                  <button onClick={() => onDeleteLesson(l.id)} className="text-slate-400 hover:text-rose-500 transition-colors shrink-0 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: QUESTIONS */}
      {tab === 'questions' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateQuestion} className="lg:col-span-6 glass-card rounded-2xl p-6 space-y-3">
            <h2 className="text-base font-bold">{lang === 'ar' ? 'إضافة سؤال لبنك الأسئلة' : 'Add Question to Bank'}</h2>
            <div className="grid grid-cols-2 gap-3">
              <select value={qTrack} onChange={(e) => { const t = e.target.value as TrackId; setQTrack(t); setQGrade(EDUCATIONAL_TRACKS.find((x) => x.id === t)?.grades[0].id || ''); }} className="glass-input px-3 py-2 rounded-xl text-xs">
                {EDUCATIONAL_TRACKS.map((tr) => <option key={tr.id} value={tr.id}>{lang === 'ar' ? tr.nameAr : tr.nameEn}</option>)}
              </select>
              <select value={qGrade} onChange={(e) => setQGrade(e.target.value)} className="glass-input px-3 py-2 rounded-xl text-xs">
                {(EDUCATIONAL_TRACKS.find((x) => x.id === qTrack)?.grades || []).map((g) => <option key={g.id} value={g.id}>{lang === 'ar' ? g.labelAr : g.labelEn}</option>)}
              </select>
              <select value={qType} onChange={(e) => setQType(e.target.value as any)} className="glass-input px-3 py-2 rounded-xl text-xs">
                <option value="mcq">MCQ</option>
                <option value="numerical">Numerical</option>
              </select>
              <select value={qDiff} onChange={(e) => setQDiff(e.target.value as any)} className="glass-input px-3 py-2 rounded-xl text-xs">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <textarea required rows={2} placeholder="نص السؤال (عربي)" value={qTextAr} onChange={(e) => setQTextAr(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
            <textarea rows={2} dir="ltr" placeholder="Question Text (English)" value={qTextEn} onChange={(e) => setQTextEn(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
            {qType === 'mcq' && (
              <>
                <input value={qOptions} onChange={(e) => setQOptions(e.target.value)} placeholder="الخيارات بالعربية مفصولة بـ |" className="glass-input w-full px-3 py-2 rounded-xl text-xs" />
                <input dir="ltr" value={qOptionsEn} onChange={(e) => setQOptionsEn(e.target.value)} placeholder="English Options separated by |" className="glass-input w-full px-3 py-2 rounded-xl text-xs" />
              </>
            )}
            <input value={qAnswer} onChange={(e) => setQAnswer(e.target.value)} placeholder={qType === 'mcq' ? 'Correct index (0-3)' : 'Numeric answer'} className="glass-input w-full px-3 py-2 rounded-xl text-xs" />
            <textarea required rows={2} placeholder="شرح الإجابة الصحيحة (عربي)" value={qExplain} onChange={(e) => setQExplain(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
            <textarea rows={2} dir="ltr" placeholder="Explanation (English)" value={qExplainEn} onChange={(e) => setQExplainEn(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
            <button type="submit" className="glass-btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer">
              {lang === 'ar' ? 'إضافة السؤال' : 'Save Question'}
            </button>
          </form>

          <div className="lg:col-span-6 glass-card rounded-2xl p-6 space-y-2.5 max-h-[540px] overflow-y-auto">
            <h3 className="text-sm font-bold">{lang === 'ar' ? `الأسئلة المسجلة (${questions.length})` : `Question Bank (${questions.length})`}</h3>
            {questions.map((q) => (
              <div key={q.id} className="glass-subcard rounded-lg px-3 py-2 flex items-center justify-between text-xs gap-2">
                <span dir="auto" className="truncate">{pickStudyText(q.textAr, q.textEn, studyLang)}</span>
                <button onClick={() => onDeleteQuestion(q.id)} className="text-slate-400 hover:text-rose-500 transition-colors shrink-0 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: EXAMS */}
      {tab === 'exams' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateExam} className="lg:col-span-5 glass-card rounded-2xl p-6 space-y-3">
            <h2 className="text-base font-bold">{lang === 'ar' ? 'إنشاء امتحان رسمي جديد' : 'Create Official Exam'}</h2>
            <select value={eTrack} onChange={(e) => { const t = e.target.value as TrackId; setETrack(t); setEGrade(EDUCATIONAL_TRACKS.find((x) => x.id === t)?.grades[0].id || ''); }} className="glass-input w-full px-3 py-2 rounded-xl text-xs">
              {EDUCATIONAL_TRACKS.map((tr) => <option key={tr.id} value={tr.id}>{lang === 'ar' ? tr.nameAr : tr.nameEn}</option>)}
            </select>
            <select value={eGrade} onChange={(e) => setEGrade(e.target.value)} className="glass-input w-full px-3 py-2 rounded-xl text-xs">
              {(EDUCATIONAL_TRACKS.find((x) => x.id === eTrack)?.grades || []).map((g) => <option key={g.id} value={g.id}>{lang === 'ar' ? g.labelAr : g.labelEn}</option>)}
            </select>
            <input required placeholder="عنوان الامتحان (عربي)" value={eTitleAr} onChange={(e) => setETitleAr(e.target.value)} className="glass-input w-full px-3 py-2 rounded-xl text-xs" />
            <input placeholder="Exam Title (English)" value={eTitleEn} onChange={(e) => setETitleEn(e.target.value)} className="glass-input w-full px-3 py-2 rounded-xl text-xs" />
            <input type="number" min={5} max={180} value={eDuration} onChange={(e) => setEDuration(+e.target.value)} className="glass-input w-full px-3 py-2 rounded-xl text-xs font-mono-num" />
            <button type="submit" className="glass-btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer">
              {lang === 'ar' ? 'حفظ الامتحان' : 'Publish Exam'}
            </button>
          </form>

          <div className="lg:col-span-7 glass-card rounded-2xl p-6 space-y-2.5">
            <h3 className="text-sm font-bold">{lang === 'ar' ? `الامتحانات المنشورة (${exams.length})` : `Published Exams (${exams.length})`}</h3>
            {exams.map((ex) => (
              <div key={ex.id} className="glass-subcard rounded-lg px-3 py-2 flex items-center justify-between text-xs gap-2">
                <span dir="auto" className="truncate">
                  {pickStudyText(ex.titleAr, ex.titleEn, studyLang)} ({getTrackLabel(ex.track, studyLang)} · {ex.durationMinutes}m)
                </span>
                <button onClick={() => onDeleteExam(ex.id)} className="text-slate-400 hover:text-rose-500 transition-colors shrink-0 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: LABS */}
      {tab === 'labs' && (
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-bold">{lang === 'ar' ? 'إدارة وصف وتعليمات المعمل الافتراضي' : 'Manage Virtual Lab Instructions'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {labs.map((lab) => (
              <div key={lab.id} className="glass-subcard p-4 rounded-xl space-y-2">
                <BilingualTitle
                  ar={lab.titleAr}
                  en={lab.titleEn}
                  studyLang={studyLang}
                  as="p"
                  className="text-sm font-bold"
                />
                <textarea
                  rows={2}
                  defaultValue={lang === 'ar' ? lab.descriptionAr : lab.descriptionEn}
                  onBlur={(e) => {
                    const val = e.target.value;
                    onSaveLab(lang === 'ar' ? { ...lab, descriptionAr: val } : { ...lab, descriptionEn: val });
                    notify(lang === 'ar' ? 'تم تحديث وصف التجربة.' : 'Lab description updated.');
                  }}
                  className="glass-input w-full p-2.5 rounded-lg text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: STUDENTS */}
      {tab === 'students' && (
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-bold">{lang === 'ar' ? `حسابات الطلاب المسجلة (${students.length})` : `Registered Students (${students.length})`}</h2>
          <div className="overflow-x-auto glass-subcard rounded-xl p-2">
            <table className="w-full text-xs text-start">
              <thead>
                <tr className="border-b border-slate-200/60 dark:border-slate-700/60 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-3 text-start">{lang === 'ar' ? 'الاسم' : 'Name'}</th>
                  <th className="py-2.5 px-3 text-start">{lang === 'ar' ? 'البريد' : 'Email'}</th>
                  <th className="py-2.5 px-3 text-start">{lang === 'ar' ? 'النظام والصف' : 'Track & Grade'}</th>
                  <th className="py-2.5 px-3 text-start">{lang === 'ar' ? 'النقاط' : 'Points'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/40 dark:divide-slate-800/60">
                {students.map((s) => (
                  <tr key={s.uid}>
                    <td className="py-2.5 px-3 font-medium">{s.displayName}</td>
                    <td className="py-2.5 px-3 font-mono-num">{s.email}</td>
                    <td className="py-2.5 px-3">
                      {getTrackLabel(s.track, studyLang)} / {getGradeLabel(s.track, s.grade, studyLang)}
                    </td>
                    <td className="py-2.5 px-3 font-mono-num">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 6: SETTINGS & ANNOUNCEMENTS */}
      {tab === 'settings' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form onSubmit={handlePostAnnouncement} className="glass-card rounded-2xl p-6 space-y-3">
              <h2 className="text-base font-bold">{lang === 'ar' ? 'إرسال إشعار للطلاب' : 'Publish Student Notification'}</h2>
              <input required placeholder="عنوان الإشعار (عربي)" value={annTitleAr} onChange={(e) => setAnnTitleAr(e.target.value)} className="glass-input w-full px-3 py-2 rounded-xl text-xs" />
              <input dir="ltr" placeholder="Title (English)" value={annTitleEn} onChange={(e) => setAnnTitleEn(e.target.value)} className="glass-input w-full px-3 py-2 rounded-xl text-xs" />
              <textarea required rows={3} placeholder="نص الإشعار (عربي)..." value={annBodyAr} onChange={(e) => setAnnBodyAr(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
              <textarea rows={3} dir="ltr" placeholder="Announcement Body (English)..." value={annBodyEn} onChange={(e) => setAnnBodyEn(e.target.value)} className="glass-input w-full p-3 rounded-xl text-xs" />
              <button type="submit" className="glass-btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer">
                {lang === 'ar' ? 'إرسال الإشعار' : 'Send Notification'}
              </button>
            </form>

            <div className="glass-card rounded-2xl p-6 space-y-3">
              <h2 className="text-base font-bold">{lang === 'ar' ? 'الإشعارات النشطة' : 'Active Announcements'}</h2>
              {announcements.map((a) => (
                <div key={a.id} className="glass-subcard p-3.5 rounded-xl text-xs space-y-1.5">
                  <BilingualTitle
                    ar={a.titleAr}
                    en={a.titleEn}
                    studyLang={studyLang}
                    as="p"
                    className="font-bold"
                  />
                  <BilingualTextBlock
                    ar={a.bodyAr}
                    en={a.bodyEn}
                    studyLang={studyLang}
                    className="text-slate-500 dark:text-slate-400"
                  />
                </div>
              ))}
            </div>
          </div>

          <OfflineDiagnosticsPanel lang={lang} />
        </div>
      )}
    </div>
  );
}
