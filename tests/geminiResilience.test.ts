import assert from 'node:assert/strict';
import {
  BACKOFF_SCHEDULE_MS,
  computeBackoffDelayMs,
  executeGeminiInteractionWithResilience,
  GeminiClientLike,
  GeminiResilienceError,
  PRIMARY_COOLDOWN_MS,
  PRIMARY_GEMINI_MODEL,
  resetResilienceState,
  sanitizeSecret,
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

async function runTests() {
  const logs: Array<Record<string, unknown>> = [];

  // Test 0: Exponential Backoff Schedule (1s, 2s, 4s + jitter)
  {
    assert.deepEqual([...BACKOFF_SCHEDULE_MS], [1000, 2000, 4000]);
    const d0 = computeBackoffDelayMs(0, BACKOFF_SCHEDULE_MS, 250);
    const d1 = computeBackoffDelayMs(1, BACKOFF_SCHEDULE_MS, 250);
    const d2 = computeBackoffDelayMs(2, BACKOFF_SCHEDULE_MS, 250);
    assert.ok(d0 >= 1000 && d0 < 1250, `Expected 1000..1249, got ${d0}`);
    assert.ok(d1 >= 2000 && d1 < 2250, `Expected 2000..2249, got ${d1}`);
    assert.ok(d2 >= 4000 && d2 < 4250, `Expected 4000..4249, got ${d2}`);
    console.log('✓ Test 0 passed: Exponential backoff 1s, 2s, 4s + jitter');
  }

  // Test 1: Primary model works normally
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
    console.log('✓ Test 1 passed: Primary model (gemini-3.8-flash) normal response');
  }

  // Test 2: Primary model returns 503 transiently, retries with backoff, then succeeds
  {
    resetResilienceState();
    const sleeps: number[] = [];
    let attemptCount = 0;
    const client: GeminiClientLike = {
      interactions: {
        create: async (params) => {
          attemptCount += 1;
          assert.equal(params.model, PRIMARY_GEMINI_MODEL);
          if (attemptCount <= 2) {
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
    assert.equal(res.meta.attempts, 3); // 1 initial + 2 retries
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps[0] >= 1000 && sleeps[0] < 1100);
    assert.ok(sleeps[1] >= 2000 && sleeps[1] < 2100);
    console.log('✓ Test 2 passed: Primary 503 recovered on retry with 1s/2s backoff + jitter');
  }

  // Test 3: Primary model fails 503 after max 2 retries -> verifies & switches to fallback Flash model
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
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, // deprecated, must be skipped
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
          assert.ok(String(params.input).includes('Previous Conversation Context'));
          return { id: 'int-fb-1', output_text: 'إجابة مفصلة باللهجة المصرية من النموذج البديل' };
        },
      },
    };

    const res = await executeGeminiInteractionWithResilience(
      {
        input: 'Follow-up question',
        inputWithoutPreviousId: 'Previous Conversation Context:\nStudent: Hi\n\nCurrent Student Message:\nFollow-up question',
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
    assert.equal(res.meta.attempts, 4); // 3 on primary + 1 on fallback
    assert.equal(res.meta.primaryError?.category, 'high_demand');
    assert.equal(res.meta.fallbackError, null);
    assert.deepEqual(attemptedModels, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-4-hydrogen']);
    assert.deepEqual(verifiedModels, ['gemini-4-hydrogen']);
    console.log('✓ Test 3 passed: Primary 503 exhausted -> verified active Flash fallback succeeded preserving context');
  }

  // Test 4: Both primary and fallback models temporarily unavailable -> safe error without key leaks
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
    assert.equal(caught.primaryError?.category, 'high_demand');
    assert.equal(caught.fallbackError?.category, 'high_demand');
    assert.ok(!caught.message.includes('503'), 'Student message must not expose raw 503');
    assert.ok(!JSON.stringify(caught).includes('AIzaSyDummySecretKey'), 'Must sanitize API keys');
    console.log('✓ Test 4 passed: Both models unavailable -> clean separated error & sanitized secrets');
  }

  // Test 5: Consecutive student messages during cooldown & automatic recovery back to primary
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

    // Turn 1: Primary fails 503 -> fails over to gemini-4-hydrogen -> sets primary cooldown
    const r1 = await executeGeminiInteractionWithResilience(
      { input: 'سؤال 1' },
      { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {}, nowFn: () => fakeNow }
    );
    assert.equal(r1.meta.model, 'gemini-4-hydrogen');

    // Turn 2 (5s later, inside cooldown): Immediately uses fallback without wasting primary calls
    fakeNow += 5_000;
    const r2 = await executeGeminiInteractionWithResilience(
      { input: 'سؤال 2 متابعة' },
      { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {}, nowFn: () => fakeNow }
    );
    assert.equal(r2.meta.model, 'gemini-4-hydrogen');
    assert.equal(r2.meta.attempts, 1);

    // Turn 3 (after cooldown expires and primary recovers): Automatically returns to gemini-3.8-flash!
    primaryHealthy = true;
    fakeNow += PRIMARY_COOLDOWN_MS + 1_000;
    const r3 = await executeGeminiInteractionWithResilience(
      { input: 'سؤال 3' },
      { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {}, nowFn: () => fakeNow }
    );
    assert.equal(r3.meta.model, PRIMARY_GEMINI_MODEL);
    assert.equal(r3.meta.usedFallback, false);
    console.log('✓ Test 5 passed: Consecutive messages + automatic recovery to gemini-3.8-flash');
  }

  // Test 6: Non-retryable Auth / API key error -> ZERO retries, ZERO fallback
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
    console.log('✓ Test 6 passed: Auth error does not retry or trigger fallback');
  }

  // Test 7: Timeout on medium thinking_level automatically steps down to 'low' on retry/fallback
  {
    resetResilienceState();
    const seenThinkingLevels: Array<string | undefined> = [];
    let count = 0;
    const client: GeminiClientLike = {
      interactions: {
        create: async (params) => {
          count += 1;
          seenThinkingLevels.push(params.generation_config?.thinking_level);
          if (count === 1) {
            const err: any = new Error('Request timed out: TimeoutError: The operation was aborted due to timeout');
            err.name = 'APIConnectionTimeoutError';
            throw err;
          }
          return { id: 'int-to-1', output_text: 'تم الرد بنجاح بعد خفض مستوى التفكير' };
        },
      },
    };
    const res = await executeGeminiInteractionWithResilience(
      { input: 'مسألة طويلة', thinking_level: 'medium' },
      { endpoint: '/api/ai/tutor', clientFactory: () => client, sleepFn: async () => {} }
    );
    assert.equal(res.meta.attempts, 2);
    assert.deepEqual(seenThinkingLevels, ['medium', 'low']);
    console.log('✓ Test 7 passed: Timeout automatically steps down thinking_level to low and recovers');
  }

  console.log('\nALL 8 RESILIENCE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
