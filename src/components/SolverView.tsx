import React, { useEffect, useRef, useState } from 'react';
import { Language, StudyLanguage, UserProfile } from '../types/physics';
import { LatexBlock, RichPhysicsText } from './MathRenderer';
import { StudyLanguageSwitcher } from './BilingualBlock';
import {
  Camera,
  CheckCircle2,
  FileUp,
  HelpCircle,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';

interface SolverViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  profile: UserProfile;
}

interface SolverSolution {
  needsClarification: boolean;
  clarificationQuestion?: string;
  understanding: string;
  givens: Array<{ symbol: string; value: string; unit: string; meaning: string }>;
  target: string;
  unitConversions: string;
  selectedFormulaLatex: string;
  formulaReason: string;
  substitutionLatex: string;
  calculations: string;
  finalNumericValue?: number;
  finalAnswerText: string;
  unit: string;
  sanityCheck: string;
}

export function SolverView({ lang, studyLang, profile }: SolverViewProps) {
  const [outputLang, setOutputLang] = useState<StudyLanguage>(studyLang);

  useEffect(() => {
    setOutputLang(studyLang);
  }, [studyLang]);

  const [inputMode, setInputMode] = useState<'text' | 'upload' | 'camera' | 'manual'>('text');
  const [problemText, setProblemText] = useState('');
  const [manualGivens, setManualGivens] = useState<Array<{ symbol: string; value: string; unit: string }>>([
    { symbol: 'v_i', value: '0', unit: 'm/s' },
    { symbol: 'a', value: '4', unit: 'm/s^2' },
    { symbol: 't', value: '5', unit: 's' },
  ]);
  const [manualTarget, setManualTarget] = useState('d (displacement)');
  const [attachment, setAttachment] = useState<{ name: string; mimeType: string; data: string } | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [solution, setSolution] = useState<SolverSolution | null>(null);
  const [mathVerif, setMathVerif] = useState<{
    verified: boolean;
    engineValue?: number;
    expression?: string;
    note?: string;
  } | null>(null);

  const [stepExplanations, setStepExplanations] = useState<Record<string, string>>({});
  const [explainingStep, setExplainingStep] = useState<string | null>(null);
  const solveInFlightRef = useRef(false);

  const startCamera = async () => {
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch {
      setErrorMsg(
        lang === 'ar'
          ? 'تعذر الوصول إلى الكاميرا. يمكنك رفع صورة أو PDF بدلًا من ذلك.'
          : 'Camera access unavailable. Please upload an image or PDF instead.'
      );
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const captureFrame = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setAttachment({ name: 'camera-capture.jpg', mimeType: 'image/jpeg', data: dataUrl.split(',')[1] });
    stopCamera();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setErrorMsg(lang === 'ar' ? 'الحد الأقصى 8 ميجابايت.' : 'Max file size is 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const str = reader.result as string;
      setAttachment({ name: file.name, mimeType: file.type || 'image/png', data: str.split(',')[1] || '' });
      setErrorMsg('');
    };
    reader.readAsDataURL(file);
  };

  const handleSolve = async () => {
    if (solveInFlightRef.current || loading) return;
    solveInFlightRef.current = true;
    setLoading(true);
    setErrorMsg('');
    setSolution(null);
    setStepExplanations({});
    try {
      const res = await fetch('/api/ai/solver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemText: inputMode === 'manual' ? `Find ${manualTarget}` : problemText,
          manualGivens: inputMode === 'manual' ? manualGivens : [],
          manualTarget: inputMode === 'manual' ? manualTarget : '',
          language: outputLang,
          track: profile.track,
          attachment: attachment ? { mimeType: attachment.mimeType, data: attachment.data } : undefined,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : {};
      if (!res.ok) {
        const isTraffic = res.status === 503 || res.status === 429 || data.errorCode === 'HIGH_DEMAND';
        throw new Error(
          isTraffic
            ? lang === 'ar'
              ? 'النظام يواجه ضغطًا مؤقتًا حاليًا. مسألتك محفوظة، يرجى الضغط على حل مرة أخرى بعد لحظات.'
              : 'Service is experiencing temporary high traffic. Your problem is saved — please try again shortly.'
            : data.error || (lang === 'ar' ? 'تعذر حل المسألة حاليًا.' : 'Solver request failed')
        );
      }
      setSolution(data.solution);
      setMathVerif(data.mathVerification);
    } catch (err: any) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setErrorMsg(lang === 'ar' ? 'يبدو أن الاتصال بالإنترنت مقطوع حاليًا.' : 'You appear to be offline.');
      } else {
        setErrorMsg(err?.message || (lang === 'ar' ? 'تعذر حل المسألة حاليًا. يرجى المحاولة مرة أخرى.' : 'Failed to solve problem.'));
      }
    } finally {
      solveInFlightRef.current = false;
      setLoading(false);
    }
  };

  const askStepDetail = async (stepKey: string, stepTitle: string, stepContent: string) => {
    if (stepExplanations[stepKey] || explainingStep) return;
    setExplainingStep(stepKey);
    try {
      const res = await fetch('/api/ai/solver/explain-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepTitle,
          stepContent,
          problemContext: problemText || manualTarget,
          language: outputLang,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : {};
      if (res.ok && data.explanation) {
        setStepExplanations((prev) => ({ ...prev, [stepKey]: data.explanation }));
      }
    } finally {
      setExplainingStep(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="rounded-2xl glass-card p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {lang === 'ar' ? 'حل المسائل الفيزيائية الذكي (11 خطوة موثقة)' : 'Smart 11-Step Physics Problem Solver'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {lang === 'ar'
                ? 'أدخل المسألة بالعربية أو الإنجليزية نصيًا أو بالكاميرا أو برفع صورة أو PDF — مع تحقق حسابي عبر محرك Math.js.'
                : 'Input problems in Arabic or English via text, camera, image/PDF upload, or structured givens — verified numerically with Math.js.'}
            </p>
          </div>
          <StudyLanguageSwitcher
            value={outputLang}
            onChange={setOutputLang}
            uiLang={lang}
            label={lang === 'ar' ? 'لغة الحل:' : 'Solution Language:'}
          />
        </div>

        {/* Input Mode Tabs */}
        <div className="flex flex-wrap gap-1.5 p-1 rounded-xl glass-subcard w-fit">
          {[
            { id: 'text', ar: 'كتابة المسألة', en: 'Text Input' },
            { id: 'upload', ar: 'صورة / PDF / دائرة', en: 'Image / PDF / Circuit' },
            { id: 'camera', ar: 'تصوير بالكاميرا', en: 'Camera Scan' },
            { id: 'manual', ar: 'إدخال المعطيات يدويًا', en: 'Manual Givens' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id !== 'camera') stopCamera();
                setInputMode(tab.id as any);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                inputMode === tab.id
                  ? 'glass-btn-primary text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/[0.06]'
              }`}
            >
              {lang === 'ar' ? tab.ar : tab.en}
            </button>
          ))}
        </div>

        {inputMode === 'text' && (
          <textarea
            rows={4}
            value={problemText}
            onChange={(e) => setProblemText(e.target.value)}
            placeholder={
              lang === 'ar'
                ? 'مثال: سقط حجر من ارتفاع 78.4 m عن سطح الأرض (g = 9.8 m/s²). احسب زمن الوصول وسرعته لحظة الاصطدام بالأرض.'
                : 'Example: A stone drops from rest from a height of 78.4 m (g = 9.8 m/s²). Find impact time and final velocity.'
            }
            className="w-full p-4 rounded-xl glass-input text-sm"
          />
        )}

        {inputMode === 'upload' && (
          <div className="space-y-3">
            <label className="flex flex-col items-center justify-center p-8 rounded-xl glass-subcard border-dashed hover:!border-cyan-400/60 cursor-pointer transition-colors">
              <span className="glass-icon glass-icon-blue w-11 h-11 mb-2.5">
                <FileUp className="w-5 h-5" />
              </span>
              <span className="text-sm font-medium">
                {lang === 'ar'
                  ? 'اضغط لرفع صورة مسألة، رسم بياني، دائرة كهربية، أو ملف PDF'
                  : 'Click to upload problem photo, graph, circuit diagram, or PDF'}
              </span>
              <input type="file" accept="image/*,application/pdf" onChange={handleFileUpload} className="hidden" />
            </label>
            <input
              type="text"
              value={problemText}
              onChange={(e) => setProblemText(e.target.value)}
              placeholder={lang === 'ar' ? 'ملاحظة أو سؤال إضافي حول الصورة (اختياري)...' : 'Optional note about the uploaded file...'}
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm"
            />
          </div>
        )}

        {inputMode === 'camera' && (
          <div className="space-y-3">
            {!cameraActive ? (
              <button
                onClick={startCamera}
                className="px-4 py-2.5 rounded-xl glass-btn-secondary text-sm font-medium flex items-center gap-2"
              >
                <Camera className="w-4 h-4 text-blue-600 dark:text-cyan-400" />
                {lang === 'ar' ? 'تشغيل الكاميرا' : 'Open Camera'}
              </button>
            ) : (
              <div className="space-y-3">
                <video ref={videoRef} autoPlay playsInline className="w-full max-h-72 rounded-xl bg-black object-contain" />
                <div className="flex gap-2">
                  <button
                    onClick={captureFrame}
                    className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold"
                  >
                    {lang === 'ar' ? 'التقاط الصورة' : 'Capture Photo'}
                  </button>
                  <button
                    onClick={stopCamera}
                    className="px-4 py-2 rounded-xl glass-btn-secondary text-xs"
                  >
                    {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {inputMode === 'manual' && (
          <div className="space-y-3">
            {manualGivens.map((g, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <input
                  value={g.symbol}
                  onChange={(e) =>
                    setManualGivens((prev) => prev.map((item, i) => (i === idx ? { ...item, symbol: e.target.value } : item)))
                  }
                  placeholder="Symbol (v_i)"
                  dir="ltr"
                  className="col-span-3 px-3 py-2 rounded-xl glass-input text-xs font-mono-num"
                />
                <input
                  value={g.value}
                  onChange={(e) =>
                    setManualGivens((prev) => prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)))
                  }
                  placeholder="Value"
                  dir="ltr"
                  className="col-span-4 px-3 py-2 rounded-xl glass-input text-xs font-mono-num"
                />
                <input
                  value={g.unit}
                  onChange={(e) =>
                    setManualGivens((prev) => prev.map((item, i) => (i === idx ? { ...item, unit: e.target.value } : item)))
                  }
                  placeholder="Unit (m/s)"
                  dir="ltr"
                  className="col-span-4 px-3 py-2 rounded-xl glass-input text-xs font-mono-num"
                />
                <button
                  onClick={() => setManualGivens((prev) => prev.filter((_, i) => i !== idx))}
                  className="col-span-1 text-slate-400 hover:text-rose-500 flex justify-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setManualGivens((prev) => [...prev, { symbol: '', value: '', unit: '' }])}
                className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'إضافة معطى' : 'Add Given'}
              </button>
              <input
                value={manualTarget}
                onChange={(e) => setManualTarget(e.target.value)}
                placeholder={lang === 'ar' ? 'المطلوب (مثال: الإزاحة d)' : 'Target (e.g., displacement d)'}
                className="flex-1 min-w-[200px] px-3 py-1.5 rounded-xl glass-input text-xs"
              />
            </div>
          </div>
        )}

        {attachment && (
          <div className="flex items-center justify-between text-xs bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-cyan-300 px-3 py-2 rounded-xl">
            <span>📎 {attachment.name}</span>
            <button onClick={() => setAttachment(null)} className="hover:underline">
              {lang === 'ar' ? 'إزالة' : 'Remove'}
            </button>
          </div>
        )}

        {errorMsg && (
          <p className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">{errorMsg}</p>
        )}

        <button
          onClick={handleSolve}
          disabled={loading}
          className="px-6 py-3 rounded-xl glass-btn-primary text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          <span>{lang === 'ar' ? 'تحليل وحل المسألة' : 'Analyze & Solve Problem'}</span>
        </button>
      </div>

      {/* 11-Step Solution Output */}
      {solution && (
        <div className="rounded-2xl glass-card p-6 space-y-5 glass-enter">
          {solution.needsClarification ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm">
              <p className="font-bold text-amber-600 dark:text-amber-400 mb-1">
                {lang === 'ar' ? 'المسألة تحتاج إلى توضيح إضافي:' : 'Clarification Needed:'}
              </p>
              <p>{solution.clarificationQuestion}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/70 dark:border-white/10">
                <h2 className="text-lg font-bold">
                  {lang === 'ar' ? 'الحل الفيزيائي المنهجي (11 خطوة)' : 'Structured 11-Step Physics Solution'}
                </h2>
                {mathVerif && (
                  <div
                    className={`text-xs font-medium flex items-center gap-1.5 ${
                      mathVerif.verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {mathVerif.verified
                        ? `${lang === 'ar' ? 'تم التحقق عبر Math.js:' : 'Verified by Math.js:'} ${mathVerif.engineValue}`
                        : mathVerif.note || 'Symbolic Solution'}
                    </span>
                  </div>
                )}
              </div>

              {[
                { key: 's1', titleAr: '1. فهم المسألة والافتراضات', titleEn: '1. Problem Understanding & Assumptions', content: solution.understanding },
                {
                  key: 's2',
                  titleAr: '2. استخراج المعطيات',
                  titleEn: '2. Extracted Givens',
                  content: solution.givens.map((g) => `${g.symbol} = ${g.value} ${g.unit} (${g.meaning})`).join(' · '),
                },
                { key: 's3', titleAr: '3. تحديد المطلوب', titleEn: '3. Required Target', content: solution.target },
                { key: 's4', titleAr: '4. توحيد الوحدات (SI)', titleEn: '4. SI Unit Conversions', content: solution.unitConversions },
                { key: 's5', titleAr: '5. القانون المختار', titleEn: '5. Selected Formula', latex: solution.selectedFormulaLatex, content: solution.selectedFormulaLatex },
                { key: 's6', titleAr: '6. سبب اختيار القانون', titleEn: '6. Rationale for Formula', content: solution.formulaReason },
                { key: 's7', titleAr: '7. التعويض بالقيم', titleEn: '7. Substitution', latex: solution.substitutionLatex, content: solution.substitutionLatex },
                { key: 's8', titleAr: '8. العمليات الحسابية', titleEn: '8. Calculations', content: solution.calculations },
                { key: 's9', titleAr: '9. الإجابة النهائية', titleEn: '9. Final Answer', content: solution.finalAnswerText },
                { key: 's10', titleAr: '10. وحدة القياس', titleEn: '10. Measurement Unit', content: solution.unit },
                { key: 's11', titleAr: '11. التحقق من منطقية الناتج', titleEn: '11. Physical Sanity Check', content: solution.sanityCheck },
              ].map((step) => {
                const title = lang === 'ar' ? step.titleAr : step.titleEn;
                return (
                  <div
                    key={step.key}
                    className="rounded-xl glass-subcard p-4 space-y-2 hover:border-cyan-400/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-bold text-blue-600 dark:text-cyan-400">{title}</h3>
                      <button
                        onClick={() => askStepDetail(step.key, title, step.content)}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-cyan-400 flex items-center gap-1"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'اشرح هذه الخطوة' : 'Explain step'}</span>
                      </button>
                    </div>
                    {step.latex ? (
                      <div dir="ltr">
                        <LatexBlock latex={step.latex} />
                      </div>
                    ) : (
                      <div dir="auto">
                        <RichPhysicsText text={step.content} />
                      </div>
                    )}
                    {explainingStep === step.key && (
                      <p className="text-xs text-blue-500 flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {lang === 'ar' ? 'جارٍ إعداد شرح إضافي...' : 'Preparing deeper explanation...'}
                      </p>
                    )}
                    {stepExplanations[step.key] && (
                      <div dir="auto" className="mt-2 p-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
                        <RichPhysicsText text={stepExplanations[step.key]} />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
