import assert from 'node:assert/strict';
import http from 'node:http';
import {
  BACKOFF_SCHEDULE_MS,
  classifyGeminiError,
  computeBackoffDelayMs,
  executeGeminiInteractionStreamWithResilience,
  executeGeminiInteractionWithResilience,
  GeminiClientLike,
  GeminiResilienceError,
  getConfiguredGeminiKey,
  MAX_PRIMARY_RETRIES,
  PRIMARY_COOLDOWN_MS,
  PRIMARY_GEMINI_MODEL,
  resetResilienceState,
  sanitizeSecret,
  verifyGeminiAuthAndConnectivity,
} from '../server/geminiResilience.ts';

function makeSdkError(status: number, message: string, sdkStatus = 'UNAVAILABLE') {
  const err: any = new Error(message);
  err.status = status;
  err.data$ = {
    httpMeta: { response: { status } },
    error: { code: status, status: sdkStatus, message },
  };
  return err;
}

function makeFakeStream(chunks: string[], delayPerChunkMs = 0, id = 'int-stream-1'): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { event_type: 'interaction.created', interaction: { id } };
      for (const text of chunks) {
        if (delayPerChunkMs > 0) {
          await new Promise((r) => setTimeout(r, delayPerChunkMs));
        }
        yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text } };
      }
      yield { event_type: 'interaction.completed', interaction: { id } };
    },
  };
}

async function runTests() {
  const logs: Array<Record<string, unknown>> = [];

  // Test 0: Fast Backoff Schedule ([650, 1400] + jitter) and MAX_PRIMARY_RETRIES = 1
  {
    assert.deepEqual([...BACKOFF_SCHEDULE_MS], [650, 1400]);
    assert.equal(MAX_PRIMARY_RETRIES, 1);
    const d0 = computeBackoffDelayMs(0, BACKOFF_SCHEDULE_MS, 150);
    const d1 = computeBackoffDelayMs(1, BACKOFF_SCHEDULE_MS, 150);
    assert.ok(d0 >= 650 && d0 < 800, `Expected 650..799, got ${d0}`);
    assert.ok(d1 >= 1400 && d1 < 1550, `Expected 1400..1549, got ${d1}`);
    console.log('✓ Test 0 passed: Fast backoff 650ms / 1400ms + jitter & MAX_PRIMARY_RETRIES=1');
  }

  // Test 1: Primary model works normally (1 call only)
  {
    resetResilienceState();
    const calls: string[] = [];
    const client: GeminiClientLike = {
      interactions: {
        create: async (params) => {
          calls.push(params.model);
          return { id: 'int-1', output_text: 'أهلاً يا بطل! الحركة التوافقية البسيطة هي...' };
        },
      },
    };
    const res = await executeGeminiInteractionWithResilience(
      { input: 'اشرح الحركة التوافقية', system_instruction: 'Egyptian Physics Tutor' },
      { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {}, onLog: (e) => logs.push(e) }
    );
    assert.equal(res.meta.model, PRIMARY_GEMINI_MODEL);
    assert.equal(res.meta.usedFallback, false);
    assert.equal(res.meta.attempts, 1);
    assert.deepEqual(calls, ['gemini-3.8-flash']);
    console.log('✓ Test 1 passed: Primary model (gemini-3.8-flash) single-call normal response');
  }

  // Test 2: Primary model returns 503 once, retries once with fast ~650ms backoff, then succeeds
  {
    resetResilienceState();
    const sleeps: number[] = [];
    let attemptCount = 0;
    const client: GeminiClientLike = {
      interactions: {
        create: async (params) => {
          attemptCount += 1;
          assert.equal(params.model, PRIMARY_GEMINI_MODEL);
          if (attemptCount === 1) {
            throw makeSdkError(503, '503 gemini-3.8-flash is currently experiencing high demand.');
          }
          return { id: 'int-2', output_text: 'القانون التاني لنيوتن: $F = ma$' };
        },
      },
    };
    const res = await executeGeminiInteractionWithResilience(
      { input: 'مسألة نيوتن' },
      {
        endpoint: '/api/ai/tutor',
        clientFactory: () => client,
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
        jitterMaxMs: 100,
        onLog: (e) => logs.push(e),
      }
    );
    assert.equal(res.meta.model, PRIMARY_GEMINI_MODEL);
    assert.equal(res.meta.usedFallback, false);
    assert.equal(res.meta.attempts, 2); // 1 initial + 1 fast retry
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 650 && sleeps[0] < 750);
    console.log('✓ Test 2 passed: Primary 503 recovered on 1 fast retry (~650ms)');
  }

  // Test 3: Primary model fails 503 twice (1 initial + 1 retry) -> immediately switches to verified Flash fallback
  {
    resetResilienceState();
    const attemptedModels: string[] = [];
    const verifiedModels: string[] = [];
    const client: GeminiClientLike = {
      models: {
        list: async () => ({
          page: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      },
      interactions: {
        create: async (params) => {
          attemptedModels.push(params.model);
          if (params.model === PRIMARY_GEMINI_MODEL) {
            throw makeSdkError(503, '503 gemini-3.8-flash is currently experiencing high demand.');
          }
          verifiedModels.push(params.model);
          assert.equal(params.system_instruction, 'Egyptian Physics Tutor');
          assert.ok(String(params.input).includes('Previous Conversation'));
          return { id: 'int-fb-1', output_text: 'إجابة مفصلة باللهجة المصرية من النموذج البديل' };
        },
      },
    };

    const res = await executeGeminiInteractionWithResilience(
      {
        input: 'Follow-up question',
        inputWithoutPreviousId: 'Previous Conversation:\nStudent: Hi\n\nStudent:\nFollow-up question',
        previous_interaction_id: 'int-prev-1',
        system_instruction: 'Egyptian Physics Tutor',
      },
      {
        endpoint: '/api/ai/tutor',
        clientFactory: () => client,
        sleepFn: async () => {},
        onLog: (e) => logs.push(e),
      }
    );

    assert.equal(res.meta.usedFallback, true);
    assert.equal(res.meta.model, 'gemini-4-hydrogen');
    assert.equal(res.meta.attempts, 3); // 2 on primary (initial + 1 retry) + 1 on fallback
    assert.equal(res.meta.primaryError?.category, 'high_demand');
    assert.equal(res.meta.fallbackError, null);
    assert.deepEqual(attemptedModels, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-4-hydrogen']);
    assert.deepEqual(verifiedModels, ['gemini-4-hydrogen']);
    console.log('✓ Test 3 passed: Primary 503 (1+1) -> fast failover to verified Flash fallback preserving context');
  }

  // Test 4: Both primary and fallback unavailable -> safe error & sanitized secrets
  {
    resetResilienceState();
    const client: GeminiClientLike = {
      models: {
        list: async () => ({
          page: [{ name: 'models/gemini-4-hydrogen' }, { name: 'models/gemini-3.1-flash-lite' }],
        }),
      },
      interactions: {
        create: async (params) => {
          throw makeSdkError(503, `${params.model} unavailable with AIzaSyDummySecretKey1234567890abcdef`);
        },
      },
    };

    let caught: any = null;
    try {
      await executeGeminiInteractionWithResilience(
        { input: 'سؤال فيزياء' },
        { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {}, onLog: (e) => logs.push(e) }
      );
    } catch (e) {
      caught = e;
    }

    assert.ok(caught instanceof GeminiResilienceError);
    assert.equal(caught.httpStatus, 503);
    assert.equal(caught.errorCode, 'HIGH_DEMAND');
    assert.equal(caught.retryable, true);
    assert.ok(!caught.message.includes('503'), 'Student message must not expose raw 503');
    assert.ok(!JSON.stringify(caught).includes('AIzaSyDummySecretKey'), 'Must sanitize API keys');
    console.log('✓ Test 4 passed: Both models unavailable -> safe student error & sanitized secrets');
  }

  // Test 5: Circuit breaker during cooldown & automatic recovery back to primary
  {
    resetResilienceState();
    let fakeNow = 1_000_000;
    let primaryHealthy = false;
    const modelsUsedPerTurn: string[] = [];

    const client: GeminiClientLike = {
      models: {
        list: async () => ({ page: [{ name: 'models/gemini-4-hydrogen' }] }),
      },
      interactions: {
        create: async (params) => {
          if (params.model === PRIMARY_GEMINI_MODEL && !primaryHealthy) {
            throw makeSdkError(503, '503 high demand');
          }
          modelsUsedPerTurn.push(params.model);
          return { id: `int-${modelsUsedPerTurn.length}`, output_text: `Reply from ${params.model}` };
        },
      },
    };

    const r1 = await executeGeminiInteractionWithResilience(
      { input: 'سؤال 1' },
      { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {}, nowFn: () => fakeNow }
    );
    assert.equal(r1.meta.model, 'gemini-4-hydrogen');

    fakeNow += 5_000;
    const r2 = await executeGeminiInteractionWithResilience(
      { input: 'سؤال 2 متابعة' },
      { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {}, nowFn: () => fakeNow }
    );
    assert.equal(r2.meta.model, 'gemini-4-hydrogen');
    assert.equal(r2.meta.attempts, 1);

    primaryHealthy = true;
    fakeNow += PRIMARY_COOLDOWN_MS + 1_000;
    const r3 = await executeGeminiInteractionWithResilience(
      { input: 'سؤال 3' },
      { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {}, nowFn: () => fakeNow }
    );
    assert.equal(r3.meta.model, PRIMARY_GEMINI_MODEL);
    assert.equal(r3.meta.usedFallback, false);
    console.log('✓ Test 5 passed: Circuit breaker cooldown + automatic recovery to gemini-3.8-flash');
  }

  // Test 6: Non-retryable Auth error -> ZERO retries, ZERO fallback
  {
    resetResilienceState();
    let calls = 0;
    const client: GeminiClientLike = {
      interactions: {
        create: async () => {
          calls += 1;
          throw makeSdkError(403, 'PERMISSION_DENIED: API_KEY_INVALID', 'PERMISSION_DENIED');
        },
      },
    };
    let caught: any = null;
    try {
      await executeGeminiInteractionWithResilience(
        { input: 'test' },
        { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {} }
      );
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof GeminiResilienceError);
    assert.equal(caught.errorCode, 'AUTH_ERROR');
    assert.equal(caught.retryable, false);
    assert.equal(calls, 1);
    assert.equal(sanitizeSecret('Error with AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123'), 'Error with [REDACTED_KEY]');
    console.log('✓ Test 6 passed: Auth error aborts immediately with 0 retries');
  }

  // Test 7: Streaming TTFT watchdog timeout triggers fast retry then failover to fallback Flash stream
  {
    resetResilienceState();
    const seenModels: string[] = [];
    const seenThinking: Array<string | undefined> = [];
    const client: GeminiClientLike = {
      models: {
        list: async () => ({ page: [{ name: 'models/gemini-4-hydrogen' }] }),
      },
      interactions: {
        create: async (params, reqOpts) => {
          seenModels.push(params.model);
          seenThinking.push(params.generation_config?.thinking_level);
          if (params.model === PRIMARY_GEMINI_MODEL) {
            // Simulate hung primary model that stalls past TTFT watchdog until AbortSignal fires
            return {
              async *[Symbol.asyncIterator]() {
                await new Promise((_resolve, reject) => {
                  const sig: AbortSignal | undefined = reqOpts?.signal;
                  if (sig?.aborted) {
                    reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                    return;
                  }
                  sig?.addEventListener('abort', () => {
                    reject(Object.assign(new Error('Aborted due to TTFT timeout'), { name: 'AbortError' }));
                  });
                });
              },
            };
          }
          return makeFakeStream(['أهلاً ', 'بك! ', '$F = ma$'], 5, 'int-stream-fb');
        },
      },
    };

    const deltas: string[] = [];
    let firstTokenInfo: any = null;
    const res = await executeGeminiInteractionStreamWithResilience(
      { input: 'اشرح قانون نيوتن الثاني', thinking_level: 'medium' },
      {
        onFirstToken: (info) => {
          firstTokenInfo = info;
        },
        onDelta: (chunk) => deltas.push(chunk),
      },
      {
        endpoint: '/api/ai/tutor',
        clientFactory: () => client,
        firstTokenTimeoutMs: 40,
        timeoutMs: 1000,
        sleepFn: async () => {},
        onLog: (e) => logs.push(e),
      }
    );

    assert.equal(res.meta.usedFallback, true);
    assert.equal(res.meta.model, 'gemini-4-hydrogen');
    assert.equal(res.interactionId, 'int-stream-fb');
    assert.deepEqual(deltas, ['أهلاً ', 'بك! ', '$F = ma$']);
    assert.equal(res.text, 'أهلاً بك! $F = ma$');
    assert.ok(firstTokenInfo && firstTokenInfo.model === 'gemini-4-hydrogen');
    // Primary attempt 1: medium, primary retry: stepped down to low, fallback: forced low
    assert.deepEqual(seenModels, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-4-hydrogen']);
    assert.deepEqual(seenThinking, ['medium', 'low', 'low']);
    console.log('✓ Test 7 passed: Streaming TTFT watchdog aborts stalled primary & streams from fallback Flash');
  }

  // Test 8: Normal streaming delivers incremental chunks in single Gemini call
  {
    resetResilienceState();
    const calls: string[] = [];
    const client: GeminiClientLike = {
      interactions: {
        create: async (params) => {
          calls.push(params.model);
          assert.equal(params.stream, true);
          return makeFakeStream(['السرعة المتجهة ', 'تساوي ', '$v = \\frac{d}{t}$'], 2, 'int-stream-ok');
        },
      },
    };
    const chunks: string[] = [];
    const res = await executeGeminiInteractionStreamWithResilience(
      { input: 'ما هي السرعة؟', thinking_level: 'low' },
      { onDelta: (c) => chunks.push(c) },
      { endpoint: '/api/ai/tutor', clientFactory: () => client }
    );
    assert.equal(calls.length, 1);
    assert.equal(res.meta.attempts, 1);
    assert.equal(res.meta.model, PRIMARY_GEMINI_MODEL);
    assert.deepEqual(chunks, ['السرعة المتجهة ', 'تساوي ', '$v = \\frac{d}{t}$']);
    console.log('✓ Test 8 passed: Normal SSE streaming completes in 1 Gemini call');
  }

  // Test 9: 403 Permission Denied / API Restriction aborts immediately with PERMISSION_DENIED (separate from 401 AUTH_ERROR)
  {
    resetResilienceState();
    let calls = 0;
    const client: GeminiClientLike = {
      interactions: {
        create: async () => {
          calls += 1;
          throw makeSdkError(
            403,
            'PERMISSION_DENIED: Generative Language API has not been used in project 12345 before or it is disabled.',
            'PERMISSION_DENIED'
          );
        },
      },
    };
    let caught: any = null;
    try {
      await executeGeminiInteractionWithResilience(
        { input: 'test' },
        { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {} }
      );
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof GeminiResilienceError);
    assert.equal(caught.errorCode, 'PERMISSION_DENIED');
    assert.equal(caught.httpStatus, 403);
    assert.equal(caught.retryable, false);
    assert.equal(calls, 1);

    const c401 = classifyGeminiError(makeSdkError(401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED'));
    assert.equal(c401.category, 'auth_error');
    assert.equal(c401.httpStatus, 401);
    console.log('✓ Test 9 passed: 403 PERMISSION_DENIED classified distinctly from 401 AUTH_ERROR with 0 retries');
  }

  // Test 10: getConfiguredGeminiKey strictly relies on GEMINI_API_KEY and ignores placeholders / secondary env names
  {
    const prevGemini = process.env.GEMINI_API_KEY;
    const prevGoogle = process.env.GOOGLE_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = 'should-not-be-used-key';
      assert.deepEqual(getConfiguredGeminiKey(), { apiKey: null, envVarName: null });

      process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY';
      assert.deepEqual(getConfiguredGeminiKey(), { apiKey: null, envVarName: null });

      process.env.GEMINI_API_KEY = '  AIzaSyRealLookingTestKey000111222  ';
      assert.deepEqual(getConfiguredGeminiKey(), {
        apiKey: 'AIzaSyRealLookingTestKey000111222',
        envVarName: 'GEMINI_API_KEY',
      });
    } finally {
      if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
      if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = prevGoogle;
    }
    console.log('✓ Test 10 passed: Unified GEMINI_API_KEY resolution ignores placeholders and non-standard env vars');
  }

  // Test 11: verifyGeminiAuthAndConnectivity covers all 4 verification stages cleanly
  {
    const prevGemini = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      const missingReport = await verifyGeminiAuthAndConnectivity();
      assert.equal(missingReport.ok, false);
      assert.equal(missingReport.keyPresent, false);
      assert.equal(missingReport.httpStatus, 401);
      assert.equal(missingReport.errorCode, 'API_KEY_MISSING');

      const okReport = await verifyGeminiAuthAndConnectivity(() => ({
        interactions: {
          create: async () => ({ id: 'auth-probe-1', output_text: 'OK' }),
        },
      }));
      assert.equal(okReport.ok, true);
      assert.equal(okReport.keyPresent, true);
      assert.equal(okReport.authenticated, true);
      assert.equal(okReport.modelAvailable, true);
      assert.equal(okReport.responseValid, true);
      assert.equal(okReport.httpStatus, 200);

      const badKeyReport = await verifyGeminiAuthAndConnectivity(() => ({
        interactions: {
          create: async () => {
            throw makeSdkError(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT');
          },
        },
      }));
      assert.equal(badKeyReport.ok, false);
      assert.equal(badKeyReport.authenticated, false);
      assert.equal(badKeyReport.httpStatus, 401);
      assert.equal(badKeyReport.errorCode, 'AUTH_ERROR');

      const permReport = await verifyGeminiAuthAndConnectivity(() => ({
        interactions: {
          create: async () => {
            throw makeSdkError(403, 'PERMISSION_DENIED: Referrer blocked', 'PERMISSION_DENIED');
          },
        },
      }));
      assert.equal(permReport.ok, false);
      assert.equal(permReport.authenticated, false);
      assert.equal(permReport.httpStatus, 403);
      assert.equal(permReport.errorCode, 'PERMISSION_DENIED');

      const notFoundReport = await verifyGeminiAuthAndConnectivity(() => ({
        interactions: {
          create: async () => {
            throw makeSdkError(404, 'Requested model not found', 'NOT_FOUND');
          },
        },
      }));
      assert.equal(notFoundReport.ok, false);
      assert.equal(notFoundReport.authenticated, true);
      assert.equal(notFoundReport.modelAvailable, false);
      assert.equal(notFoundReport.httpStatus, 404);
      assert.equal(notFoundReport.errorCode, 'MODEL_UNAVAILABLE');
    } finally {
      if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
    }
    console.log('✓ Test 11 passed: verifyGeminiAuthAndConnectivity distinguishes missing/invalid/restricted/404/200');
  }

  // Test 12: Protected /api/ai/auth-check rejects unauthenticated requests in production and works with diagnostic token
  {
    const prevListen = process.env.DISABLE_AUTO_LISTEN;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDiagToken = process.env.AI_DIAGNOSTIC_TOKEN;
    process.env.DISABLE_AUTO_LISTEN = 'true';
    process.env.NODE_ENV = 'production';
    process.env.AI_DIAGNOSTIC_TOKEN = 'test-diag-secret-token';

    const { default: app } = await import('../server.ts');
    app.locals.geminiClientFactory = () => ({
      interactions: {
        create: async () => ({ id: 'probe-ok', output_text: 'OK' }),
      },
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const unauthRes = await fetch(`${baseUrl}/api/ai/auth-check`);
      assert.equal(unauthRes.status, 401);
      const unauthBody: any = await unauthRes.json();
      assert.equal(unauthBody.errorCode, 'AUTH_REQUIRED');

      const authRes = await fetch(`${baseUrl}/api/ai/auth-check?fresh=1`, {
        headers: { 'x-diagnostic-token': 'test-diag-secret-token' },
      });
      assert.equal(authRes.status, 200);
      const authBody: any = await authRes.json();
      assert.equal(authBody.ok, true);
      assert.equal(authBody.responseValid, true);
      assert.equal(authBody.model, PRIMARY_GEMINI_MODEL);
    } finally {
      delete app.locals.geminiClientFactory;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (prevListen === undefined) delete process.env.DISABLE_AUTO_LISTEN;
      else process.env.DISABLE_AUTO_LISTEN = prevListen;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevDiagToken === undefined) delete process.env.AI_DIAGNOSTIC_TOKEN;
      else process.env.AI_DIAGNOSTIC_TOKEN = prevDiagToken;
    }
    console.log('✓ Test 12 passed: /api/ai/auth-check requires auth in production and executes safely when authorized');
  }

  // Test 13: Real Attachment validation + Interactions API formatting (ImageContent / DocumentContent)
  {
    const {
      AttachmentValidationError,
      buildInteractionAttachmentPart,
      validateAndDecodeAttachment,
    } = await import('../server/attachmentHandler.ts');

    // Real minimal PNG header + payload
    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const validJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF', 'latin1');

    const partJpg = buildInteractionAttachmentPart(
      validateAndDecodeAttachment({ mimeType: 'image/jpg', data: validJpg.toString('base64') })
    );
    assert.deepEqual(partJpg, {
      type: 'image',
      mime_type: 'image/jpeg',
      data: validJpg.toString('base64'),
    });

    const partPng = buildInteractionAttachmentPart(
      validateAndDecodeAttachment({ mimeType: 'image/png', data: validPng.toString('base64') })
    );
    assert.deepEqual(partPng, {
      type: 'image',
      mime_type: 'image/png',
      data: validPng.toString('base64'),
    });

    const partPdf = buildInteractionAttachmentPart(
      validateAndDecodeAttachment({ mimeType: 'application/pdf', data: validPdf.toString('base64') })
    );
    assert.deepEqual(partPdf, {
      type: 'document',
      mime_type: 'application/pdf',
      data: validPdf.toString('base64'),
    });

    // Unsupported file type (fake EXE bytes)
    let caught: any = null;
    try {
      validateAndDecodeAttachment({
        mimeType: 'application/x-msdownload',
        data: Buffer.from('MZfakeExecutable').toString('base64'),
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AttachmentValidationError);
    assert.equal(caught?.errorCode, 'UNSUPPORTED_FILE_TYPE');
    assert.equal(caught?.status, 400);

    // Oversized file (> 3 MB raw inside inline JSON)
    try {
      const bigBuf = Buffer.concat([validPng, Buffer.alloc(3.2 * 1024 * 1024)]);
      validateAndDecodeAttachment({ mimeType: 'image/png', data: bigBuf.toString('base64') });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AttachmentValidationError);
    assert.equal(caught?.errorCode, 'FILE_TOO_LARGE');
    assert.equal(caught?.status, 413);

    console.log('✓ Test 13 passed: Real attachment magic-byte validation & v1beta ImageContent/DocumentContent formatting');
  }

  console.log('\nALL 14 RESILIENCE, AUTH, STREAMING & ATTACHMENT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
