import assert from 'node:assert/strict';
import http from 'node:http';
import {
  AttachmentValidationError,
  buildInteractionAttachmentPart,
  detectMagicMimeType,
  inspectPdfBuffer,
  MAX_BINARY_UPLOAD_BYTES,
  MAX_INLINE_RAW_BYTES,
  uploadAttachmentToGeminiFiles,
  validateAndDecodeAttachment,
  validateBinaryBufferAttachment,
} from '../server/attachmentHandler.ts';
import { GeminiClientLike, PRIMARY_GEMINI_MODEL, resetResilienceState } from '../server/geminiResilience.ts';

// Minimal valid 1x1 PNG (67 bytes)
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Minimal valid JPEG SOI + APP0 header + EOI
const VALID_JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
  0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03, 0xff, 0xd9,
]);

// Minimal valid WEBP header
const VALID_WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

// Minimal valid multi-page (3 pages) Physics PDF buffer
function buildMultiPagePhysicsPdf(pages: number): Buffer {
  const pageObjects: string[] = [];
  const kidsRefs: string[] = [];
  for (let i = 0; i < pages; i++) {
    const objId = 3 + i;
    kidsRefs.push(`${objId} 0 R`);
    pageObjects.push(
      `${objId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objId + pages} 0 R >>\nendobj\n`
    );
  }
  const contentObjects: string[] = [];
  for (let i = 0; i < pages; i++) {
    const objId = 3 + pages + i;
    const body = `BT /F1 14 Tf 72 720 Td (Page ${i + 1}: F = ma, Ohm's Law V = IR) Tj ET`;
    contentObjects.push(`${objId} 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`);
  }

  const pdfText =
    `%PDF-1.4\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Count ${pages} /Kids [${kidsRefs.join(' ')}] >>\nendobj\n` +
    pageObjects.join('') +
    contentObjects.join('') +
    `%%EOF\n`;

  return Buffer.from(pdfText, 'latin1');
}

const VALID_3_PAGE_PDF = buildMultiPagePhysicsPdf(3);
const ENCRYPTED_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n3 0 obj\n<< /Filter /Standard /V 2 /Encrypt 3 0 R >>\nendobj\n%%EOF',
  'latin1'
);

function makeFakeStream(chunks: string[], id = 'int-attach-stream-1'): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { event_type: 'interaction.created', interaction: { id } };
      for (const text of chunks) {
        yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text } };
      }
      yield { event_type: 'interaction.completed', interaction: { id } };
    },
  };
}

async function runAttachmentTests() {
  const prevListen = process.env.DISABLE_AUTO_LISTEN;
  process.env.DISABLE_AUTO_LISTEN = 'true';
  const { default: app } = await import('../server.ts');

  try {
    // 1. Local JPG read & magic-byte validation
    {
      assert.equal(detectMagicMimeType(VALID_JPG), 'image/jpeg');
      const v = validateAndDecodeAttachment({
        name: 'circuit.JPG',
        mimeType: '', // Missing browser MIME type fallback check!
        data: VALID_JPG.toString('base64'),
      });
      assert.ok(v);
      assert.equal(v.kind, 'image');
      assert.equal(v.mimeType, 'image/jpeg');
      const part = buildInteractionAttachmentPart(v);
      assert.deepEqual(part, {
        type: 'image',
        mime_type: 'image/jpeg',
        data: VALID_JPG.toString('base64'),
      });
      console.log('✓ Test 1 passed: Local JPG magic-byte detection (even with empty browser MIME) -> ImageContent');
    }

    // 2. Local PNG & WEBP read + validation
    {
      assert.equal(detectMagicMimeType(VALID_PNG), 'image/png');
      assert.equal(detectMagicMimeType(VALID_WEBP), 'image/webp');
      const vPng = validateBinaryBufferAttachment(VALID_PNG, { declaredMime: 'image/png', name: 'graph.png' });
      assert.equal(vPng.kind, 'image');
      assert.equal(vPng.mimeType, 'image/png');
      console.log('✓ Test 2 passed: Local PNG & WEBP magic-byte detection & buffer validation');
    }

    // 3. Local multi-page PDF read + encrypted / corrupted / unsupported / empty / size checks
    {
      assert.equal(detectMagicMimeType(VALID_3_PAGE_PDF), 'application/pdf');
      const meta = inspectPdfBuffer(VALID_3_PAGE_PDF);
      assert.equal(meta.validHeader, true);
      assert.equal(meta.encrypted, false);
      assert.equal(meta.pageCount, 3);

      const vPdf = validateBinaryBufferAttachment(VALID_3_PAGE_PDF, {
        declaredMime: 'application/pdf',
        name: 'physics-exam.pdf',
      });
      assert.equal(vPdf.kind, 'document');
      assert.equal(vPdf.pageCount, 3);

      // Encrypted PDF -> 422 PDF_ENCRYPTED
      assert.throws(
        () => validateBinaryBufferAttachment(ENCRYPTED_PDF, { declaredMime: 'application/pdf' }),
        (err: any) => err instanceof AttachmentValidationError && err.errorCode === 'PDF_ENCRYPTED' && err.status === 422
      );

      // Empty buffer -> 400 EMPTY_FILE
      assert.throws(
        () => validateBinaryBufferAttachment(Buffer.alloc(0), { declaredMime: 'image/png' }),
        (err: any) => err instanceof AttachmentValidationError && err.errorCode === 'EMPTY_FILE' && err.status === 400
      );

      // Corrupted PNG (declared image/png, garbage bytes) -> 400 CORRUPTED_FILE
      assert.throws(
        () => validateBinaryBufferAttachment(Buffer.from('NOT_A_PNG_FILE'), { declaredMime: 'image/png' }),
        (err: any) => err instanceof AttachmentValidationError && err.errorCode === 'CORRUPTED_FILE' && err.status === 400
      );

      // Disguised unsupported file (EXE bytes, non-image declared MIME) -> 400 UNSUPPORTED_FILE_TYPE
      assert.throws(
        () => validateBinaryBufferAttachment(Buffer.from('MZ\x90\x00exe'), { declaredMime: 'application/x-msdownload' }),
        (err: any) =>
          err instanceof AttachmentValidationError && err.errorCode === 'UNSUPPORTED_FILE_TYPE' && err.status === 400
      );

      // Oversized binary PDF (> 4.2 MB) -> 413 FILE_TOO_LARGE
      const hugePdf = Buffer.concat([VALID_3_PAGE_PDF, Buffer.alloc(MAX_BINARY_UPLOAD_BYTES + 100)]);
      assert.throws(
        () => validateBinaryBufferAttachment(hugePdf, { declaredMime: 'application/pdf' }),
        (err: any) => err instanceof AttachmentValidationError && err.errorCode === 'FILE_TOO_LARGE' && err.status === 413
      );

      // Oversized inline base64 (> 3 MB raw) -> 413 FILE_TOO_LARGE
      const hugeInlinePng = Buffer.concat([VALID_PNG, Buffer.alloc(MAX_INLINE_RAW_BYTES + 100)]);
      assert.throws(
        () =>
          validateAndDecodeAttachment({
            mimeType: 'image/png',
            data: hugeInlinePng.toString('base64'),
          }),
        (err: any) => err instanceof AttachmentValidationError && err.errorCode === 'FILE_TOO_LARGE' && err.status === 413
      );

      console.log('✓ Test 3 passed: Multi-page PDF + encrypted/corrupt/empty/unsupported/oversized checks');
    }

    // Spin up real Express HTTP server for Tests 4–9
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // 4. Backend Express validation with Image (without external Gemini)
      {
        // Reject corrupted image via /api/ai/tutor before Gemini is even called
        let geminiCalled = false;
        app.locals.geminiClientFactory = () => ({
          interactions: {
            create: async () => {
              geminiCalled = true;
              return { id: 'never', output_text: 'never' };
            },
          },
        });

        const badRes = await fetch(`${baseUrl}/api/ai/tutor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stream: false,
            message: 'اشرح الصورة',
            attachment: {
              mimeType: 'image/png',
              data: Buffer.from('corrupt-bytes').toString('base64'),
            },
          }),
        });
        assert.equal(badRes.status, 400);
        const badBody: any = await badRes.json();
        assert.equal(badBody.errorCode, 'CORRUPTED_FILE');
        assert.equal(badBody.source, 'backend_validation');
        assert.equal(geminiCalled, false);
        console.log('✓ Test 4 passed: Backend Express rejects corrupt image before Gemini with HTTP 400 CORRUPTED_FILE');
      }

      // 5. Backend Express /api/ai/files/upload & DELETE /api/ai/files with multi-page PDF (without external Gemini)
      {
        let uploadedBlobSize = 0;
        let deletedName = '';
        const mockFilesClient: GeminiClientLike = {
          files: {
            upload: async ({ file, config }) => {
              uploadedBlobSize = file.size;
              assert.equal(config?.mimeType, 'application/pdf');
              return {
                name: 'files/phys-pdf-123',
                uri: 'https://generativelanguage.googleapis.com/v1beta/files/phys-pdf-123',
                mimeType: 'application/pdf',
                state: 'PROCESSING',
                expirationTime: '2026-11-16T00:00:00Z',
              };
            },
            get: async ({ name }) => ({
              name,
              uri: 'https://generativelanguage.googleapis.com/v1beta/files/phys-pdf-123',
              mimeType: 'application/pdf',
              state: 'ACTIVE',
            }),
            delete: async ({ name }) => {
              deletedName = name;
              return {};
            },
          },
          interactions: {
            create: async () => ({ id: 'unused', output_text: 'ok' }),
          },
        };
        app.locals.geminiClientFactory = () => mockFilesClient;

        const upRes = await fetch(`${baseUrl}/api/ai/files/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/pdf',
            'x-file-mime': 'application/pdf',
            'x-file-name': encodeURIComponent('فيزياء-ثانوية.pdf'),
          },
          body: new Uint8Array(VALID_3_PAGE_PDF),
        });
        assert.equal(upRes.status, 200);
        const upBody: any = await upRes.json();
        assert.equal(upBody.ok, true);
        assert.equal(upBody.pageCount, 3);
        assert.equal(upBody.fileName, 'files/phys-pdf-123');
        assert.equal(uploadedBlobSize, VALID_3_PAGE_PDF.length);
        assert.ok(upBody.uri.startsWith('https://generativelanguage.googleapis.com/v1beta/files/'));

        // Reject invalid file URI on /api/ai/tutor
        const badUriRes = await fetch(`${baseUrl}/api/ai/tutor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stream: false,
            message: 'اقرأ الملف',
            attachment: {
              mimeType: 'application/pdf',
              uri: 'https://evil.example.com/files/bad',
            },
          }),
        });
        assert.equal(badUriRes.status, 400);
        const badUriBody: any = await badUriRes.json();
        assert.equal(badUriBody.errorCode, 'INVALID_FILE_URI');

        // Delete cleanup
        const delRes = await fetch(`${baseUrl}/api/ai/files?fileName=files/phys-pdf-123`, { method: 'DELETE' });
        const delBody: any = await delRes.json();
        assert.equal(delBody.ok, true);
        assert.equal(deletedName, 'files/phys-pdf-123');

        // Also test encrypted PDF rejection on upload endpoint
        const encRes = await fetch(`${baseUrl}/api/ai/files/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf', 'x-file-mime': 'application/pdf' },
          body: new Uint8Array(ENCRYPTED_PDF),
        });
        assert.equal(encRes.status, 422);
        const encBody: any = await encRes.json();
        assert.equal(encBody.errorCode, 'PDF_ENCRYPTED');

        console.log('✓ Test 5 passed: Backend /api/ai/files/upload (3-page PDF, PROCESSING->ACTIVE, URI guard, encrypted reject, DELETE cleanup)');
      }

      // 6. Gemini Interactions API v1beta payload verification with Image ONLY
      {
        resetResilienceState();
        let capturedParams: any = null;
        app.locals.geminiClientFactory = () => ({
          interactions: {
            create: async (params: any) => {
              capturedParams = params;
              return { id: 'int-img-only', output_text: 'تم تحليل الدائرة الكهربية بنجاح.' };
            },
          },
        });

        const res = await fetch(`${baseUrl}/api/ai/tutor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stream: false,
            message: '',
            attachment: {
              mimeType: 'image/png',
              data: VALID_PNG.toString('base64'),
            },
          }),
        });
        assert.equal(res.status, 200);
        const body: any = await res.json();
        assert.ok(body.reply.includes('تم تحليل'));
        assert.equal(capturedParams.api_version, 'v1beta');
        assert.equal(capturedParams.model, PRIMARY_GEMINI_MODEL);
        assert.ok(Array.isArray(capturedParams.input));
        assert.equal(capturedParams.input[0].type, 'image');
        assert.equal(capturedParams.input[0].mime_type, 'image/png');
        assert.equal(capturedParams.input[0].data, VALID_PNG.toString('base64'));
        assert.equal(capturedParams.input[1].type, 'text');
        console.log('✓ Test 6 passed: Interactions API uses api_version="v1beta" + ImageContent for image attachment');
      }

      // 7. Gemini Interactions API v1beta payload verification with PDF URI & inline PDF fallback
      {
        resetResilienceState();
        const capturedPayloads: any[] = [];
        app.locals.geminiClientFactory = () => ({
          interactions: {
            create: async (params: any) => {
              capturedPayloads.push(params);
              return { id: 'int-pdf-1', output_text: 'ملخص صفحات ملف PDF: الصفحة 1 بها $F=ma$.' };
            },
          },
        });

        // 7a. Via Gemini Files API URI
        const resUri = await fetch(`${baseUrl}/api/ai/tutor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stream: false,
            message: '',
            attachment: {
              mimeType: 'application/pdf',
              uri: 'https://generativelanguage.googleapis.com/v1beta/files/phys-pdf-123',
              fileName: 'files/phys-pdf-123',
              pageCount: 3,
            },
          }),
        });
        assert.equal(resUri.status, 200);
        assert.equal(capturedPayloads[0].api_version, 'v1beta');
        assert.deepEqual(capturedPayloads[0].input[0], {
          type: 'document',
          uri: 'https://generativelanguage.googleapis.com/v1beta/files/phys-pdf-123',
          mime_type: 'application/pdf',
        });

        // 7b. Via inline Base64 PDF fallback
        const resInline = await fetch(`${baseUrl}/api/ai/tutor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stream: false,
            message: '',
            attachment: {
              mimeType: 'application/pdf',
              data: VALID_3_PAGE_PDF.toString('base64'),
            },
          }),
        });
        assert.equal(resInline.status, 200);
        assert.deepEqual(capturedPayloads[1].input[0], {
          type: 'document',
          data: VALID_3_PAGE_PDF.toString('base64'),
          mime_type: 'application/pdf',
        });
        console.log('✓ Test 7 passed: Interactions API v1beta DocumentContent works via both Files API URI and inline Base64');
      }

      // 8. Text + Image together via SSE streaming (/api/ai/tutor)
      {
        resetResilienceState();
        let seenStreamParams: any = null;
        app.locals.geminiClientFactory = () => ({
          interactions: {
            create: async (params: any) => {
              seenStreamParams = params;
              return makeFakeStream(['المقاومة المكافئة ', 'في الشكل ', 'تساوي $6\\,\\Omega$.'], 'int-stream-img');
            },
          },
        });

        const res = await fetch(`${baseUrl}/api/ai/tutor`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, application/json',
          },
          body: JSON.stringify({
            stream: true,
            message: 'احسب المقاومة المكافئة في الدائرة الموضحة بالصورة',
            attachment: {
              mimeType: 'image/jpeg',
              data: VALID_JPG.toString('base64'),
            },
          }),
        });
        assert.equal(res.status, 200);
        const sseText = await res.text();
        assert.ok(sseText.includes('event: delta'));
        assert.ok(sseText.includes('event: done'));
        assert.ok(sseText.includes('المقاومة المكافئة'));
        assert.equal(seenStreamParams.api_version, 'v1beta');
        assert.equal(seenStreamParams.stream, true);
        assert.equal(seenStreamParams.input[0].type, 'image');
        assert.equal(seenStreamParams.input[0].mime_type, 'image/jpeg');
        assert.equal(seenStreamParams.input[1].type, 'text');
        assert.ok(seenStreamParams.input[1].text.includes('احسب المقاومة المكافئة'));
        console.log('✓ Test 8 passed: Text + Image SSE stream (/api/ai/tutor) delivers v1beta multimodal payload & chunks');
      }

      // 9. Text + Multi-page PDF together via Tutor SSE & Solver endpoint
      {
        resetResilienceState();
        let seenTutorPdfParams: any = null;
        let seenSolverPdfParams: any = null;
        let mode: 'tutor' | 'solver' = 'tutor';
        app.locals.geminiClientFactory = () => ({
          interactions: {
            create: async (params: any) => {
              if (mode === 'tutor') {
                seenTutorPdfParams = params;
                return makeFakeStream(['في الصفحة 2 ', 'نستخدم $V = I R$.'], 'int-stream-pdf');
              }
              seenSolverPdfParams = params;
              return {
                id: 'int-solver-pdf',
                output_text: JSON.stringify({
                  needsClarification: false,
                  understanding: 'حل مسألة الصفحة 2 من ملف PDF',
                  givens: [{ symbol: 'I', value: '2', unit: 'A', meaning: 'التيار' }],
                  target: 'الجهد V',
                  unitConversions: 'جاهز بوحدات SI',
                  selectedFormulaLatex: 'V = I R',
                  formulaReason: 'قانون أوم',
                  substitutionLatex: 'V = 2 \\times 5 = 10',
                  calculations: '10',
                  finalNumericValue: 10,
                  finalAnswerText: '10 V',
                  unit: 'V',
                  sanityCheck: 'القيمة منطقية',
                }),
              };
            },
          },
        });

        const tutorRes = await fetch(`${baseUrl}/api/ai/tutor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            stream: true,
            message: 'اشرح المسألة في صفحة 2 من الملف',
            attachment: {
              mimeType: 'application/pdf',
              uri: 'https://generativelanguage.googleapis.com/v1beta/files/phys-pdf-123',
              fileName: 'files/phys-pdf-123',
              pageCount: 3,
            },
          }),
        });
        assert.equal(tutorRes.status, 200);
        const tutorSse = await tutorRes.text();
        assert.ok(tutorSse.includes('في الصفحة 2'));
        assert.equal(seenTutorPdfParams.api_version, 'v1beta');
        assert.equal(seenTutorPdfParams.input[0].type, 'document');
        assert.equal(seenTutorPdfParams.input[1].type, 'text');
        assert.ok(seenTutorPdfParams.input[1].text.includes('صفحة 2'));

        mode = 'solver';
        const solverRes = await fetch(`${baseUrl}/api/ai/solver`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            problemText: 'حل المسألة في صفحة 2',
            language: 'ar',
            track: 'thanawiya',
            attachment: {
              mimeType: 'application/pdf',
              data: VALID_3_PAGE_PDF.toString('base64'),
            },
          }),
        });
        assert.equal(solverRes.status, 200);
        const solverBody: any = await solverRes.json();
        assert.equal(solverBody.solution.finalAnswerText, '10 V');
        assert.equal(seenSolverPdfParams.api_version, 'v1beta');
        assert.equal(seenSolverPdfParams.input[0].type, 'document');
        assert.equal(seenSolverPdfParams.input[0].mime_type, 'application/pdf');
        console.log('✓ Test 9 passed: Text + Multi-page PDF works cleanly in both Tutor SSE and Solver endpoints');
      }

      // Bonus check: verify uploadAttachmentToGeminiFiles helper directly
      {
        const vPdf = validateBinaryBufferAttachment(VALID_3_PAGE_PDF, {
          declaredMime: 'application/pdf',
          name: 'lab-report.pdf',
        });
        const uploaded = await uploadAttachmentToGeminiFiles(
          {
            files: {
              upload: async () => ({
                name: 'files/direct-999',
                uri: 'https://generativelanguage.googleapis.com/v1beta/files/direct-999',
                state: 'ACTIVE',
              }),
            },
            interactions: { create: async () => ({}) },
          },
          vPdf
        );
        assert.equal(uploaded.uri, 'https://generativelanguage.googleapis.com/v1beta/files/direct-999');
        console.log('✓ Bonus check passed: Direct uploadAttachmentToGeminiFiles helper');
      }
    } finally {
      delete app.locals.geminiClientFactory;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    if (prevListen === undefined) delete process.env.DISABLE_AUTO_LISTEN;
    else process.env.DISABLE_AUTO_LISTEN = prevListen;
  }

  console.log('\nALL 9 ATTACHMENT PIPELINE TESTS (+ BONUS) PASSED SUCCESSFULLY!');
}

runAttachmentTests().catch((err) => {
  console.error('Attachment pipeline test failed:', err);
  process.exit(1);
});
