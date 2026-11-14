import { GoogleGenAI } from '@google/genai';

export const PRIMARY_GEMINI_MODEL = 'gemini-3.8-flash';

// Active, non-deprecated Flash fallback candidates ordered by stability and Interactions API compatibility
export const FALLBACK_FLASH_CANDIDATES = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash',
  'gemini-3-flash-preview',
] as const;

export const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000] as const;
export const MAX_PRIMARY_RETRIES = 2;
export const DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 45000);
export const PRIMARY_COOLDOWN_MS = 45_000; // Auto-recover to primary after high-demand window
export const FALLBACK_CACHE_TTL_MS = 10 * 60_000; // Cache verified fallback availability for 10 min

export type GeminiErrorCategory =
  | 'high_demand'
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'network_error'
  | 'model_unavailable'
  | 'auth_error'
  | 'bad_request'
  | 'empty_response'
  | 'unknown_error';

export interface ClassifiedGeminiError {
  category: GeminiErrorCategory;
  httpStatus: number;
  retryableOnSameModel: boolean;
  triggersFallback: boolean;
  safeMessage: string;
  rawSummary: string;
}

export interface GeminiExecutionMeta {
  model: string;
  usedFallback: boolean;
  attempts: number;
  durationMs: number;
  primaryError: { category: GeminiErrorCategory; httpStatus: number; summary: string } | null;
  fallbackError: { model: string; category: GeminiErrorCategory; httpStatus: number; summary: string } | null;
}

export interface InteractionRequestPayload {
  input: any;
  inputWithoutPreviousId?: any;
  system_instruction?: string;
  previous_interaction_id?: string;
  response_format?: any;
  thinking_level?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface GeminiClientLike {
  interactions: {
    create: (params: Record<string, any>, options?: Record<string, any>) => Promise<any>;
  };
  models?: {
    list?: (params?: any) => Promise<any>;
    get?: (params: { model: string }) => Promise<any>;
  };
}

export interface ResilienceOptions {
  endpoint: string;
  timeoutMs?: number;
  maxPrimaryRetries?: number;
  backoffScheduleMs?: readonly number[];
  jitterMaxMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  clientFactory?: () => GeminiClientLike;
  onLog?: (entry: Record<string, unknown>) => void;
}

interface CircuitState {
  primaryCooldownUntil: number;
  verifiedFallbackModels: string[];
  verifiedFallbackExpiresAt: number;
  unavailableModelsUntil: Map<string, number>;
}

const circuitState: CircuitState = {
  primaryCooldownUntil: 0,
  verifiedFallbackModels: [],
  verifiedFallbackExpiresAt: 0,
  unavailableModelsUntil: new Map<string, number>(),
};

export function resetResilienceState() {
  circuitState.primaryCooldownUntil = 0;
  circuitState.verifiedFallbackModels = [];
  circuitState.verifiedFallbackExpiresAt = 0;
  circuitState.unavailableModelsUntil.clear();
}

export function getResilienceStateSnapshot(now = Date.now()) {
  return {
    primaryInCooldown: now < circuitState.primaryCooldownUntil,
    primaryCooldownRemainingMs: Math.max(0, circuitState.primaryCooldownUntil - now),
    verifiedFallbackModels: [...circuitState.verifiedFallbackModels],
  };
}

export function sanitizeSecret(text: string): string {
  if (!text) return '';
  return text
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/(key|apiKey|api_key|token|authorization)\s*[:=]\s*['"]?[A-Za-z0-9._-]{12,}['"]?/gi, '$1=[REDACTED]');
}

export function createGeminiClient(): GeminiClientLike {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    const err: any = new Error('GEMINI_API_KEY is not configured in environment.');
    err.status = 401;
    err.code = 'API_KEY_MISSING';
    throw err;
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'physics-smart-aistudio',
      },
    },
  }) as unknown as GeminiClientLike;
}

function extractHttpStatus(err: any): number {
  const candidates = [
    err?.status,
    err?.statusCode,
    err?.data$?.httpMeta?.response?.status,
    err?.data$?.error?.code,
    err?.error?.code,
    err?.response?.status,
    err?.cause?.status,
  ];
  for (const val of candidates) {
    if (typeof val === 'number' && val >= 100 && val < 600) {
      return val;
    }
  }
  const msg = String(err?.message || err?.data$?.error?.message || '');
  const match = msg.match(/\b(400|401|403|404|408|422|429|500|502|503|504)\b/);
  if (match) return Number(match[1]);
  return 0;
}

function extractRawErrorMessage(err: any): string {
  const parts = [
    err?.data$?.error?.message,
    err?.error?.message,
    err?.message,
    err?.data$?.error?.status,
    err?.statusText,
    err?.code,
    err?.name,
  ].filter((x) => typeof x === 'string' && x.trim().length > 0);
  return sanitizeSecret(parts.join(' | ') || String(err || 'Unknown error'));
}

export function classifyGeminiError(err: any): ClassifiedGeminiError {
  const status = extractHttpStatus(err);
  const rawSummary = extractRawErrorMessage(err);
  const lower = rawSummary.toLowerCase();

  // 1. Auth / API key / Permission errors -> NEVER retry
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated') ||
    lower.includes('api_key_missing') ||
    lower.includes('not configured in environment')
  ) {
    return {
      category: 'auth_error',
      httpStatus: status || 401,
      retryableOnSameModel: false,
      triggersFallback: false,
      safeMessage: 'خدمة الذكاء الاصطناعي غير مفعلة حاليًا بسبب إعدادات الخادم.',
      rawSummary,
    };
  }

  // 2. Empty output -> retry once or fallback
  if (err?.code === 'EMPTY_RESPONSE' || lower.includes('empty_response')) {
    return {
      category: 'empty_response',
      httpStatus: 502,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: 'لم تكتمل الإجابة بشكل صحيح، يرجى إعادة المحاولة.',
      rawSummary,
    };
  }

  // 3. Model unavailable / 404 -> skip retries on same model and trigger fallback immediately
  if (status === 404 || lower.includes('not_found') || lower.includes('no longer available') || lower.includes('model not found')) {
    return {
      category: 'model_unavailable',
      httpStatus: 404,
      retryableOnSameModel: false,
      triggersFallback: true,
      safeMessage: 'النموذج الأساسي غير متاح حاليًا، جارٍ التحويل للبديل.',
      rawSummary,
    };
  }

  // 4. Bad request / invalid input / validation error -> NEVER retry (except previous_interaction_id handled separately)
  if (
    status === 400 ||
    status === 422 ||
    lower.includes('invalid_argument') ||
    lower.includes('failed_precondition')
  ) {
    return {
      category: 'bad_request',
      httpStatus: 400,
      retryableOnSameModel: false,
      triggersFallback: false,
      safeMessage: 'تعذر معالجة صيغة السؤال أو المرفق الحالي. يرجى مراجعة المدخلات والمحاولة مرة أخرى.',
      rawSummary,
    };
  }

  // 5. High demand / 503 -> Retry with backoff then fallback
  if (
    status === 503 ||
    lower.includes('high demand') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('service unavailable')
  ) {
    return {
      category: 'high_demand',
      httpStatus: 503,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: 'المدرس الذكي يواجه ضغطًا مؤقتًا حاليًا. سؤالك محفوظ، يرجى المحاولة بعد لحظات.',
      rawSummary,
    };
  }

  // 6. Rate limit / 429 -> Retry with backoff then fallback
  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      category: 'rate_limit',
      httpStatus: 429,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: 'المدرس الذكي يواجه ضغطًا مؤقتًا في الطلبات. يرجى إعادة المحاولة بعد ثوانٍ.',
      rawSummary,
    };
  }

  // 7. Timeout -> Retry then fallback
  if (
    status === 408 ||
    status === 504 ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborterror') ||
    lower.includes('etimedout')
  ) {
    return {
      category: 'timeout',
      httpStatus: 504,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: 'استغرق الاتصال وقتًا أطول من المعتاد. يرجى الضغط على إعادة المحاولة.',
      rawSummary,
    };
  }

  // 8. Transient server 500/502 -> Retry then fallback
  if (status === 500 || status === 502 || lower.includes('internal')) {
    return {
      category: 'server_error',
      httpStatus: status || 500,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: 'حدث خلل مؤقت في الخدمة. يرجى إعادة المحاولة.',
      rawSummary,
    };
  }

  // 9. Network / connection error -> Retry then fallback
  if (
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('eai_again') ||
    lower.includes('fetch failed') ||
    lower.includes('apiconnectionerror') ||
    lower.includes('network') ||
    lower.includes('socket')
  ) {
    return {
      category: 'network_error',
      httpStatus: 503,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: 'تعذر الاتصال بخدمة الذكاء الاصطناعي مؤقتًا. يرجى التحقق من الشبكة والمحاولة مجددًا.',
      rawSummary,
    };
  }

  return {
    category: 'unknown_error',
    httpStatus: status || 500,
    retryableOnSameModel: false,
    triggersFallback: false,
    safeMessage: 'تعذر إكمال الرد حاليًا. يرجى المحاولة مرة أخرى.',
    rawSummary,
  };
}

export function isPreviousInteractionError(err: any): boolean {
  const msg = extractRawErrorMessage(err).toLowerCase();
  return msg.includes('previous_interaction') || msg.includes('interaction not found') || msg.includes('interaction_id');
}

export function computeBackoffDelayMs(
  retryIndex: number,
  schedule: readonly number[] = BACKOFF_SCHEDULE_MS,
  jitterMaxMs = 250
): number {
  const base = schedule[Math.min(retryIndex, schedule.length - 1)] ?? 1000;
  const jitter = jitterMaxMs > 0 ? Math.floor(Math.random() * jitterMaxMs) : 0;
  return base + jitter;
}

export function extractInteractionOutputText(interaction: any): string {
  if (!interaction) return '';
  if (typeof interaction.output_text === 'string' && interaction.output_text.trim().length > 0) {
    return interaction.output_text.trim();
  }
  if (Array.isArray(interaction.steps)) {
    const chunks: string[] = [];
    for (const step of interaction.steps) {
      if (step?.type === 'model_output' && Array.isArray(step.content)) {
        for (const item of step.content) {
          if (item?.type === 'text' && typeof item.text === 'string') {
            chunks.push(item.text);
          }
        }
      }
    }
    const combined = chunks.join('').trim();
    if (combined.length > 0) return combined;
  }
  return '';
}

function isEligibleFallbackFlashName(modelName: string): boolean {
  const id = modelName.replace(/^models\//, '').toLowerCase();
  if (!id.includes('flash')) {
    // Include gemini-4-hydrogen (Gemini 4 Flash alias in @google/genai)
    if (id !== 'gemini-4-hydrogen') return false;
  }
  if (id === PRIMARY_GEMINI_MODEL) return false;
  // Never pick deprecated or specialized non-text-chat models
  const disallowedFragments = [
    '1.5',
    '2.0',
    '2.5',
    'tts',
    'image',
    'live',
    'audio',
    'transcribe',
    'embedding',
    'omni',
    'robotics',
    'thinking',
  ];
  return !disallowedFragments.some((frag) => id.includes(frag));
}

export async function resolveVerifiedFallbackModels(
  ai: GeminiClientLike,
  nowFn: () => number = Date.now
): Promise<string[]> {
  const now = nowFn();

  if (circuitState.verifiedFallbackModels.length > 0 && now < circuitState.verifiedFallbackExpiresAt) {
    return circuitState.verifiedFallbackModels.filter(
      (m) => (circuitState.unavailableModelsUntil.get(m) || 0) <= now
    );
  }

  const discovered = new Set<string>();

  // 1. Check account-available models via SDK if supported (single lightweight metadata check)
  if (ai.models?.list) {
    try {
      const pager: any = await ai.models.list({ config: { pageSize: 50 } });
      const items: any[] = Array.isArray(pager?.page)
        ? pager.page
        : Array.isArray(pager?.models)
        ? pager.models
        : [];
      for (const item of items) {
        const rawName = String(item?.name || item?.id || '').replace(/^models\//, '');
        if (!rawName || !isEligibleFallbackFlashName(rawName)) continue;
        const methods: string[] = Array.isArray(item?.supportedGenerationMethods)
          ? item.supportedGenerationMethods
          : [];
        // Skip models explicitly lacking generation support
        if (methods.length > 0 && !methods.some((m) => /generate|interact/i.test(m))) continue;
        discovered.add(rawName);
      }
    } catch {
      // Fallback to individual verification below
    }
  }

  // 2. If list() didn't return items, verify vetted candidates via models.get() if supported
  if (discovered.size === 0 && ai.models?.get) {
    for (const candidate of FALLBACK_FLASH_CANDIDATES) {
      if ((circuitState.unavailableModelsUntil.get(candidate) || 0) > now) continue;
      try {
        const info: any = await ai.models.get({ model: candidate });
        if (info) {
          discovered.add(candidate);
          break; // Found a verified active Flash fallback model
        }
      } catch (err: any) {
        const classified = classifyGeminiError(err);
        if (classified.category === 'model_unavailable') {
          circuitState.unavailableModelsUntil.set(candidate, now + FALLBACK_CACHE_TTL_MS);
        }
      }
    }
  }

  // Order discovered models prioritizing our vetted FALLBACK_FLASH_CANDIDATES order
  const ordered: string[] = [];
  for (const preferred of FALLBACK_FLASH_CANDIDATES) {
    if (discovered.has(preferred) && (circuitState.unavailableModelsUntil.get(preferred) || 0) <= now) {
      ordered.push(preferred);
    }
  }
  for (const extra of discovered) {
    if (!ordered.includes(extra) && (circuitState.unavailableModelsUntil.get(extra) || 0) <= now) {
      ordered.push(extra);
    }
  }

  // If discovery APIs themselves failed (e.g., transient metadata endpoint issue), keep vetted active list
  const finalModels =
    ordered.length > 0
      ? ordered
      : FALLBACK_FLASH_CANDIDATES.filter((m) => (circuitState.unavailableModelsUntil.get(m) || 0) <= now);

  if (ordered.length > 0) {
    circuitState.verifiedFallbackModels = finalModels;
    circuitState.verifiedFallbackExpiresAt = now + FALLBACK_CACHE_TTL_MS;
  }

  return finalModels;
}

function buildInteractionParamsForModel(
  model: string,
  payload: InteractionRequestPayload,
  includePreviousInteractionId: boolean,
  forceLowThinking = false
): Record<string, any> {
  const usePrev = Boolean(includePreviousInteractionId && payload.previous_interaction_id);
  const params: Record<string, any> = {
    model,
    input: usePrev ? payload.input : (payload.inputWithoutPreviousId ?? payload.input),
  };

  if (payload.system_instruction) {
    params.system_instruction = payload.system_instruction;
  }

  if (usePrev) {
    params.previous_interaction_id = payload.previous_interaction_id;
  }

  if (payload.response_format) {
    params.response_format = payload.response_format;
  }

  // flash-lite does not support 'high'/'low' thinking_level in some versions; omit generation_config unless supported
  if (payload.thinking_level && !model.includes('flash-lite')) {
    params.generation_config = {
      thinking_level: forceLowThinking ? 'low' : payload.thinking_level,
    };
  }

  return params;
}

async function invokeInteractionOnce(
  ai: GeminiClientLike,
  model: string,
  payload: InteractionRequestPayload,
  timeoutMs: number,
  allowPreviousId: boolean,
  forceLowThinking = false
): Promise<{ text: string; interaction: any }> {
  const params = buildInteractionParamsForModel(model, payload, allowPreviousId, forceLowThinking);

  let interaction: any;
  try {
    interaction = await ai.interactions.create(params, {
      timeout_ms: timeoutMs,
      retries: { strategy: 'none' },
    });
  } catch (err: any) {
    // Safe fallback if stored previous_interaction_id expired (> 1 day) or is incompatible
    if (allowPreviousId && payload.previous_interaction_id && isPreviousInteractionError(err)) {
      const retryParams = buildInteractionParamsForModel(model, payload, false, forceLowThinking);
      interaction = await ai.interactions.create(retryParams, {
        timeout_ms: timeoutMs,
        retries: { strategy: 'none' },
      });
    } else {
      throw err;
    }
  }

  const text = extractInteractionOutputText(interaction);
  if (!text) {
    const emptyErr: any = new Error('Model returned an empty response.');
    emptyErr.code = 'EMPTY_RESPONSE';
    throw emptyErr;
  }

  return { text, interaction };
}

export class GeminiResilienceError extends Error {
  public readonly httpStatus: number;
  public readonly errorCode: string;
  public readonly retryable: boolean;
  public readonly primaryError: GeminiExecutionMeta['primaryError'];
  public readonly fallbackError: GeminiExecutionMeta['fallbackError'];
  public readonly meta: GeminiExecutionMeta;

  constructor(
    message: string,
    opts: {
      httpStatus: number;
      errorCode: string;
      retryable: boolean;
      meta: GeminiExecutionMeta;
    }
  ) {
    super(message);
    this.name = 'GeminiResilienceError';
    this.httpStatus = opts.httpStatus;
    this.errorCode = opts.errorCode;
    this.retryable = opts.retryable;
    this.primaryError = opts.meta.primaryError;
    this.fallbackError = opts.meta.fallbackError;
    this.meta = opts.meta;
  }
}

function mapCategoryToErrorCode(cat: GeminiErrorCategory): string {
  switch (cat) {
    case 'high_demand':
      return 'HIGH_DEMAND';
    case 'rate_limit':
      return 'RATE_LIMIT';
    case 'timeout':
      return 'TIMEOUT';
    case 'auth_error':
      return 'AUTH_ERROR';
    case 'bad_request':
      return 'BAD_REQUEST';
    case 'model_unavailable':
      return 'MODEL_UNAVAILABLE';
    case 'empty_response':
      return 'EMPTY_RESPONSE';
    case 'network_error':
      return 'NETWORK_ERROR';
    case 'server_error':
      return 'SERVER_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}

export async function executeGeminiInteractionWithResilience(
  payload: InteractionRequestPayload,
  options: ResilienceOptions
): Promise<{ text: string; interaction: any; meta: GeminiExecutionMeta }> {
  const nowFn = options.nowFn || Date.now;
  const sleepFn = options.sleepFn || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPrimaryRetries = options.maxPrimaryRetries ?? MAX_PRIMARY_RETRIES;
  const backoffSchedule = options.backoffScheduleMs ?? BACKOFF_SCHEDULE_MS;
  const jitterMaxMs = options.jitterMaxMs ?? 250;
  const log = options.onLog || ((entry) => console.log('[GeminiResilience]', JSON.stringify(entry)));

  const startTime = nowFn();
  let totalAttempts = 0;
  let primaryErrorInfo: GeminiExecutionMeta['primaryError'] = null;
  let fallbackErrorInfo: GeminiExecutionMeta['fallbackError'] = null;

  let ai: GeminiClientLike;
  try {
    ai = options.clientFactory ? options.clientFactory() : createGeminiClient();
  } catch (err: any) {
    const classified = classifyGeminiError(err);
    const meta: GeminiExecutionMeta = {
      model: PRIMARY_GEMINI_MODEL,
      usedFallback: false,
      attempts: 0,
      durationMs: nowFn() - startTime,
      primaryError: { category: classified.category, httpStatus: classified.httpStatus, summary: classified.rawSummary },
      fallbackError: null,
    };
    log({ endpoint: options.endpoint, event: 'client_init_error', ...meta });
    throw new GeminiResilienceError(classified.safeMessage, {
      httpStatus: classified.httpStatus,
      errorCode: mapCategoryToErrorCode(classified.category),
      retryable: false,
      meta,
    });
  }

  const now = nowFn();
  const skipPrimaryBecauseCooldown = now < circuitState.primaryCooldownUntil;
  let shouldTriggerFallback = skipPrimaryBecauseCooldown;
  let forceLowThinking = false;

  // Phase 1: Primary Model (gemini-3.8-flash) with Smart Retry + Exponential Backoff
  if (!skipPrimaryBecauseCooldown) {
    for (let retryIdx = 0; retryIdx <= maxPrimaryRetries; retryIdx++) {
      totalAttempts += 1;
      try {
        const result = await invokeInteractionOnce(
          ai,
          PRIMARY_GEMINI_MODEL,
          payload,
          timeoutMs,
          Boolean(payload.previous_interaction_id),
          forceLowThinking
        );
        // Primary succeeded -> clear any prior cooldown immediately
        circuitState.primaryCooldownUntil = 0;
        const meta: GeminiExecutionMeta = {
          model: PRIMARY_GEMINI_MODEL,
          usedFallback: false,
          attempts: totalAttempts,
          durationMs: nowFn() - startTime,
          primaryError: primaryErrorInfo,
          fallbackError: null,
        };
        log({ endpoint: options.endpoint, event: 'success', ...meta });
        return { ...result, meta };
      } catch (err: any) {
        const classified = classifyGeminiError(err);
        primaryErrorInfo = {
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary,
        };
        if (classified.category === 'timeout') {
          forceLowThinking = true;
        }

        log({
          endpoint: options.endpoint,
          event: 'primary_attempt_failed',
          model: PRIMARY_GEMINI_MODEL,
          attempt: totalAttempts,
          category: classified.category,
          httpStatus: classified.httpStatus,
          retryable: classified.retryableOnSameModel,
          summary: classified.rawSummary,
        });

        // Non-retryable & non-fallback errors (API key, bad request, permission) -> abort immediately
        if (!classified.retryableOnSameModel && !classified.triggersFallback) {
          const meta: GeminiExecutionMeta = {
            model: PRIMARY_GEMINI_MODEL,
            usedFallback: false,
            attempts: totalAttempts,
            durationMs: nowFn() - startTime,
            primaryError: primaryErrorInfo,
            fallbackError: null,
          };
          throw new GeminiResilienceError(classified.safeMessage, {
            httpStatus: classified.httpStatus,
            errorCode: mapCategoryToErrorCode(classified.category),
            retryable: false,
            meta,
          });
        }

        // If model itself is 404 unavailable, skip further retries on primary and failover immediately
        if (!classified.retryableOnSameModel && classified.triggersFallback) {
          shouldTriggerFallback = true;
          break;
        }

        // Retryable transient error (503, 429, 500, timeout, network, empty): wait with exponential backoff + jitter
        if (retryIdx < maxPrimaryRetries) {
          const waitMs = computeBackoffDelayMs(retryIdx, backoffSchedule, jitterMaxMs);
          await sleepFn(waitMs);
        } else {
          // Exhausted retries on primary -> activate short cooldown and trigger fallback
          circuitState.primaryCooldownUntil = nowFn() + PRIMARY_COOLDOWN_MS;
          shouldTriggerFallback = true;
        }
      }
    }
  } else {
    primaryErrorInfo = {
      category: 'high_demand',
      httpStatus: 503,
      summary: 'Primary model in temporary cooldown window after 503 high demand.',
    };
  }

  // Phase 2: Automatic Failover to Verified Active Flash Model
  if (shouldTriggerFallback) {
    const fallbackModels = await resolveVerifiedFallbackModels(ai, nowFn);

    for (const fallbackModel of fallbackModels) {
      totalAttempts += 1;
      try {
        // Note: Do not reuse primary model's previous_interaction_id on a different fallback model;
        // full conversation context is already preserved in payload.input transcript.
        const result = await invokeInteractionOnce(ai, fallbackModel, payload, timeoutMs, false, forceLowThinking);
        const meta: GeminiExecutionMeta = {
          model: fallbackModel,
          usedFallback: true,
          attempts: totalAttempts,
          durationMs: nowFn() - startTime,
          primaryError: primaryErrorInfo,
          fallbackError: fallbackErrorInfo,
        };
        log({ endpoint: options.endpoint, event: 'fallback_success', ...meta });
        return { ...result, meta };
      } catch (err: any) {
        const classified = classifyGeminiError(err);
        fallbackErrorInfo = {
          model: fallbackModel,
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary,
        };
        log({
          endpoint: options.endpoint,
          event: 'fallback_attempt_failed',
          model: fallbackModel,
          attempt: totalAttempts,
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary,
        });

        // If auth/bad_request happens on fallback too, stop immediately
        if (classified.category === 'auth_error' || classified.category === 'bad_request') {
          const meta: GeminiExecutionMeta = {
            model: fallbackModel,
            usedFallback: true,
            attempts: totalAttempts,
            durationMs: nowFn() - startTime,
            primaryError: primaryErrorInfo,
            fallbackError: fallbackErrorInfo,
          };
          throw new GeminiResilienceError(classified.safeMessage, {
            httpStatus: classified.httpStatus,
            errorCode: mapCategoryToErrorCode(classified.category),
            retryable: false,
            meta,
          });
        }

        if (classified.category === 'model_unavailable') {
          circuitState.unavailableModelsUntil.set(fallbackModel, nowFn() + FALLBACK_CACHE_TTL_MS);
        }
      }
    }
  }

  // Both primary and fallback models failed
  const lastCat = fallbackErrorInfo?.category || primaryErrorInfo?.category || 'high_demand';
  const lastStatus = fallbackErrorInfo?.httpStatus || primaryErrorInfo?.httpStatus || 503;
  const meta: GeminiExecutionMeta = {
    model: fallbackErrorInfo?.model || PRIMARY_GEMINI_MODEL,
    usedFallback: Boolean(fallbackErrorInfo),
    attempts: totalAttempts,
    durationMs: nowFn() - startTime,
    primaryError: primaryErrorInfo,
    fallbackError: fallbackErrorInfo,
  };
  log({ endpoint: options.endpoint, event: 'all_models_failed', ...meta });

  const safeMsg =
    lastCat === 'rate_limit'
      ? 'المدرس الذكي يواجه ضغطًا مؤقتًا في الطلبات. يرجى إعادة المحاولة بعد لحظات.'
      : lastCat === 'timeout'
      ? 'استغرق الاتصال وقتًا أطول من المعتاد. سؤالك محفوظ، يرجى الضغط على إعادة المحاولة.'
      : lastCat === 'network_error'
      ? 'تعذر الاتصال بالخدمة مؤقتًا. يرجى التأكد من اتصال الإنترنت والمحاولة مرة أخرى.'
      : 'المدرس الذكي مشغول حاليًا بطلبات كثيرة. سؤالك محفوظ، يرجى إعادة المحاولة بعد لحظات.';

  throw new GeminiResilienceError(safeMsg, {
    httpStatus: lastStatus,
    errorCode: mapCategoryToErrorCode(lastCat),
    retryable: true,
    meta,
  });
}
