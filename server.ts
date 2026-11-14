import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Type } from '@google/genai';
import { evaluate } from 'mathjs';
import {
  classifyGeminiError,
  createGeminiClient,
  executeGeminiInteractionStreamWithResilience,
  executeGeminiInteractionWithResilience,
  GeminiAuthCheckReport,
  GeminiClientLike,
  GeminiResilienceError,
  getConfiguredGeminiKey,
  getResilienceStateSnapshot,
  PRIMARY_GEMINI_MODEL,
  sanitizeSecret,
  verifyGeminiAuthAndConnectivity,
} from './server/geminiResilience.ts';
import {
  AttachmentValidationError,
  buildInteractionAttachmentPart,
  deleteGeminiFileSafe,
  IncomingAttachmentPayload,
  logAttachmentStage,
  uploadAttachmentToGeminiFiles,
  validateAndDecodeAttachment,
  validateBinaryBufferAttachment,
} from './server/attachmentHandler.ts';

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

// In-memory cache for static Tutor system instructions (avoids rebuilding identical prompt text every turn)
const SYSTEM_INSTRUCTION_CACHE_MAX = 200;
const systemInstructionCache = new Map<string, string>();

function getCachedTutorSystemInstruction(opts: {
  mode: 'tutor' | 'analyzer' | 'examiner';
  language: 'ar' | 'en' | 'bilingual';
  level: string;
  style: string;
  detail: 'concise' | 'detailed';
  track: string;
  grade: string;
}): string {
  const key = `${opts.mode}|${opts.language}|${opts.level}|${opts.style}|${opts.detail}|${opts.track}|${opts.grade}`;
  const cached = systemInstructionCache.get(key);
  if (cached) return cached;

  const trackLabel =
    opts.track === 'thanawiya'
      ? 'الثانوية العامة المصرية (Thanawiya Amma)'
      : opts.track === 'baccalaureate'
      ? 'البكالوريا المصرية (Egyptian Baccalaureate)'
      : 'American Diploma Physics (Honors / AP Physics)';

  const modeInstructions =
    opts.mode === 'tutor'
      ? 'MODE: TUTOR. Explain physics clearly with Egyptian Arabic warmth and clarity (أسلوب مدرس فيزياء مصري ودود وشاطر), define symbols & SI units, show essential steps without skipping calculations.'
      : opts.mode === 'analyzer'
      ? 'MODE: ANALYZER. Break down rigorously: Givens (with units), Target, SI conversions, Selected Law, Substitution, Calculation, and Unit/Sanity check.'
      : 'MODE: EXAMINER. Ask ONE conceptual or numerical question for the student track and wait for their attempt — NEVER reveal the final answer early. If grading an attempt, pinpoint exact conceptual or unit errors first, then give the next prompt.';

  const languageInstruction =
    opts.language === 'bilingual'
      ? 'LANG: BILINGUAL (Arabic + English). Write clear Egyptian-friendly scientific Arabic explanation with key English terms in parentheses, then a crisp "**English Explanation:**" section.'
      : opts.language === 'ar'
      ? 'LANG: Arabic (لهجة مصرية تعليمية مبسطة ممزوجة بالمصطلحات العلمية الدقيقة وبالرموز والوحدات الإنجليزية بين قوسين). Understand Arabic, English, or mixed input.'
      : 'LANG: Academic English. Understand Arabic, English, or mixed input.';

  const detailInstruction =
    opts.detail === 'concise'
      ? 'DEPTH: DIRECT & CONCISE. Answer immediately with the core concept/law, SI units, and direct steps; avoid filler and offer to expand if the student asks.'
      : 'DEPTH: DETAILED. Provide thorough step-by-step derivations, physical intuition, and complete worked calculations.';

  const template = `You are Physics Smart AI Tutor (مدرس الفيزياء الذكي).
Track: ${trackLabel} | Grade: ${opts.grade || 'General'} | Level: ${opts.level} | Style: ${opts.style}.
${languageInstruction}
${modeInstructions}
${detailInstruction}
RULES: Verify laws, constants (state assumptions like g=9.8 or 10 m/s^2), and SI units; distinguish exact vs rounded results; ask for missing values if ambiguous; maintain conversation continuity; wrap display equations in $$...$$ and inline formulas in $...$.
ATTACHMENTS: When an image or PDF is attached, carefully read all equations, graphs, diagrams, tables, and multi-page content in page order, cite page numbers when answering about a PDF, and if any part is blurry or unreadable NEVER guess—tell the student clearly which part is unclear.`;

  if (systemInstructionCache.size >= SYSTEM_INSTRUCTION_CACHE_MAX) {
    const oldestKey = systemInstructionCache.keys().next().value;
    if (oldestKey) systemInstructionCache.delete(oldestKey);
  }
  systemInstructionCache.set(key, template);
  return template;
}

function buildAttachmentPart(attachment?: IncomingAttachmentPayload | null) {
  const validated = validateAndDecodeAttachment(attachment);
  return buildInteractionAttachmentPart(validated);
}

function formatCompactHistory(history?: Array<{ role: 'user' | 'model'; text: string }>): string {
  if (!Array.isArray(history) || history.length === 0) return '';
  return history
    .slice(-6)
    .map((h) => {
      const cleaned = String(h.text || '').trim();
      const clipped = cleaned.length > 500 ? `${cleaned.slice(0, 500)}...` : cleaned;
      return `${h.role === 'user' ? 'Student' : 'Tutor'}: ${clipped}`;
    })
    .join('\n');
}

function inferErrorSource(
  err: GeminiResilienceError
): 'vercel_env' | 'gemini_auth' | 'gemini_permissions' | 'gemini_api' | 'backend' {
  const summary = String(err.primaryError?.summary || '');
  if (err.errorCode === 'AUTH_ERROR' && (summary.includes('API_KEY_MISSING') || summary.includes('not configured'))) {
    return 'vercel_env';
  }
  if (err.errorCode === 'AUTH_ERROR') {
    return 'gemini_auth';
  }
  if (err.errorCode === 'PERMISSION_DENIED') {
    return 'gemini_permissions';
  }
  if (err.errorCode === 'ATTACHMENT_REJECTED') {
    return 'gemini_api';
  }
  if (err.errorCode === 'BAD_REQUEST' || err.errorCode === 'INTERNAL_ERROR') {
    return 'backend';
  }
  return 'gemini_api';
}

function buildErrorPayload(err: any, fallbackMessage: string) {
  if (err instanceof AttachmentValidationError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        errorCode: err.errorCode,
        retryable: err.retryable,
        source: 'backend_validation',
        stage: err.stage,
      },
    };
  }
  if (err instanceof GeminiResilienceError) {
    const source = inferErrorSource(err);
    return {
      status: err.httpStatus,
      body: {
        error: err.message,
        errorCode: err.errorCode,
        retryable: err.retryable,
        source,
        model: err.meta.model,
        durationMs: err.meta.durationMs,
        primaryError: err.primaryError
          ? {
              category: err.primaryError.category,
              status: err.primaryError.httpStatus,
              summary: sanitizeSecret(err.primaryError.summary).slice(0, 220),
            }
          : null,
        fallbackError: err.fallbackError
          ? {
              model: err.fallbackError.model,
              category: err.fallbackError.category,
              status: err.fallbackError.httpStatus,
              summary: sanitizeSecret(err.fallbackError.summary).slice(0, 220),
            }
          : null,
      },
    };
  }
  const status = typeof err?.status === 'number' && err.status >= 100 && err.status < 600 ? err.status : 500;
  const errorCode = err?.errorCode || (status === 413 ? 'FILE_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
  const errorMsg = err?.message || fallbackMessage;
  const safeMsg = sanitizeSecret(errorMsg);
  return {
    status,
    body: {
      error: errorMsg,
      errorCode,
      retryable: status !== 400 && status !== 413 && status !== 422 && status !== 401 && status !== 403,
      source: status === 400 || status === 413 || status === 422 ? 'backend_validation' : 'backend',
      detail: process.env.NODE_ENV === 'production' ? undefined : safeMsg,
    },
  };
}

function sendResilienceError(res: express.Response, err: any, fallbackMessage: string) {
  const { status, body } = buildErrorPayload(err, fallbackMessage);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(body);
}

function writeSseEvent(res: express.Response, event: string, data: Record<string, unknown>) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Health check (also used to verify active Production deployment & Gemini key status without exposing secrets)
app.get('/api/health', (_req, res) => {
  const { envVarName } = getConfiguredGeminiKey();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.json({
    ok: true,
    service: 'physics-smart-api',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    vercelRegion: process.env.VERCEL_REGION || null,
    nodeVersion: process.version,
    hasGeminiKey: Boolean(envVarName),
    geminiKeyEnvVar: envVarName,
    missingEnvVars: envVarName ? [] : ['GEMINI_API_KEY'],
    primaryModel: PRIMARY_GEMINI_MODEL,
    tutorConfig: {
      streaming: true,
      detailDefault: 'concise',
      thinkingDefault: 'low',
    },
    resilience: getResilienceStateSnapshot(),
  });
});

// Protected Live Gemini Auth & Connectivity Diagnostic Probe
const AUTH_CHECK_COOLDOWN_MS = 60_000;
const AUTH_CHECK_IP_WINDOW_MS = 5 * 60_000;
const AUTH_CHECK_IP_MAX = 10;
let lastAuthCheckCache: { expiresAt: number; report: GeminiAuthCheckReport } | null = null;
const authCheckIpHits = new Map<string, number[]>();

function getFirebaseWebApiKey(): string | null {
  try {
    const candidates = [
      path.resolve(__dirname, 'firebase-applet-config.json'),
      path.resolve(process.cwd(), 'firebase-applet-config.json'),
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (typeof parsed?.apiKey === 'string' && parsed.apiKey.trim()) {
          return parsed.apiKey.trim();
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function isAuthorizedForDiagnosticProbe(req: express.Request): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production') {
    return true;
  }

  const configuredToken = process.env.AI_DIAGNOSTIC_TOKEN?.trim();
  const headerToken = String(req.headers['x-diagnostic-token'] || '').trim();
  if (configuredToken && headerToken && headerToken === configuredToken) {
    return true;
  }

  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice(7).trim();
    const firebaseApiKey = getFirebaseWebApiKey();
    if (idToken && firebaseApiKey) {
      try {
        const resp = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          }
        );
        if (resp.ok) {
          const data: any = await resp.json();
          if (Array.isArray(data?.users) && data.users.length > 0) {
            return true;
          }
        }
      } catch {
        return false;
      }
    }
  }

  return false;
}

app.get('/api/ai/auth-check', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  const authorized = await isAuthorizedForDiagnosticProbe(req);
  if (!authorized) {
    res.status(401).json({
      ok: false,
      errorCode: 'AUTH_REQUIRED',
      error: 'Authentication (Firebase ID token or diagnostic token) is required to run live Gemini connectivity check.',
    });
    return;
  }

  const now = Date.now();
  const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
  const recentHits = (authCheckIpHits.get(clientIp) || []).filter((ts) => now - ts < AUTH_CHECK_IP_WINDOW_MS);
  if (recentHits.length >= AUTH_CHECK_IP_MAX) {
    res.status(429).json({
      ok: false,
      errorCode: 'DIAGNOSTIC_RATE_LIMIT',
      error: 'Too many diagnostic requests. Please wait a few minutes before retrying.',
    });
    return;
  }
  recentHits.push(now);
  authCheckIpHits.set(clientIp, recentHits);

  if (lastAuthCheckCache && now < lastAuthCheckCache.expiresAt && req.query.fresh !== '1') {
    res.status(lastAuthCheckCache.report.ok ? 200 : lastAuthCheckCache.report.httpStatus).json({
      ...lastAuthCheckCache.report,
      cached: true,
    });
    return;
  }

  const clientFactory = app.locals?.geminiClientFactory as (() => GeminiClientLike) | undefined;
  const report = await verifyGeminiAuthAndConnectivity(clientFactory);
  lastAuthCheckCache = {
    expiresAt: now + AUTH_CHECK_COOLDOWN_MS,
    report,
  };

  res.status(report.ok ? 200 : report.httpStatus).json({
    ...report,
    cached: false,
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

// Binary Attachment Upload to Gemini Files API (avoids +33% Base64 overhead and enables URI reuse across turns)
app.post(
  '/api/ai/files/upload',
  express.raw({
    type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    limit: '4.3mb',
  }),
  async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const declaredMime = String(req.headers['x-file-mime'] || req.headers['content-type'] || '');
    const rawName = String(req.headers['x-file-name'] || 'attachment');
    let fileNameDecoded = rawName;
    try {
      fileNameDecoded = decodeURIComponent(rawName);
    } catch {
      // keep rawName
    }

    try {
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const validated = validateBinaryBufferAttachment(buffer, {
        declaredMime,
        name: fileNameDecoded,
        fn: 'POST /api/ai/files/upload',
      });

      const clientFactory = app.locals?.geminiClientFactory as (() => GeminiClientLike) | undefined;
      const ai = clientFactory ? clientFactory() : createGeminiClient();
      const uploaded = await uploadAttachmentToGeminiFiles(ai, validated);

      res.status(200).json({
        ok: true,
        uri: uploaded.uri,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        sizeBytes: validated.sizeBytes,
        pageCount: validated.pageCount ?? null,
        expiresAt: uploaded.expiresAt ?? null,
      });
    } catch (err: any) {
      if (err instanceof AttachmentValidationError) {
        const { status, body } = buildErrorPayload(err, err.message);
        res.status(status).json(body);
        return;
      }
      const classified = classifyGeminiError(err);
      logAttachmentStage({
        stage: 'gemini_files_upload_error',
        fn: 'POST /api/ai/files/upload',
        fileKind: declaredMime.includes('pdf') ? 'document' : 'image',
        mimeType: declaredMime,
        sizeBytes: Buffer.isBuffer(req.body) ? req.body.length : 0,
        transport: 'binary_upload',
        httpStatus: classified.httpStatus,
        errorCode: classified.category === 'auth_error' ? 'AUTH_ERROR' : classified.category === 'permission_denied' ? 'PERMISSION_DENIED' : 'UPLOAD_FAILED',
        summary: classified.rawSummary,
      });
      const isAuth = classified.category === 'auth_error' || classified.category === 'permission_denied';
      res.status(isAuth ? classified.httpStatus : 502).json({
        error: isAuth
          ? classified.safeMessage
          : 'تعذر رفع الملف إلى خادم Gemini المؤقت حاليًا. يمكنك المحاولة مرة أخرى.',
        errorCode:
          classified.category === 'auth_error'
            ? 'AUTH_ERROR'
            : classified.category === 'permission_denied'
            ? 'PERMISSION_DENIED'
            : 'UPLOAD_FAILED',
        retryable: !isAuth,
        source: isAuth ? 'gemini_auth' : 'gemini_api',
      });
    }
  }
);

// Cleanup temporary Gemini Files API reference when a student removes an attachment or resets chat
app.delete('/api/ai/files', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const fileName = String((req.body as any)?.fileName || req.query?.fileName || '').trim();
  if (!fileName) {
    res.status(400).json({ ok: false, errorCode: 'BAD_REQUEST', error: 'fileName is required.' });
    return;
  }
  try {
    const clientFactory = app.locals?.geminiClientFactory as (() => GeminiClientLike) | undefined;
    const ai = clientFactory ? clientFactory() : createGeminiClient();
    const deleted = await deleteGeminiFileSafe(ai, fileName);
    res.json({ ok: deleted });
  } catch {
    res.json({ ok: false });
  }
});

// AI Physics Tutor Endpoint using Gemini Interactions API (SSE Streaming + Fast Failover)
app.post('/api/ai/tutor', async (req, res) => {
  const reqStart = Date.now();
  const wantsStream =
    req.body?.stream === true || String(req.headers.accept || '').includes('text/event-stream');
  const clientFactory = app.locals?.geminiClientFactory as (() => GeminiClientLike) | undefined;

  try {
    const {
      message,
      mode = 'tutor',
      language = 'ar',
      level = 'intermediate',
      style = 'conceptual',
      detail = 'concise',
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
      attachment?: IncomingAttachmentPayload;
      stream?: boolean;
    };

    if (!message && !attachment) {
      res
        .status(400)
        .json({ error: 'Message or attachment is required.', errorCode: 'BAD_REQUEST', retryable: false });
      return;
    }

    const baseInstruction = getCachedTutorSystemInstruction({
      mode,
      language,
      level,
      style,
      detail,
      track,
      grade,
    });
    const trimmedContext = lessonContext ? String(lessonContext).trim().slice(0, 1200) : '';
    const systemInstruction = trimmedContext
      ? `${baseInstruction}\nLESSON CONTEXT:\n${trimmedContext}`
      : baseInstruction;

    const attachmentPart = buildAttachmentPart(attachment);
    const currentMessageText = message || (language === 'ar' ? 'حلل المرفق التالي.' : 'Analyze attachment.');
    const conversationTranscript = formatCompactHistory(history);

    const transcriptText = conversationTranscript
      ? `Previous Conversation:\n${conversationTranscript}\n\nStudent:\n${currentMessageText}`
      : currentMessageText;

    const currentOnlyInput = attachmentPart
      ? [attachmentPart, { type: 'text', text: currentMessageText }]
      : currentMessageText;

    const fullContextInput = attachmentPart
      ? [attachmentPart, { type: 'text', text: transcriptText }]
      : transcriptText;

    const thinkingLevel = detail === 'detailed' ? 'medium' : 'low';
    const backendPrepMs = Date.now() - reqStart;

    if (wantsStream) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      const streamAbort = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) {
          streamAbort.abort(new Error('Client closed SSE connection'));
        }
      });

      try {
        const result = await executeGeminiInteractionStreamWithResilience(
          {
            input: previousInteractionId ? currentOnlyInput : fullContextInput,
            inputWithoutPreviousId: fullContextInput,
            system_instruction: systemInstruction,
            previous_interaction_id: previousInteractionId || undefined,
            thinking_level: thinkingLevel,
          },
          {
            onFirstToken: (info) => {
              writeSseEvent(res, 'meta', {
                model: info.model,
                usedFallback: info.usedFallback,
                attempts: info.attempts,
                ttftMs: info.ttftMs + backendPrepMs,
                backendPrepMs,
              });
            },
            onDelta: (chunk) => {
              writeSseEvent(res, 'delta', { text: chunk });
            },
          },
          {
            endpoint: '/api/ai/tutor',
            signal: streamAbort.signal,
            clientFactory,
          }
        );

        writeSseEvent(res, 'done', {
          reply: result.text,
          interactionId: result.interactionId,
          meta: {
            model: result.meta.model,
            usedFallback: result.meta.usedFallback,
            attempts: result.meta.attempts,
            ttftMs: (result.meta.ttftMs ?? 0) + backendPrepMs,
            durationMs: result.meta.durationMs + backendPrepMs,
            backendPrepMs,
          },
        });
        res.end();
      } catch (streamErr: any) {
        if (!streamAbort.signal.aborted) {
          const { status, body } = buildErrorPayload(
            streamErr,
            'تعذر الحصول على رد من المدرس الذكي حاليًا. يرجى المحاولة مرة أخرى.'
          );
          console.error(
            '[TutorAPI Error]',
            JSON.stringify({
              endpoint: '/api/ai/tutor',
              stream: true,
              environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
              httpStatus: status,
              errorCode: body.errorCode,
              source: (body as any).source,
              model: (body as any).model,
              durationMs: Date.now() - reqStart,
              detail: sanitizeSecret(streamErr?.message || 'Unknown error'),
            })
          );
          writeSseEvent(res, 'error', { status, ...body });
        }
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    const result = await executeGeminiInteractionWithResilience(
      {
        input: previousInteractionId ? currentOnlyInput : fullContextInput,
        inputWithoutPreviousId: fullContextInput,
        system_instruction: systemInstruction,
        previous_interaction_id: previousInteractionId || undefined,
        thinking_level: thinkingLevel,
      },
      { endpoint: '/api/ai/tutor', clientFactory }
    );

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      reply: result.text,
      interactionId: result.interaction?.id || null,
      meta: {
        model: result.meta.model,
        usedFallback: result.meta.usedFallback,
        attempts: result.meta.attempts,
        durationMs: result.meta.durationMs + backendPrepMs,
        backendPrepMs,
      },
    });
  } catch (err: any) {
    const { status, body } = buildErrorPayload(
      err,
      'تعذر الحصول على رد من المدرس الذكي حاليًا. يرجى المحاولة مرة أخرى.'
    );
    console.error(
      '[TutorAPI Error]',
      JSON.stringify({
        endpoint: '/api/ai/tutor',
        stream: wantsStream,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
        httpStatus: status,
        errorCode: body.errorCode,
        source: (body as any).source,
        model: (body as any).model,
        durationMs: Date.now() - reqStart,
        detail: sanitizeSecret(err?.message || 'Unknown error'),
      })
    );
    sendResilienceError(res, err, 'تعذر الحصول على رد من المدرس الذكي حاليًا. يرجى المحاولة مرة أخرى.');
  }
});

// Smart Physics Solver using Gemini Interactions API (gemini-3.8-flash primary + auto-failover)
app.post('/api/ai/solver', async (req, res) => {
  const clientFactory = app.locals?.geminiClientFactory as (() => GeminiClientLike) | undefined;
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
      attachment?: IncomingAttachmentPayload;
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
        thinking_level: 'low',
      },
      { endpoint: '/api/ai/solver', timeoutMs: 32_000, clientFactory }
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
  const clientFactory = app.locals?.geminiClientFactory as (() => GeminiClientLike) | undefined;
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
      { endpoint: '/api/ai/solver/explain-step', clientFactory }
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
app.use('/api', (_req, res) => {
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
  if (
    process.env.VERCEL ||
    process.env.NODE_ENV === 'test' ||
    process.env.DISABLE_AUTO_LISTEN === 'true'
  ) {
    return;
  }
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
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Physics Smart server listening on http://localhost:${PORT}`);
  });
}

startServer();

export default app;
