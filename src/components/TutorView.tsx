import React, { useState } from 'react';
import {
  Language,
  Lesson,
  TutorMessage,
  TutorSession,
  UserProfile,
} from '../types/physics';
import { RichPhysicsText } from './MathRenderer';
import {
  Bot,
  FileUp,
  History,
  Loader2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';

interface TutorViewProps {
  lang: Language;
  profile: UserProfile;
  lessons: Lesson[];
  sessions: TutorSession[];
  initialLessonContext: Lesson | null;
  onSaveSession: (session: TutorSession) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

export function TutorView({
  lang,
  profile,
  lessons,
  sessions,
  initialLessonContext,
  onSaveSession,
  onDeleteSession,
}: TutorViewProps) {
  const scopedLessons = lessons.filter((l) => l.track === profile.track && l.grade === profile.grade);

  const [mode, setMode] = useState<'tutor' | 'analyzer' | 'examiner'>('tutor');
  const [tutorLang, setTutorLang] = useState<Language>(lang);
  const [level, setLevel] = useState<'simple' | 'intermediate' | 'advanced'>('intermediate');
  const [style, setStyle] = useState<'conceptual' | 'mathematical' | 'visual_analogy' | 'exam_focused'>('conceptual');
  const [detail, setDetail] = useState<'concise' | 'detailed'>('detailed');
  const [groundedLessonId, setGroundedLessonId] = useState<string>(initialLessonContext?.id || '');

  const [activeSessionId, setActiveSessionId] = useState<string>(`session-${Date.now()}`);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<{ name: string; mimeType: string; data: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setErrorMsg(lang === 'ar' ? 'الحد الأقصى لحجم الملف 6 ميجابايت.' : 'Maximum file size is 6 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      setAttachment({ name: file.name, mimeType: file.type || 'image/png', data: base64 });
      setErrorMsg('');
    };
    reader.readAsDataURL(file);
  };

  const buildLessonContextString = () => {
    const lesson = scopedLessons.find((l) => l.id === groundedLessonId);
    if (!lesson) return '';
    return `Title: ${lesson.titleEn} / ${lesson.titleAr}\nIntro: ${lesson.introEn}\nLaws: ${lesson.lawsLatex
      .map((x) => `${x.nameEn}: ${x.latex}`)
      .join('; ')}`;
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && !attachment) || loading) return;

    const userMsg: TutorMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      text: inputText.trim() || (lang === 'ar' ? 'حلل المرفق التالي.' : 'Please analyze this attachment.'),
      timestamp: new Date().toISOString(),
      attachmentName: attachment?.name,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputText('');
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/ai/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg.text,
          mode,
          language: tutorLang,
          level,
          style,
          detail,
          track: profile.track,
          grade: profile.grade,
          lessonContext: buildLessonContextString(),
          history: messages.map((m) => ({ role: m.role, text: m.text })),
          attachment: attachment ? { mimeType: attachment.mimeType, data: attachment.data } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI Tutor error');

      const modelMsg: TutorMessage = {
        id: `m-${Date.now() + 1}`,
        role: 'model',
        text: data.reply,
        timestamp: new Date().toISOString(),
      };
      const updatedMessages = [...nextMessages, modelMsg];
      setMessages(updatedMessages);
      setAttachment(null);

      // Persist session in Firestore
      const sessionTitle = updatedMessages[0]?.text.slice(0, 60) || 'Physics Session';
      await onSaveSession({
        id: activeSessionId,
        userId: profile.uid,
        title: sessionTitle,
        mode,
        track: profile.track === 'unset' ? 'thanawiya' : profile.track,
        messagesJson: JSON.stringify(updatedMessages),
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error connecting to AI Tutor.');
    } finally {
      setLoading(false);
    }
  };

  const loadSession = (s: TutorSession) => {
    try {
      const parsed = JSON.parse(s.messagesJson) as TutorMessage[];
      setActiveSessionId(s.id);
      setMode(s.mode);
      setMessages(parsed);
    } catch {
      // ignore malformed
    }
  };

  const startNewChat = () => {
    setActiveSessionId(`session-${Date.now()}`);
    setMessages([]);
    setAttachment(null);
    setErrorMsg('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Sidebar: Modes, Options & History */}
      <aside className="lg:col-span-4 space-y-4">
        <div className="rounded-2xl glass-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold flex items-center gap-2.5">
              <span className="glass-icon glass-icon-cyan w-8 h-8">
                <Bot className="w-4 h-4" />
              </span>
              {lang === 'ar' ? 'إعدادات المدرس الذكي' : 'AI Tutor Controls'}
            </h2>
            <button
              onClick={startNewChat}
              className="p-1.5 rounded-xl glass-btn-secondary"
              title={lang === 'ar' ? 'محادثة جديدة' : 'New Chat'}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* 3 Independent Modes */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {lang === 'ar' ? 'وضع التشغيل' : 'Operating Mode'}
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl glass-subcard">
              {[
                { id: 'tutor', ar: 'المدرس', en: 'Tutor' },
                { id: 'analyzer', ar: 'المحلل', en: 'Analyzer' },
                { id: 'examiner', ar: 'الممتحن', en: 'Examiner' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id as any)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                    mode === m.id
                      ? 'glass-btn-primary text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/[0.06]'
                  }`}
                >
                  {lang === 'ar' ? m.ar : m.en}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              {mode === 'tutor'
                ? lang === 'ar'
                  ? 'يشرح من البداية بالأمثلة ويتأكد من فهمك.'
                  : 'Explains from fundamentals with analogies and checks understanding.'
                : mode === 'analyzer'
                ? lang === 'ar'
                  ? 'يستخرج المعطيات والقانون ويحلل الرسومات خطوة بخطوة.'
                  : 'Extracts givens, selects laws, and dissects diagrams step-by-step.'
                : lang === 'ar'
                ? 'يطرح سؤالًا وينتظر إجابتك ثم يصححها دون حرق الحل.'
                : 'Asks a question, waits for your attempt, then grades & explains mistakes.'}
            </p>
          </div>

          {/* Grounding Lesson */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {lang === 'ar' ? 'ربط بدرس من منهجك' : 'Ground in Curriculum Lesson'}
            </label>
            <select
              value={groundedLessonId}
              onChange={(e) => setGroundedLessonId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl glass-input text-xs"
            >
              <option value="">{lang === 'ar' ? 'فيزياء عامة (حسب مسارك)' : 'General (Track-Scoped)'}</option>
              {scopedLessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {lang === 'ar' ? l.titleAr : l.titleEn}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                {lang === 'ar' ? 'لغة الشرح' : 'Language'}
              </label>
              <select
                value={tutorLang}
                onChange={(e) => setTutorLang(e.target.value as Language)}
                className="w-full px-2.5 py-2 rounded-xl glass-input text-xs"
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                {lang === 'ar' ? 'المستوى' : 'Level'}
              </label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as any)}
                className="w-full px-2.5 py-2 rounded-xl glass-input text-xs"
              >
                <option value="simple">{lang === 'ar' ? 'مبسط' : 'Simple'}</option>
                <option value="intermediate">{lang === 'ar' ? 'متوسط' : 'Intermediate'}</option>
                <option value="advanced">{lang === 'ar' ? 'متقدم' : 'Advanced'}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                {lang === 'ar' ? 'الأسلوب' : 'Style'}
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as any)}
                className="w-full px-2.5 py-2 rounded-xl glass-input text-xs"
              >
                <option value="conceptual">{lang === 'ar' ? 'مفاهيمي' : 'Conceptual'}</option>
                <option value="mathematical">{lang === 'ar' ? 'رياضي اشتقاقي' : 'Mathematical'}</option>
                <option value="visual_analogy">{lang === 'ar' ? 'تشبيهات حياتية' : 'Analogies'}</option>
                <option value="exam_focused">{lang === 'ar' ? 'موجه للامتحان' : 'Exam Focused'}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                {lang === 'ar' ? 'العمق' : 'Detail'}
              </label>
              <select
                value={detail}
                onChange={(e) => setDetail(e.target.value as any)}
                className="w-full px-2.5 py-2 rounded-xl glass-input text-xs"
              >
                <option value="detailed">{lang === 'ar' ? 'تفصيلي' : 'Detailed'}</option>
                <option value="concise">{lang === 'ar' ? 'مختصر' : 'Concise'}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Saved Sessions */}
        <div className="rounded-2xl glass-card p-5 space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-2.5">
            <span className="glass-icon glass-icon-blue w-7 h-7">
              <History className="w-3.5 h-3.5" />
            </span>
            {lang === 'ar' ? 'سجل المحادثات المحفوظة' : 'Saved Tutor History'}
          </h3>
          {sessions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'ar' ? 'لا توجد محادثات سابقة بعد.' : 'No saved sessions yet.'}
            </p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs transition-all ${
                    s.id === activeSessionId
                      ? 'border-cyan-400/50 bg-blue-500/12'
                      : 'glass-subcard hover:border-cyan-400/30'
                  }`}
                >
                  <button onClick={() => loadSession(s)} className="text-start truncate flex-1 font-medium">
                    {s.title}
                  </button>
                  <button
                    onClick={() => onDeleteSession(s.id)}
                    className="text-slate-400 hover:text-rose-500 shrink-0"
                    title={lang === 'ar' ? 'حذف' : 'Delete'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Chat Panel */}
      <div className="lg:col-span-8 rounded-2xl glass-card flex flex-col min-h-[580px] max-h-[760px] overflow-hidden">
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-12 space-y-3">
              <span className="glass-icon glass-icon-cyan w-14 h-14 rounded-2xl">
                <Bot className="w-7 h-7" />
              </span>
              <h3 className="text-lg font-bold">
                {lang === 'ar' ? 'مرحبًا بك مع مدرس الفيزياء الذكي' : 'Ready to Study Physics Together'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                {lang === 'ar'
                  ? 'اطرح أي سؤال في الفيزياء، ارفع صورة مسألة أو دائرة كهربية، أو اختر وضع الممتحن لاختبار فهمك.'
                  : 'Ask any physics concept, upload a problem or circuit diagram, or switch to Examiner Mode to test yourself.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {(lang === 'ar'
                  ? [
                      'اشرح لي لماذا ينخفض جهد البطارية عند غلق الدائرة',
                      'اختبرني في معادلات الحركة بعجلة منتظمة',
                      'كيف نميز بين التوصيل على التوالي والتوازي؟',
                    ]
                  : [
                      'Explain why terminal voltage drops when current flows',
                      'Quiz me on Newton’s Second Law on an incline',
                      'Derive the double-slit fringe spacing formula',
                    ]
                ).map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => setInputText(prompt)}
                    className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'glass-btn-primary text-white'
                      : 'glass-subcard'
                  }`}
                >
                  {msg.attachmentName && (
                    <p className="text-[11px] opacity-80 mb-1">📎 {msg.attachmentName}</p>
                  )}
                  {msg.role === 'user' ? (
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                  ) : (
                    <RichPhysicsText text={msg.text} />
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-cyan-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{lang === 'ar' ? 'جارٍ التحليل الفيزيائي والتحقق من القوانين...' : 'Analyzing physics & verifying units...'}</span>
            </div>
          )}
        </div>

        {errorMsg && (
          <p className="mx-5 mb-2 text-xs text-rose-500 bg-rose-500/10 rounded-xl p-2">{errorMsg}</p>
        )}

        <form onSubmit={sendMessage} className="p-4 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
          {attachment && (
            <div className="flex items-center justify-between text-xs bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-cyan-300 px-3 py-1.5 rounded-xl">
              <span>📎 {attachment.name}</span>
              <button type="button" onClick={() => setAttachment(null)} className="hover:underline">
                {lang === 'ar' ? 'إزالة' : 'Remove'}
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="p-2.5 rounded-xl glass-btn-secondary cursor-pointer shrink-0">
              <FileUp className="w-4 h-4" />
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
            <textarea
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={
                mode === 'examiner'
                  ? lang === 'ar'
                    ? 'اكتب "ابدأ الاختبار" أو اكتب إجابتك هنا...'
                    : 'Type "Start quiz" or submit your attempt...'
                  : lang === 'ar'
                  ? 'اكتب سؤالك الفيزيائي أو المسألة هنا...'
                  : 'Ask a physics question or paste a problem...'
              }
              className="flex-1 px-3.5 py-2 rounded-xl glass-input text-sm resize-none"
            />
            <button
              type="submit"
              disabled={loading || (!inputText.trim() && !attachment)}
              className="p-3 rounded-xl glass-btn-primary disabled:opacity-50 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
