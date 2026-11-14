import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Type } from '@google/genai';
import { evaluate } from 'mathjs';
import {
  executeGeminiInteractionWithResilience,
  GeminiResilienceError,
  getResilienceStateSnapshot,
  PRIMARY_GEMINI_MODEL,
  sanitizeSecret,
} from './server/geminiResilience.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use((_req, res, next) => {
  // Allow Firebase Auth signInWithPopup windows to communicate across origins safely
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

app.use(express.json({ limit: '15mb' }));

function buildAttachmentPart(attachment?: { mimeType: string; data: string }) {
  if (!attachment?.data || !attachment?.mimeType) return null;
  const isImage = attachment.mimeType.toLowerCase().startsWith('image/');
  return {
    type: isImage ? 'image' : 'document',
    data: attachment.data,
    mime_type: attachment.mimeType,
  };
}

function sendResilienceError(res: express.Response, err: any, fallbackMessage: string) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (err instanceof GeminiResilienceError) {
    res.status(err.httpStatus).json({
      error: err.message,
      errorCode: err.errorCode,
      retryable: err.retryable,
      primaryError: err.primaryError ? { category: err.primaryError.category, status: err.primaryError.httpStatus } : null,
      fallbackError: err.fallbackError
        ? { model: err.fallbackError.model, category: err.fallbackError.category, status: err.fallbackError.httpStatus }
        : null,
    });
    return;
  }
  const safeMsg = sanitizeSecret(err?.message || fallbackMessage);
  res.status(500).json({
    error: fallbackMessage,
    errorCode: 'INTERNAL_ERROR',
    retryable: true,
    detail: process.env.NODE_ENV === 'production' ? undefined : safeMsg,
  });
}

// Health check
app.get('/api/health', (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    ok: true,
    service: 'physics-smart-api',
    primaryModel: PRIMARY_GEMINI_MODEL,
    resilience: getResilienceStateSnapshot(),
  });
});

// Deterministic Math Engine Endpoint (mathjs)
app.post('/api/math/verify', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const { expression, expected, tolerance = 0.02 } = req.body as {
      expression?: string;
      expected?: number;
      tolerance?: number;
    };
    if (!expression || typeof expression !== 'string') {
      res.status(400).json({ error: 'Expression is required.' });
      return;
    }
    const result = evaluate(expression);
    const numericResult = typeof result === 'number' ? result : Number(result);
    if (!Number.isFinite(numericResult)) {
      res.status(400).json({ error: 'Expression did not evaluate to a finite number.' });
      return;
    }
    const isMatch =
      typeof expected === 'number'
        ? Math.abs(numericResult - expected) <= Math.max(Math.abs(expected) * tolerance, 1e-6)
        : null;
    res.json({ result: numericResult, isMatch });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Math evaluation error' });
  }
});

// AI Physics Tutor Endpoint using Gemini Interactions API (gemini-3.8-flash primary + auto-failover)
app.post('/api/ai/tutor', async (req, res) => {
  try {
    const {
      message,
      mode = 'tutor',
      language = 'ar',
      level = 'intermediate',
      style = 'conceptual',
      detail = 'detailed',
      track = 'thanawiya',
      grade = '',
      lessonContext = '',
      history = [],
      previousInteractionId,
      attachment,
    } = req.body as {
      message: string;
      mode: 'tutor' | 'analyzer' | 'examiner';
      language: 'ar' | 'en' | 'bilingual';
      level: 'simple' | 'intermediate' | 'advanced';
      style: string;
      detail: 'concise' | 'detailed';
      track: string;
      grade: string;
      lessonContext?: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
      previousInteractionId?: string;
      attachment?: { mimeType: string; data: string };
    };

    if (!message && !attachment) {
      res.status(400).json({ error: 'Message or attachment is required.', errorCode: 'BAD_REQUEST', retryable: false });
      return;
    }

    const trackLabel =
      track === 'thanawiya'
        ? 'الثانوية العامة المصرية (Egyptian Thanawiya Amma)'
        : track === 'baccalaureate'
        ? 'البكالوريا المصرية (Egyptian Baccalaureate)'
        : 'American Diploma Physics (High School / Honors / AP Physics — Bilingual Arabic & English Support)';

    const modeInstructions =
      mode === 'tutor'
        ? `You are in TUTOR MODE (وضع المدرس). Explain physics concepts from first principles using clear analogies, step-by-step derivations, complete calculations without skipping steps, symbol & SI unit definitions, and check the student's understanding with a gentle follow-up check. Use a warm, encouraging Egyptian Arabic physics teacher persona (اللهجة المصرية الواضحة المبسطة مع الدقة العلمية).`
        : mode === 'analyzer'
        ? `You are in ANALYZER MODE (وضع المحلل). Dissect the problem or diagram rigorously without skipping steps: list Givens with units, Target, SI unit conversions, Formula selection rationale, Algebraic substitution, Numerical evaluation, and Physical sanity check.`
        : `You are in EXAMINER MODE (وضع الممتحن). Ask ONE challenging conceptual or numerical question appropriate to the student's track and wait for their attempt. NEVER reveal the final answer before the student attempts! If the message contains the student's attempt, grade it carefully, point out exact errors or unit mistakes, explain why, and then give the next question or follow-up.`;

    const languageInstruction =
      language === 'bilingual'
        ? `BILINGUAL (Arabic + English): Respond clearly in BOTH Arabic and English! Provide:
  (1) A complete, natural scientific Arabic explanation (باللهجة المصرية التعليمية المبسطة والعربية العلمية السليمة) with key English physics terms in parentheses.
  (2) Directly below or paired cleanly, an English Explanation section ("**English Explanation:**") covering the same reasoning and terminology in crisp academic English.`
        : language === 'ar'
        ? 'Arabic (اشرح بأسلوب مدرس فيزياء مصري ودود وشاطر: لهجة مصرية مبسطة ومفهومة ممزوجة بالمصطلحات العلمية الدقيقة وبالرموز والوحدات القياسية الإنجليزية بين قوسين). Understand questions written in Arabic, English, or mixed Arabic-English.'
        : 'English (clear academic English; understand questions written in Arabic, English, or mixed Arabic-English).';

    const systemInstruction = `You are Physics Smart AI Tutor (مدرس الفيزياء الذكي).
Student Track: ${trackLabel} | Grade: ${grade || 'General'}.
Response Language: ${languageInstruction}.
Explanation Level: ${level}. Style: ${style}. Depth: ${detail}.
${modeInstructions}

SCIENTIFIC ACCURACY & CONTINUITY RULES (MANDATORY):
1. Verify all laws, equations, constants, and SI units explicitly.
2. Clearly state physical assumptions (e.g., negligible air resistance, ideal wire, g = 9.8 m/s² or 10 m/s²).
3. Distinguish exact analytical expressions from rounded decimal approximations.
4. NEVER skip intermediate algebraic or numerical problem-solving steps.
5. NEVER fabricate official ministry curriculum claims. If grounded context is provided below, align strictly with it.
6. If the student's question or image is ambiguous or missing values, ask for clarification instead of guessing.
7. Maintain full continuity with prior conversation messages, re-explain concepts patiently when asked, and keep the exact same persona consistently.
8. Format all equations in clean LaTeX wrapped in $$...$$ for display blocks or $...$ for inline formulas.
${lessonContext ? `\nAPPROVED PLATFORM LESSON CONTEXT:\n${lessonContext.slice(0, 6000)}` : ''}`;

    const attachmentPart = buildAttachmentPart(attachment);
    const currentMessageText = message || (language === 'ar' ? 'حلل المرفق التالي.' : 'Analyze attachment.');

    const conversationTranscript = (history || [])
      .slice(-12)
      .map((h) => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${h.text}`)
      .join('\n');

    const transcriptText = conversationTranscript
      ? `Previous Conversation Context:\n${conversationTranscript}\n\nCurrent Student Message:\n${currentMessageText}`
      : currentMessageText;

    const currentOnlyInput = attachmentPart
      ? [attachmentPart, { type: 'text', text: currentMessageText }]
      : currentMessageText;

    const fullContextInput = attachmentPart
      ? [attachmentPart, { type: 'text', text: transcriptText }]
      : transcriptText;

    const result = await executeGeminiInteractionWithResilience(
      {
        input: previousInteractionId ? currentOnlyInput : fullContextInput,
        inputWithoutPreviousId: fullContextInput,
        system_instruction: systemInstruction,
        previous_interaction_id: previousInteractionId || undefined,
        thinking_level: detail === 'detailed' ? 'medium' : 'low',
      },
      { endpoint: '/api/ai/tutor' }
    );

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      reply: result.text,
      interactionId: result.interaction?.id || null,
      meta: {
        model: result.meta.model,
        usedFallback: result.meta.usedFallback,
        attempts: result.meta.attempts,
        durationMs: result.meta.durationMs,
      },
    });
  } catch (err: any) {
    console.error('AI Tutor Error:', sanitizeSecret(err?.message || 'Unknown error'));
    sendResilienceError(res, err, 'تعذر الحصول على رد من المدرس الذكي حاليًا. يرجى المحاولة مرة أخرى.');
  }
});

// Smart Physics Solver using Gemini Interactions API (gemini-3.8-flash primary + auto-failover)
app.post('/api/ai/solver', async (req, res) => {
  try {
    const {
      problemText = '',
      manualGivens = [],
      manualTarget = '',
      language = 'ar',
      track = 'thanawiya',
      attachment,
    } = req.body as {
      problemText?: string;
      manualGivens?: Array<{ symbol: string; value: string; unit: string }>;
      manualTarget?: string;
      language?: 'ar' | 'en' | 'bilingual';
      track?: string;
      attachment?: { mimeType: string; data: string };
    };

    if (!problemText.trim() && manualGivens.length === 0 && !attachment) {
      res.status(400).json({
        error: 'Please provide a problem statement, manual givens, or an image/PDF.',
        errorCode: 'BAD_REQUEST',
        retryable: false,
      });
      return;
    }

    const givensSummary =
      manualGivens.length > 0
        ? `\nManual Givens:\n${manualGivens.map((g) => `- ${g.symbol} = ${g.value} ${g.unit}`).join('\n')}\nTarget: ${manualTarget}`
        : '';

    const solverLangDesc =
      language === 'bilingual'
        ? 'BOTH Arabic and English (Bilingual mode): for every narrative field, write a clear scientific Arabic line first followed by a newline and the matching English translation/terminology on the next line'
        : language === 'ar'
        ? 'Arabic (with clear Egyptian physics teacher clarity, standard English physics symbols/LaTeX, and SI units)'
        : 'English';

    const prompt = `Analyze and solve the following physics problem for the ${track} curriculum in ${solverLangDesc}.
If the problem is unclear or missing critical numerical data, set needsClarification=true and explain what is missing in clarificationQuestion.
Otherwise, provide all 11 pedagogical steps accurately without skipping any derivation or arithmetic step, plus a pure numeric mathjs-compatible arithmetic expression in "verificationExpression" (using only numbers, +, -, *, /, ^, sqrt, sin, cos, tan, pi) so our deterministic math engine can verify the final scalar result!

Problem:
${problemText}
${givensSummary}`;

    const attachmentPart = buildAttachmentPart(attachment);
    const solverInput = attachmentPart ? [attachmentPart, { type: 'text', text: prompt }] : prompt;

    const result = await executeGeminiInteractionWithResilience(
      {
        input: solverInput,
        system_instruction:
          'You are an exact Physics Problem Solver. Verify every unit conversion, state assumptions (like g=9.8 m/s^2), use standard LaTeX for formulas, and ensure arithmetic in verificationExpression matches the final numerical answer.',
        response_format: {
          type: Type.OBJECT,
          properties: {
            needsClarification: { type: Type.BOOLEAN },
            clarificationQuestion: { type: Type.STRING },
            understanding: { type: Type.STRING },
            givens: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: { type: Type.STRING },
                  value: { type: Type.STRING },
                  unit: { type: Type.STRING },
                  meaning: { type: Type.STRING },
                },
              },
            },
            target: { type: Type.STRING },
            unitConversions: { type: Type.STRING },
            selectedFormulaLatex: { type: Type.STRING },
            formulaReason: { type: Type.STRING },
            substitutionLatex: { type: Type.STRING },
            calculations: { type: Type.STRING },
            verificationExpression: { type: Type.STRING },
            finalNumericValue: { type: Type.NUMBER },
            finalAnswerText: { type: Type.STRING },
            unit: { type: Type.STRING },
            sanityCheck: { type: Type.STRING },
          },
          required: [
            'needsClarification',
            'understanding',
            'givens',
            'target',
            'unitConversions',
            'selectedFormulaLatex',
            'formulaReason',
            'substitutionLatex',
            'calculations',
            'finalAnswerText',
            'unit',
            'sanityCheck',
          ],
        },
        thinking_level: 'medium',
      },
      { endpoint: '/api/ai/solver', timeoutMs: 45000 }
    );

    const fullOutput = result.text;
    let parsed: any = {};
    try {
      const jsonMatch = fullOutput.match(/```json\s*([\s\S]*?)\s*```/) || fullOutput.match(/([\{\[][\s\S]*[\}\]])/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(fullOutput);
      }
    } catch {
      console.error('Solver JSON parse error on output length:', fullOutput.length);
      parsed = {
        needsClarification: false,
        understanding: fullOutput,
        givens: [],
        target: '',
        unitConversions: '',
        selectedFormulaLatex: '',
        formulaReason: '',
        substitutionLatex: '',
        calculations: '',
        finalAnswerText: 'Parsed output',
        unit: '',
        sanityCheck: '',
      };
    }

    // Deterministic Math.js verification
    let mathVerification: { verified: boolean; engineValue?: number; expression?: string; note?: string } = {
      verified: false,
    };

    if (parsed.verificationExpression && typeof parsed.verificationExpression === 'string') {
      try {
        const evalResult = evaluate(parsed.verificationExpression);
        const engineNum = typeof evalResult === 'number' ? evalResult : Number(evalResult);
        if (Number.isFinite(engineNum)) {
          const matches =
            typeof parsed.finalNumericValue === 'number'
              ? Math.abs(engineNum - parsed.finalNumericValue) <= Math.max(Math.abs(engineNum) * 0.02, 1e-4)
              : true;
          mathVerification = {
            verified: matches,
            engineValue: Number(engineNum.toPrecision(6)),
            expression: parsed.verificationExpression,
            note: matches ? 'Verified by Math.js engine' : 'Engine recalculated exact value',
          };
        }
      } catch {
        mathVerification = { verified: false, note: 'Symbolic or non-scalar expression' };
      }
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      solution: parsed,
      mathVerification,
      meta: {
        model: result.meta.model,
        usedFallback: result.meta.usedFallback,
        attempts: result.meta.attempts,
        durationMs: result.meta.durationMs,
      },
    });
  } catch (err: any) {
    console.error('Solver Error:', sanitizeSecret(err?.message || 'Unknown error'));
    sendResilienceError(res, err, 'تعذر حل المسألة حاليًا بسبب ضغط مؤقت. يرجى إعادة المحاولة.');
  }
});

// Explain a specific step in the solver using Interactions API (gemini-3.8-flash primary + auto-failover)
app.post('/api/ai/solver/explain-step', async (req, res) => {
  try {
    const { stepTitle, stepContent, problemContext, language = 'ar' } = req.body as {
      stepTitle: string;
      stepContent: string;
      problemContext: string;
      language?: 'ar' | 'en' | 'bilingual';
    };

    const stepLangPrompt =
      language === 'bilingual'
        ? 'Bilingual (Egyptian-friendly clear Arabic explanation first, followed by a crisp English explanation section)'
        : language === 'ar'
        ? 'Arabic (أسلوب مدرس فيزياء مصري مبسط وواضح مع المصطلحات الإنجليزية بين قوسين)'
        : 'English';

    const result = await executeGeminiInteractionWithResilience(
      {
        input: `Explain this specific physics solution step clearly for a student who wants deeper understanding.
Language: ${stepLangPrompt}
Step: ${stepTitle}
Step Content: ${stepContent}
Original Problem Context: ${problemContext}
Use clean LaTeX ($...$ or $$...$$) and verify all units without skipping steps.`,
        thinking_level: 'low',
      },
      { endpoint: '/api/ai/solver/explain-step' }
    );

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      explanation: result.text,
      meta: {
        model: result.meta.model,
        usedFallback: result.meta.usedFallback,
        attempts: result.meta.attempts,
        durationMs: result.meta.durationMs,
      },
    });
  } catch (err: any) {
    console.error('Explain Step Error:', sanitizeSecret(err?.message || 'Unknown error'));
    sendResilienceError(res, err, 'تعذر شرح هذه الخطوة حاليًا. يرجى إعادة المحاولة.');
  }
});

// Guarantee any unknown /api/* route returns JSON instead of HTML
app.all('/api/{*splat}', (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(404).json({ error: 'API endpoint not found.', errorCode: 'NOT_FOUND', retryable: false });
});

// JSON error middleware for malformed request bodies or payload size errors on /api/*
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const status = typeof err?.status === 'number' ? err.status : 400;
    res.status(status).json({
      error: status === 413 ? 'حجم المرفق أكبر من الحد المسموح.' : 'صيغة الطلب غير صالحة.',
      errorCode: 'BAD_REQUEST',
      retryable: false,
    });
    return;
  }
  next(err);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Physics Smart server listening on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
