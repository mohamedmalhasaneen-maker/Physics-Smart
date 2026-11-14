import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Language,
  Lesson,
  StudyLanguage,
  TutorMessage,
  TutorSession,
  UserProfile,
} from '../types/physics';
import { pickStudyText } from '../lib/bilingual';
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
  studyLang: StudyLanguage;
  profile: UserProfile;
  lessons: Lesson[];
  sessions: TutorSession[];
  initialLessonContext: Lesson | null;
  onSaveSession: (session: TutorSession) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

export function TutorView({
  lang,
  studyLang,
  profile,
  lessons,
  sessions,
  initialLessonContext,
  onSaveSession,
  onDeleteSession,
}: TutorViewProps) {
  const scopedLessons = useMemo(
    () => lessons.filter((l) => l.track === profile.track && l.grade === profile.grade),
    [lessons, profile.track, profile.grade]
  );

  const [mode, setMode] = useState<'tutor' | 'analyzer' | 'examiner'>('tutor');
  const [tutorLang, setTutorLang] = useState<StudyLanguage>(studyLang);
  const [level, setLevel] = useState<'simple' | 'intermediate' | 'advanced'>('intermediate');
  const [style, setStyle] = useState<'conceptual' | 'mathematical' | 'visual_analogy' | 'exam_focused'>('conceptual');
  const [detail, setDetail] = useState<'concise' | 'detailed'>('concise');
  const [groundedLessonId, setGroundedLessonId] = useState<string>(initialLessonContext?.id || '');

  useEffect(() => {
    setTutorLang(studyLang);
  }, [studyLang]);

  const [activeSessionId, setActiveSessionId] = useState<string>(`session-${Date.now()}`);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<{ name: string; mimeType: string; data: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [slowWait, setSlowWait] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [lastInteractionId, setLastInteractionId] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamingText]);

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

  const compactLessonContext = useMemo(() => {
    const lesson = scopedLessons.find((l) => l.id === groundedLessonId);
    if (!lesson) return '';
    const laws = lesson.lawsLatex
      .slice(0, 6)
      .map((x) => `${x.nameAr || x.nameEn}: ${x.latex}`)
      .join('; ');
    return `Lesson: ${lesson.titleAr} (${lesson.titleEn})${laws ? `\nKey Laws: ${laws}` : ''}`.slice(0, 900);
  }, [scopedLessons, groundedLessonId]);

  const toFriendlyTutorError = (
    rawErr: any,
    status?: number,
    errorCode?: string,
    source?: string
  ): string => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return lang === 'ar'
        ? 'يبدو أن الاتصال بالإنترنت مقطوع حاليًا. تأكد من اتصالك بالشبكة ثم اضغط إعادة المحاولة، سؤالك ما زال محفوظًا.'
        : 'You appear to be offline. Check your connection and click Retry — your question is saved.';
    }
    const msg = String(rawErr?.message || rawErr || '');
    const lower = msg.toLowerCase();
    const diagTag = errorCode || status ? ` (${[errorCode, status].filter(Boolean).join(' / ')})` : '';

    if (rawErr?.name === 'AbortError' || errorCode === 'TIMEOUT' || status === 504) {
      return lang === 'ar'
        ? `استغرق تجهيز الإجابة وقتًا أطول من المعتاد${diagTag}. سؤالك محفوظ كما هو، اضغط «إعادة المحاولة».`
        : `Preparing the answer took longer than usual${diagTag}. Your question is saved — please click Retry.`;
    }
    if (source === 'vercel_env') {
      return lang === 'ar'
        ? `مفتاح GEMINI_API_KEY غير مضاف أو غير مفعّل في بيئة Production على Vercel (${errorCode || 401}). يرجى إضافته في إعدادات Vercel ثم عمل Redeploy.`
        : `GEMINI_API_KEY is missing or inactive in Vercel Production (${errorCode || 401}). Add it in Vercel Production settings and Redeploy.`;
    }
    if (errorCode === 'PERMISSION_DENIED' || status === 403 || source === 'gemini_permissions') {
      return lang === 'ar'
        ? `مفتاح Gemini موجود لكنه مرفوض بسبب الصلاحيات أو قيود المشروع (403 / PERMISSION_DENIED). تحقق من قيود المفتاح وتفعيل Gemini API في Google AI Studio.`
        : `Gemini API key lacks permissions or is restricted (403 / PERMISSION_DENIED). Check API restrictions in Google AI Studio.`;
    }
    if (errorCode === 'AUTH_ERROR' || status === 401 || source === 'gemini_auth') {
      return lang === 'ar'
        ? `مفتاح Gemini API غير صالح أو مرفوض من Google (${errorCode || 401}). يرجى إنشاء مفتاح جديد من Google AI Studio وتحديث GEMINI_API_KEY في Vercel.`
        : `Gemini API key is invalid or rejected (401). Generate a valid key in Google AI Studio and update GEMINI_API_KEY in Vercel.`;
    }
    if (status === 404 || errorCode === 'NOT_FOUND' || lower.includes('the page could not be found')) {
      return lang === 'ar'
        ? 'مسار المدرس الذكي على الخادم غير متاح حاليًا (HTTP 404). سؤالك محفوظ — يرجى التحقق من نشر دوال API على Vercel.'
        : 'The AI Tutor API route was not found on the server (HTTP 404). Your question is saved.';
    }
    if (errorCode === 'MODEL_UNAVAILABLE') {
      return lang === 'ar'
        ? `نموذج Gemini المطلوب غير متاح لهذا المشروع حاليًا${diagTag}. سؤالك محفوظ — اضغط «إعادة المحاولة».`
        : `The requested Gemini model is unavailable for this project${diagTag}. Your question is saved — click Retry.`;
    }
    if (errorCode === 'RATE_LIMIT' || status === 429) {
      return lang === 'ar'
        ? `تم تجاوز حد الطلبات المسموح حاليًا على خدمة Gemini${diagTag}. سؤالك محفوظ — انتظر لحظات واضغط «إعادة المحاولة».`
        : `Gemini rate limit reached${diagTag}. Your question is saved — wait a moment and click Retry.`;
    }
    if (
      errorCode === 'HIGH_DEMAND' ||
      errorCode === 'SERVER_ERROR' ||
      status === 503 ||
      status === 500 ||
      status === 502 ||
      lower.includes('503') ||
      lower.includes('high demand') ||
      lower.includes('unavailable')
    ) {
      return lang === 'ar'
        ? `المدرس الذكي مشغول حاليًا بطلبات كثيرة${diagTag}. سؤالك محفوظ كما هو — اضغط «إعادة المحاولة» بعد لحظات.`
        : `The AI Tutor is experiencing temporary high traffic${diagTag}. Your question is saved — click Retry in a moment.`;
    }
    if (lower.includes('failed to fetch') || lower.includes('network') || errorCode === 'NETWORK_ERROR') {
      return lang === 'ar'
        ? 'تعذر الاتصال بالخادم مؤقتًا. سؤالك محفوظ كما هو، اضغط «إعادة المحاولة».'
        : 'Temporarily unable to reach the server. Your question is saved — please click Retry.';
    }
    if (errorCode === 'NON_JSON_RESPONSE' || errorCode === 'INVALID_JSON_RESPONSE') {
      return lang === 'ar'
        ? `أعاد الخادم استجابة غير متوقعة${diagTag}. سؤالك محفوظ كما هو — اضغط «إعادة المحاولة».`
        : `The server returned an unexpected non-JSON response${diagTag}. Your question is saved — click Retry.`;
    }
    if (errorCode === 'BAD_REQUEST' || status === 400) {
      return lang === 'ar'
        ? 'تعذر قراءة صيغة السؤال أو المرفق الحالي. تأكد من المدخلات وحاول مرة أخرى.'
        : 'Could not process the current question or attachment. Please review your input and try again.';
    }
    return lang === 'ar'
      ? `حدث خلل مؤقت أثناء تجهيز الإجابة${diagTag}. سؤالك ما زال محفوظًا — اضغط «إعادة المحاولة».`
      : `A temporary issue occurred while preparing the response${diagTag}. Your question is saved — click Retry.`;
  };

  const sendMessage = async (e?: React.FormEvent, customText?: string) => {
    e?.preventDefault();
    if (inFlightRef.current || loading) return;

    const rawTrimmed = customText !== undefined ? customText.trim() : inputText.trim();
    const hasAttachment = Boolean(attachment);
    if (!rawTrimmed && !hasAttachment) return;

    const textToSend = rawTrimmed || (lang === 'ar' ? 'حلل المرفق التالي.' : 'Please analyze this attachment.');
    const previousMessages = messages;
    const savedInputText = inputText;
    const savedAttachment = attachment;

    const userMsg: TutorMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      text: textToSend,
      timestamp: new Date().toISOString(),
      attachmentName: savedAttachment?.name,
    };

    const nextMessages = [...previousMessages, userMsg];

    inFlightRef.current = true;
    setMessages(nextMessages);
    setStreamingText('');
    setInputText('');
    setAttachment(null);
    setLoading(true);
    setSlowWait(false);
    setErrorMsg('');

    const reqStart = performance.now();
    const slowTimer = window.setTimeout(() => {
      setSlowWait(true);
    }, 1800);

    const controller = new AbortController();
    const abortTimer = window.setTimeout(() => controller.abort(), 90000);

    try {
      const res = await fetch('/api/ai/tutor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          stream: true,
          message: userMsg.text,
          mode,
          language: tutorLang,
          level,
          style,
          detail,
          track: profile.track,
          grade: profile.grade,
          lessonContext: compactLessonContext,
          history: previousMessages.slice(-6).map((m) => ({
            role: m.role,
            text: m.text.length > 600 ? `${m.text.slice(0, 600)}...` : m.text,
          })),
          previousInteractionId: lastInteractionId || undefined,
          attachment: savedAttachment
            ? { mimeType: savedAttachment.mimeType, data: savedAttachment.data }
            : undefined,
        }),
      });

      const contentType = res.headers.get('content-type') || '';

      let finalReply = '';
      let nextInteractionId: string | null = null;

      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let streamErrorPayload: any = null;

        const handleSseBlock = (block: string) => {
          const lines = block.split('\n');
          let eventType = 'message';
          const dataLines: string[] = [];
          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, '');
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          if (dataLines.length === 0) return;
          const payloadStr = dataLines.join('\n');
          let parsed: any;
          try {
            parsed = JSON.parse(payloadStr);
          } catch {
            return;
          }

          if (eventType === 'delta' && typeof parsed.text === 'string') {
            accumulated += parsed.text;
            setStreamingText(accumulated);
          } else if (eventType === 'done') {
            finalReply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply : accumulated;
            if (parsed.interactionId) {
              nextInteractionId = parsed.interactionId;
            }
          } else if (eventType === 'error') {
            streamErrorPayload = {
              status: parsed.status || 503,
              errorCode: parsed.errorCode,
              source: parsed.source,
              model: parsed.model,
              summary: parsed.primaryError?.summary || parsed.fallbackError?.summary,
              message: parsed.error || parsed.message,
            };
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sepIdx: number;
          while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            if (block.trim()) handleSseBlock(block);
          }
        }
        if (buffer.trim()) {
          handleSseBlock(buffer);
        }

        if (streamErrorPayload) {
          throw streamErrorPayload;
        }
        if (!finalReply.trim()) {
          finalReply = accumulated;
        }
      } else if (contentType.includes('application/json')) {
        const rawText = await res.text();
        let data: any = {};
        try {
          data = rawText ? JSON.parse(rawText) : {};
        } catch {
          throw {
            status: res.status || 502,
            errorCode: 'INVALID_JSON_RESPONSE',
            contentType,
            message: rawText.slice(0, 120) || 'INVALID_JSON_RESPONSE',
          };
        }
        if (!res.ok) {
          throw {
            status: res.status,
            errorCode: data.errorCode,
            source: data.source,
            model: data.model,
            summary: data.primaryError?.summary || data.fallbackError?.summary,
            message: data.error || data.message,
          };
        }
        finalReply = data.reply || '';
        nextInteractionId = data.interactionId || null;
      } else {
        const text = await res.text();
        throw {
          status: res.status || 502,
          errorCode: res.status === 404 ? 'NOT_FOUND' : 'NON_JSON_RESPONSE',
          contentType,
          message: text.slice(0, 160) || 'NON_JSON_RESPONSE',
        };
      }

      if (!finalReply || typeof finalReply !== 'string' || !finalReply.trim()) {
        throw { status: 502, errorCode: 'EMPTY_RESPONSE', message: 'Empty reply' };
      }

      if (nextInteractionId) {
        setLastInteractionId(nextInteractionId);
      }

      const modelMsg: TutorMessage = {
        id: `m-${Date.now() + 1}`,
        role: 'model',
        text: finalReply,
        timestamp: new Date().toISOString(),
      };
      const finalMessages = [...nextMessages, modelMsg];
      setStreamingText('');
      setMessages(finalMessages);

      // Non-blocking Firestore persistence so the student sees & can interact with the answer immediately
      const sessionTitle = finalMessages[0]?.text.slice(0, 60) || 'Physics Session';
      void onSaveSession({
        id: activeSessionId,
        userId: profile.uid,
        title: sessionTitle,
        mode,
        track: profile.track === 'unset' ? 'thanawiya' : profile.track,
        messagesJson: JSON.stringify(finalMessages),
      }).catch((saveErr) => {
        console.warn('Background tutor session save warning:', saveErr);
      });
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - reqStart);
      console.error('[TutorClient Error]', {
        endpoint: '/api/ai/tutor',
        status: err?.status || 0,
        errorCode: err?.errorCode || err?.name || 'UNKNOWN',
        source: err?.source || 'client_or_network',
        model: err?.model || null,
        contentType: err?.contentType || null,
        durationMs,
        summary: err?.summary || String(err?.message || '').slice(0, 160),
      });
      setStreamingText('');
      setMessages(previousMessages);
      setInputText(savedInputText || textToSend);
      setAttachment(savedAttachment);
      setErrorMsg(toFriendlyTutorError(err, err?.status, err?.errorCode, err?.source));
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(abortTimer);
      inFlightRef.current = false;
      setLoading(false);
      setSlowWait(false);
    }
  };

  const loadSession = (s: TutorSession) => {
    try {
      const parsed = JSON.parse(s.messagesJson) as TutorMessage[];
      setActiveSessionId(s.id);
      setMode(s.mode);
      setStreamingText('');
      setMessages(parsed);
      setLastInteractionId(null);
      setErrorMsg('');
    } catch {
      // ignore malformed
    }
  };

  const startNewChat = () => {
    setActiveSessionId(`session-${Date.now()}`);
    setStreamingText('');
    setMessages([]);
    setAttachment(null);
    setLastInteractionId(null);
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
                  {pickStudyText(l.titleAr, l.titleEn, tutorLang)}
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
                onChange={(e) => setTutorLang(e.target.value as StudyLanguage)}
                className="w-full px-2.5 py-2 rounded-xl glass-input text-xs"
              >
                <option value="ar">{lang === 'ar' ? 'العربية' : 'Arabic'}</option>
                <option value="en">English</option>
                <option value="bilingual">{lang === 'ar' ? 'اللغتان معًا (عربي + EN)' : 'Bilingual (AR + EN)'}</option>
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
                {(profile.track === 'american' || tutorLang === 'bilingual'
                  ? [
                      'Explain Newton’s Second Law ($F_{net} = ma$) in Arabic & English',
                      'اشرح الفرق بين المسافة (Distance) والإزاحة (Displacement) مع مثال تطبيقي',
                      'Quiz me on AP Physics Kinematics graphs & slope meaning',
                    ]
                  : lang === 'ar'
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
                    className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs cursor-pointer"
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
                  dir="auto"
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
          {streamingText && (
            <div className="flex justify-start">
              <div dir="auto" className="max-w-[88%] rounded-2xl px-4 py-3 glass-subcard">
                <RichPhysicsText text={streamingText} />
              </div>
            </div>
          )}
          {loading && !streamingText && (
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-cyan-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {slowWait
                  ? lang === 'ar'
                    ? 'ثواني، بنجهز أفضل طريقة للإجابة على سؤالك...'
                    : 'Just a moment, preparing the best way to answer your question...'
                  : lang === 'ar'
                  ? 'جارٍ التحليل الفيزيائي والتحقق من القوانين...'
                  : 'Analyzing physics & verifying units...'}
              </span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {errorMsg && (
          <div className="mx-5 mb-2 flex items-center justify-between gap-3 text-xs text-rose-500 bg-rose-500/10 rounded-xl p-2.5">
            <span>{errorMsg}</span>
            <button
              type="button"
              disabled={loading}
              onClick={() => sendMessage(undefined)}
              className="px-2.5 py-1 rounded-lg bg-rose-500 text-white font-semibold hover:bg-rose-600 disabled:opacity-50 transition shrink-0"
            >
              {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
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
