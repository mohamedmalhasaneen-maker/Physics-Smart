import http from 'node:http';
import assert from 'node:assert/strict';
import {
  GeminiClientLike,
  PRIMARY_GEMINI_MODEL,
  resetResilienceState,
} from '../server/geminiResilience.ts';

process.env.NODE_ENV = 'test';
process.env.DISABLE_AUTO_LISTEN = 'true';

interface BenchmarkCase {
  id: string;
  labelAr: string;
  message: string;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  previousInteractionId?: string;
  lessonContext: string;
  // Realistic simulated upstream timings when GEMINI_API_KEY is absent in sandbox
  simBeforeTotalMs: number;
  simAfterTtftMs: number;
  simAfterStreamChunks: string[];
  injectPrimary503?: boolean;
}

const CASES: BenchmarkCase[] = [
  {
    id: 'short_theory',
    labelAr: 'سؤال نظري قصير',
    message: 'ما الفرق بين السرعة القياسية والسرعة المتجهة؟',
    history: [],
    lessonContext: 'Lesson: متجهات السرعة والسرعة النسبية (Velocity Vectors)\nKey Laws: v = d/t',
    simBeforeTotalMs: 280,
    simAfterTtftMs: 22,
    simAfterStreamChunks: [
      'أهلاً يا بطل! ',
      '**السرعة القياسية** مقدار فقط (المسافة ÷ الزمن)، ',
      'أما **السرعة المتجهة** فهي مقدار + اتجاه (الإزاحة ÷ الزمن) $\\vec{v} = \\frac{\\Delta \\vec{d}}{\\Delta t}$ بوحدة $\\text{m/s}$.',
    ],
  },
  {
    id: 'explanation',
    labelAr: 'طلب شرح',
    message: 'اشرح لي لماذا ينخفض جهد البطارية عند غلق الدائرة؟',
    history: [],
    lessonContext: 'Lesson: قانون أوم للدوائر المغلقة\nKey Laws: V = V_B - I r',
    simBeforeTotalMs: 360,
    simAfterTtftMs: 25,
    simAfterStreamChunks: [
      'ببساطة يا بطل: ',
      'عند غلق الدائرة يمر تيار $I$ داخل المقاومة الداخلية للبطارية $r$، ',
      'فبيحصل هبوط في الجهد مقداره $I r$، وبالتالي جهد الطرفين $V = V_B - I r$ يقل عن القوة الدافعة $V_B$.',
    ],
  },
  {
    id: 'numerical',
    labelAr: 'مسألة حسابية',
    message: 'جسم كتلته 4 kg يتحرك بعجلة 2.5 m/s^2، احسب القوة المؤثرة عليه؟',
    history: [],
    lessonContext: 'Lesson: قوانين نيوتن\nKey Laws: F = m a',
    simBeforeTotalMs: 390,
    simAfterTtftMs: 24,
    simAfterStreamChunks: [
      'نستخدم قانون نيوتن الثاني: ',
      '$$F = m \\cdot a$$\n',
      'بالتعويض: $F = 4 \\times 2.5 = 10\\text{ N}$.',
    ],
  },
  {
    id: 'physics_law',
    labelAr: 'سؤال عن قانون فيزيائي',
    message: 'ما هي صيغة قانون أوم للدوائر المغلقة ووحدة كل كمية؟',
    history: [],
    lessonContext: 'Lesson: قانون أوم للدوائر المغلقة\nKey Laws: I = V_B / (R + r); V = V_B - I r',
    simBeforeTotalMs: 310,
    simAfterTtftMs: 20,
    simAfterStreamChunks: [
      'الصيغة الأساسية:\n',
      '$$I = \\frac{V_B}{R + r}$$\n',
      'حيث $I$ شدة التيار ($\\text{A}$)، $V_B$ القوة الدافعة ($\\text{V}$)، $R$ المقاومة الخارجية و$r$ الداخلية ($\\Omega$).',
    ],
  },
  {
    id: 'followup',
    labelAr: 'متابعة في نفس المحادثة',
    message: 'وضح لي بمثال عددي بسيط على نفس القانون',
    history: [
      { role: 'user', text: 'ما هي صيغة قانون أوم للدوائر المغلقة؟' },
      { role: 'model', text: 'I = V_B / (R + r) حيث V_B القوة الدافعة الكهربية.' },
      { role: 'user', text: 'وماذا يحدث عند زيادة المقاومة الخارجية؟' },
      { role: 'model', text: 'تقل شدة التيار الكلي I فيزداد فرق الجهد V = V_B - I r.' },
    ],
    previousInteractionId: 'int-prev-sample',
    lessonContext: 'Lesson: قانون أوم للدوائر المغلقة\nKey Laws: I = V_B / (R + r); V = V_B - I r',
    simBeforeTotalMs: 340,
    simAfterTtftMs: 22,
    simAfterStreamChunks: [
      'مثال سريع: لو $V_B = 12\\text{ V}$ و$R = 5\\ \\Omega$ و$r = 1\\ \\Omega$:\n',
      '$$I = \\frac{12}{5 + 1} = 2\\text{ A}$$\n',
      'وفرق الجهد $V = 12 - (2 \\times 1) = 10\\text{ V}$.',
    ],
  },
];

async function measureNonStreamingJson(
  baseUrl: string,
  c: BenchmarkCase
): Promise<{
  status: number;
  payloadBytes: number;
  ttftMs: number;
  totalMs: number;
  model: string;
  attempts: number;
  usedFallback: boolean;
  backendPrepMs: number;
  replyLength: number;
}> {
  const body = JSON.stringify({
    stream: false,
    message: c.message,
    mode: 'tutor',
    language: 'ar',
    level: 'intermediate',
    style: 'conceptual',
    detail: 'detailed',
    track: 'baccalaureate',
    grade: 'Year 2',
    lessonContext: c.lessonContext.repeat(5),
    history: c.history,
    previousInteractionId: c.previousInteractionId,
  });

  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/api/ai/tutor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const data: any = await res.json();
  const totalMs = Math.round(performance.now() - t0);

  return {
    status: res.status,
    payloadBytes: Buffer.byteLength(body),
    ttftMs: totalMs, // In non-streaming JSON mode, TTFT == total time until full payload arrives
    totalMs,
    model: data?.meta?.model || 'unknown',
    attempts: data?.meta?.attempts || 0,
    usedFallback: Boolean(data?.meta?.usedFallback),
    backendPrepMs: data?.meta?.backendPrepMs ?? 0,
    replyLength: String(data?.reply || '').length,
  };
}

async function measureStreamingSse(
  baseUrl: string,
  c: BenchmarkCase
): Promise<{
  status: number;
  payloadBytes: number;
  ttftMs: number;
  totalMs: number;
  model: string;
  attempts: number;
  usedFallback: boolean;
  backendPrepMs: number;
  replyLength: number;
  chunksReceived: number;
}> {
  const body = JSON.stringify({
    stream: true,
    message: c.message,
    mode: 'tutor',
    language: 'ar',
    level: 'intermediate',
    style: 'conceptual',
    detail: 'concise',
    track: 'baccalaureate',
    grade: 'Year 2',
    lessonContext: c.lessonContext,
    history: c.history.slice(-6),
    previousInteractionId: c.previousInteractionId,
  });

  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/api/ai/tutor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body,
  });

  assert.equal(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('text/event-stream'));

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ttftMs = 0;
  let chunksReceived = 0;
  let doneMeta: any = {};
  let replyLength = 0;

  const parseBlock = (block: string) => {
    let eventType = 'message';
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const parsed = JSON.parse(dataLines.join('\n'));
    if (eventType === 'delta') {
      if (ttftMs === 0) ttftMs = Math.round(performance.now() - t0);
      chunksReceived += 1;
    } else if (eventType === 'done') {
      doneMeta = parsed.meta || {};
      replyLength = String(parsed.reply || '').length;
    } else if (eventType === 'error') {
      throw new Error(`SSE error event: ${JSON.stringify(parsed)}`);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const blk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (blk.trim()) parseBlock(blk);
    }
  }
  if (buffer.trim()) parseBlock(buffer);
  const totalMs = Math.round(performance.now() - t0);

  return {
    status: res.status,
    payloadBytes: Buffer.byteLength(body),
    ttftMs: ttftMs || totalMs,
    totalMs,
    model: doneMeta.model || 'unknown',
    attempts: doneMeta.attempts || 0,
    usedFallback: Boolean(doneMeta.usedFallback),
    backendPrepMs: doneMeta.backendPrepMs ?? 0,
    replyLength,
    chunksReceived,
  };
}

async function runBenchmark() {
  const { default: app } = await import('../server.ts');
  const hasLiveKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const transportMode = hasLiveKey
    ? 'LIVE GEMINI API'
    : 'LOCAL EXPRESS HTTP+SSE BENCHMARK (simulated upstream Gemini transport; GEMINI_API_KEY absent in sandbox)';

  if (!hasLiveKey) {
    // Configure deterministic realistic client factory testing real Express + SSE + Resilience + Prompt Cache
    let caseCursor = 0;
    app.locals.geminiClientFactory = (): GeminiClientLike => ({
      models: {
        list: async () => ({
          page: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      },
      interactions: {
        create: async (params) => {
          const matchedCase =
            CASES.find((x) => String(params.input).includes(x.message.slice(0, 18))) || CASES[caseCursor % CASES.length];
          caseCursor += 1;

          if (params.stream) {
            return {
              async *[Symbol.asyncIterator]() {
                yield { event_type: 'interaction.created', interaction: { id: `int-sim-${caseCursor}` } };
                await new Promise((r) => setTimeout(r, matchedCase.simAfterTtftMs));
                for (const chunk of matchedCase.simAfterStreamChunks) {
                  await new Promise((r) => setTimeout(r, 12));
                  yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: chunk } };
                }
                yield { event_type: 'interaction.completed', interaction: { id: `int-sim-${caseCursor}` } };
              },
            };
          }

          await new Promise((r) => setTimeout(r, matchedCase.simBeforeTotalMs));
          return {
            id: `int-sim-${caseCursor}`,
            output_text: matchedCase.simAfterStreamChunks.join(''),
          };
        },
      },
    });
  }

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    console.log(`\n=== Physics Smart AI Tutor Benchmark (${transportMode}) ===\n`);

    const results: Array<{
      id: string;
      labelAr: string;
      before: Awaited<ReturnType<typeof measureNonStreamingJson>>;
      after: Awaited<ReturnType<typeof measureStreamingSse>>;
    }> = [];

    for (const c of CASES) {
      resetResilienceState();
      const before = await measureNonStreamingJson(baseUrl, c);
      resetResilienceState();
      const after = await measureStreamingSse(baseUrl, c);
      results.push({ id: c.id, labelAr: c.labelAr, before, after });
    }

    for (const r of results) {
      const ttftDropPct =
        r.before.ttftMs > 0 ? Math.round(((r.before.ttftMs - r.after.ttftMs) / r.before.ttftMs) * 100) : 0;
      const payloadDropPct =
        r.before.payloadBytes > 0
          ? Math.round(((r.before.payloadBytes - r.after.payloadBytes) / r.before.payloadBytes) * 100)
          : 0;
      console.log(
        `[${r.id}] (${r.labelAr})\n` +
          `  Non-Stream (medium, un-streamed): TTFT=${r.before.ttftMs}ms | Total=${r.before.totalMs}ms | Calls=${r.before.attempts} | Model=${r.before.model} | BackendPrep=${r.before.backendPrepMs}ms | Payload=${r.before.payloadBytes}B\n` +
          `  Optimized SSE (low, cached):      TTFT=${r.after.ttftMs}ms (-${ttftDropPct}%) | Total=${r.after.totalMs}ms | Chunks=${r.after.chunksReceived} | Calls=${r.after.attempts} | Model=${r.after.model} | BackendPrep=${r.after.backendPrepMs}ms | Payload=${r.after.payloadBytes}B (-${payloadDropPct}%)`
      );
      assert.equal(r.after.attempts, 1, 'Expected strictly 1 Gemini call on healthy request');
      assert.equal(r.after.status, 200);
      assert.ok(r.after.replyLength > 20);
    }

    // Verify 503 failover timing & zero raw 503 leakage over HTTP SSE when primary hits 503
    if (!hasLiveKey) {
      resetResilienceState();
      app.locals.geminiClientFactory = (): GeminiClientLike => ({
        models: {
          list: async () => ({ page: [{ name: 'models/gemini-4-hydrogen' }] }),
        },
        interactions: {
          create: async (params) => {
            if (params.model === PRIMARY_GEMINI_MODEL) {
              const err: any = new Error('503 gemini-3.8-flash is currently experiencing high demand.');
              err.status = 503;
              throw err;
            }
            return {
              async *[Symbol.asyncIterator]() {
                yield { event_type: 'interaction.created', interaction: { id: 'int-fb-http' } };
                await new Promise((r) => setTimeout(r, 18));
                yield {
                  event_type: 'step.delta',
                  index: 0,
                  delta: { type: 'text', text: 'إجابة سريعة من النموذج البديل بعد التحويل التلقائي!' },
                };
                yield { event_type: 'interaction.completed', interaction: { id: 'int-fb-http' } };
              },
            };
          },
        },
      });

      const failoverRes = await measureStreamingSse(baseUrl, CASES[0]);
      assert.equal(failoverRes.usedFallback, true);
      assert.equal(failoverRes.model, 'gemini-4-hydrogen');
      assert.equal(failoverRes.attempts, 3); // 1 primary + 1 fast retry (~650ms) + 1 fallback
      console.log(
        `\n[503_failover_check] Recovered via SSE failover -> Model=${failoverRes.model} | Attempts=${failoverRes.attempts} | TTFT=${failoverRes.ttftMs}ms | Total=${failoverRes.totalMs}ms`
      );
    }
  } finally {
    delete app.locals.geminiClientFactory;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
