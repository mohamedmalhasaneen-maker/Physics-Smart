import { sanitizeSecret, GeminiClientLike } from './geminiResilience.ts';

export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_PDF_MIME = 'application/pdf' as const;
export const MAX_INLINE_RAW_BYTES = 3 * 1024 * 1024; // 3 MB raw -> ~4.0 MB base64 JSON (< 4.5 MB Vercel limit)
export const MAX_BINARY_UPLOAD_BYTES = Math.floor(4.2 * 1024 * 1024); // 4.2 MB raw binary (< 4.5 MB Vercel limit)
export const MAX_PDF_PAGES = 50;

export type SupportedAttachmentMime = (typeof ALLOWED_IMAGE_MIMES)[number] | typeof ALLOWED_PDF_MIME;

export type AttachmentErrorCode =
  | 'UNSUPPORTED_FILE_TYPE'
  | 'EMPTY_FILE'
  | 'CORRUPTED_FILE'
  | 'PDF_ENCRYPTED'
  | 'PDF_TOO_MANY_PAGES'
  | 'FILE_TOO_LARGE'
  | 'UPLOAD_FAILED'
  | 'INVALID_FILE_URI';

export class AttachmentValidationError extends Error {
  public readonly status: number;
  public readonly errorCode: AttachmentErrorCode;
  public readonly stage: string;
  public readonly retryable: boolean;

  constructor(
    message: string,
    opts: { status: number; errorCode: AttachmentErrorCode; stage: string; retryable?: boolean }
  ) {
    super(message);
    this.name = 'AttachmentValidationError';
    this.status = opts.status;
    this.errorCode = opts.errorCode;
    this.stage = opts.stage;
    this.retryable = opts.retryable ?? false;
  }
}

export interface IncomingAttachmentPayload {
  mimeType?: string;
  data?: string;
  uri?: string;
  fileName?: string;
  name?: string;
  pageCount?: number;
  sizeBytes?: number;
}

export interface ValidatedAttachment {
  kind: 'image' | 'document';
  mimeType: SupportedAttachmentMime;
  name: string;
  sizeBytes: number;
  pageCount?: number;
  base64?: string;
  buffer?: Buffer;
  uri?: string;
  fileName?: string;
}

export function logAttachmentStage(info: {
  stage: string;
  fn: string;
  fileKind: 'image' | 'document' | 'unknown';
  mimeType: string;
  sizeBytes: number;
  pageCount?: number;
  transport?: 'inline_base64' | 'files_api_uri' | 'binary_upload';
  httpStatus?: number;
  errorCode?: string | null;
  summary?: string;
}) {
  console.log(
    '[AttachmentPipeline]',
    JSON.stringify({
      stage: info.stage,
      fn: info.fn,
      fileKind: info.fileKind,
      mimeType: info.mimeType || 'unknown',
      sizeBytes: info.sizeBytes,
      pageCount: info.pageCount ?? null,
      transport: info.transport ?? null,
      httpStatus: info.httpStatus ?? null,
      errorCode: info.errorCode ?? null,
      summary: info.summary ? sanitizeSecret(info.summary).slice(0, 220) : null,
    })
  );
}

export function normalizeDeclaredMime(rawMime?: string): string {
  const cleaned = String(rawMime || '').toLowerCase().split(';')[0].trim();
  if (cleaned === 'image/jpg' || cleaned === 'image/pjpeg') return 'image/jpeg';
  return cleaned;
}

export function detectMagicMimeType(buffer: Buffer): SupportedAttachmentMime | null {
  if (!buffer || buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // PDF: %PDF- within leading 1024 bytes
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  if (head.includes('%PDF-')) {
    return 'application/pdf';
  }

  return null;
}

export function inspectPdfBuffer(buffer: Buffer): {
  validHeader: boolean;
  encrypted: boolean;
  pageCount: number;
} {
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) {
    return { validHeader: false, encrypted: false, pageCount: 0 };
  }

  const content = buffer.toString('latin1');
  const encrypted = /\/Encrypt\b/.test(content);

  // Count individual /Type /Page dictionaries (excluding /Type /Pages)
  const pageMatches = content.match(/\/Type\s*\/Page\b(?!s)/g);
  const pageCount = pageMatches && pageMatches.length > 0 ? pageMatches.length : 1;

  return { validHeader: true, encrypted, pageCount };
}

export function isValidGeminiFileUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'generativelanguage.googleapis.com' &&
      parsed.pathname.includes('/files/')
    );
  } catch {
    return false;
  }
}

export function validateBinaryBufferAttachment(
  buffer: Buffer,
  opts: { declaredMime?: string; name?: string; maxBytes?: number; fn?: string } = {}
): ValidatedAttachment {
  const fn = opts.fn || 'validateBinaryBufferAttachment';
  const maxBytes = opts.maxBytes ?? MAX_BINARY_UPLOAD_BYTES;
  const declared = normalizeDeclaredMime(opts.declaredMime);
  const name = String(opts.name || 'attachment').slice(0, 120);

  if (!buffer || buffer.length === 0) {
    logAttachmentStage({
      stage: 'backend_validate',
      fn,
      fileKind: declared === 'application/pdf' ? 'document' : 'image',
      mimeType: declared,
      sizeBytes: 0,
      httpStatus: 400,
      errorCode: 'EMPTY_FILE',
      summary: 'Uploaded buffer is empty (0 bytes).',
    });
    throw new AttachmentValidationError('الملف المرفق فارغ (0 بايت). يرجى اختيار ملف صالح.', {
      status: 400,
      errorCode: 'EMPTY_FILE',
      stage: 'backend_validate',
    });
  }

  if (buffer.length > maxBytes) {
    const limitMb = (maxBytes / (1024 * 1024)).toFixed(1);
    logAttachmentStage({
      stage: 'backend_validate',
      fn,
      fileKind: declared === 'application/pdf' ? 'document' : 'image',
      mimeType: declared,
      sizeBytes: buffer.length,
      httpStatus: 413,
      errorCode: 'FILE_TOO_LARGE',
      summary: `Buffer ${buffer.length} bytes exceeds max ${maxBytes} bytes.`,
    });
    throw new AttachmentValidationError(
      `حجم الملف (${(buffer.length / (1024 * 1024)).toFixed(2)} ميجابايت) يتجاوز الحد المسموح (${limitMb} ميجابايت).`,
      {
        status: 413,
        errorCode: 'FILE_TOO_LARGE',
        stage: 'backend_validate',
      }
    );
  }

  const detectedMime = detectMagicMimeType(buffer);
  if (!detectedMime) {
    const isAllowedDeclared =
      declared === ALLOWED_PDF_MIME || (ALLOWED_IMAGE_MIMES as readonly string[]).includes(declared);
    const errorCode: AttachmentErrorCode = isAllowedDeclared ? 'CORRUPTED_FILE' : 'UNSUPPORTED_FILE_TYPE';
    const message = isAllowedDeclared
      ? 'الملف تالف أو لا يطابق صيغة الصور/PDF القياسية. يرجى التأكد من سلامة الملف وإعادة اختياره.'
      : 'نوع الملف غير مدعوم. الصيغ المدعومة فقط هي: JPG وJPEG وPNG وWEBP وPDF.';
    logAttachmentStage({
      stage: 'backend_validate',
      fn,
      fileKind: declared === 'application/pdf' ? 'document' : 'unknown',
      mimeType: declared || 'unknown',
      sizeBytes: buffer.length,
      httpStatus: 400,
      errorCode,
      summary: 'Magic bytes did not match JPG, PNG, WEBP, or PDF.',
    });
    throw new AttachmentValidationError(message, {
      status: 400,
      errorCode,
      stage: 'backend_validate',
    });
  }

  // If declared MIME is present and differs in family (e.g., claims PDF but is PNG or vice versa), use detected magic MIME safely if both are supported, else reject mismatch from unsupported types
  const finalMime: SupportedAttachmentMime = detectedMime;

  if (finalMime === 'application/pdf') {
    const pdfInfo = inspectPdfBuffer(buffer);
    if (!pdfInfo.validHeader) {
      throw new AttachmentValidationError('ملف PDF تالف أو غير صالح.', {
        status: 400,
        errorCode: 'CORRUPTED_FILE',
        stage: 'backend_validate_pdf',
      });
    }
    if (pdfInfo.encrypted) {
      logAttachmentStage({
        stage: 'backend_validate_pdf',
        fn,
        fileKind: 'document',
        mimeType: finalMime,
        sizeBytes: buffer.length,
        httpStatus: 422,
        errorCode: 'PDF_ENCRYPTED',
        summary: 'PDF contains /Encrypt dictionary (password protected).',
      });
      throw new AttachmentValidationError(
        'ملف الـ PDF محمي بكلمة مرور أو مشفّر ولا يمكن قراءته. يرجى إزالة كلمة المرور ثم إعادة رفعه.',
        {
          status: 422,
          errorCode: 'PDF_ENCRYPTED',
          stage: 'backend_validate_pdf',
        }
      );
    }
    if (pdfInfo.pageCount > MAX_PDF_PAGES) {
      logAttachmentStage({
        stage: 'backend_validate_pdf',
        fn,
        fileKind: 'document',
        mimeType: finalMime,
        sizeBytes: buffer.length,
        pageCount: pdfInfo.pageCount,
        httpStatus: 413,
        errorCode: 'PDF_TOO_MANY_PAGES',
        summary: `PDF page count ${pdfInfo.pageCount} exceeds limit ${MAX_PDF_PAGES}.`,
      });
      throw new AttachmentValidationError(
        `عدد صفحات ملف PDF (${pdfInfo.pageCount} صفحة) يتجاوز الحد الأقصى المسموح (${MAX_PDF_PAGES} صفحة).`,
        {
          status: 413,
          errorCode: 'PDF_TOO_MANY_PAGES',
          stage: 'backend_validate_pdf',
        }
      );
    }

    return {
      kind: 'document',
      mimeType: 'application/pdf',
      name,
      sizeBytes: buffer.length,
      pageCount: pdfInfo.pageCount,
      buffer,
    };
  }

  return {
    kind: 'image',
    mimeType: finalMime,
    name,
    sizeBytes: buffer.length,
    buffer,
  };
}

export function validateAndDecodeAttachment(
  attachment?: IncomingAttachmentPayload | null
): ValidatedAttachment | null {
  if (!attachment) return null;

  const declared = normalizeDeclaredMime(attachment.mimeType);
  const name = String(attachment.name || 'attachment').slice(0, 120);

  // Case A: Pre-uploaded Gemini Files API URI
  if (typeof attachment.uri === 'string' && attachment.uri.trim().length > 0) {
    const uri = attachment.uri.trim();
    if (!isValidGeminiFileUri(uri)) {
      logAttachmentStage({
        stage: 'backend_validate_uri',
        fn: 'validateAndDecodeAttachment',
        fileKind: declared === 'application/pdf' ? 'document' : 'image',
        mimeType: declared,
        sizeBytes: attachment.sizeBytes || 0,
        httpStatus: 400,
        errorCode: 'INVALID_FILE_URI',
        summary: 'Attachment URI host/path validation failed.',
      });
      throw new AttachmentValidationError('مرجع الملف غير صالح. يرجى إعادة رفع الملف.', {
        status: 400,
        errorCode: 'INVALID_FILE_URI',
        stage: 'backend_validate_uri',
      });
    }

    if (declared !== ALLOWED_PDF_MIME && !(ALLOWED_IMAGE_MIMES as readonly string[]).includes(declared)) {
      throw new AttachmentValidationError(
        'نوع الملف غير مدعوم. الصيغ المدعومة فقط هي: JPG وJPEG وPNG وWEBP وPDF.',
        {
          status: 400,
          errorCode: 'UNSUPPORTED_FILE_TYPE',
          stage: 'backend_validate_uri',
        }
      );
    }

    const kind = declared === ALLOWED_PDF_MIME ? 'document' : 'image';
    logAttachmentStage({
      stage: 'backend_validated',
      fn: 'validateAndDecodeAttachment',
      fileKind: kind,
      mimeType: declared,
      sizeBytes: attachment.sizeBytes || 0,
      pageCount: attachment.pageCount,
      transport: 'files_api_uri',
    });

    return {
      kind,
      mimeType: declared as SupportedAttachmentMime,
      name,
      sizeBytes: attachment.sizeBytes || 0,
      pageCount: attachment.pageCount,
      uri,
      fileName: attachment.fileName,
    };
  }

  // Case B: Inline Base64 data payload
  if (typeof attachment.data !== 'string' || attachment.data.trim().length === 0) {
    logAttachmentStage({
      stage: 'backend_validate_base64',
      fn: 'validateAndDecodeAttachment',
      fileKind: declared === 'application/pdf' ? 'document' : 'image',
      mimeType: declared,
      sizeBytes: 0,
      httpStatus: 400,
      errorCode: 'EMPTY_FILE',
      summary: 'Attachment missing both data and uri.',
    });
    throw new AttachmentValidationError('الملف المرفق فارغ أو تالف. يرجى اختيار الملف مرة أخرى.', {
      status: 400,
      errorCode: 'EMPTY_FILE',
      stage: 'backend_validate_base64',
    });
  }

  // Strip optional data URL prefix if caller included it
  let cleanBase64 = attachment.data.trim();
  const dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.*)$/s);
  if (dataUrlMatch) {
    cleanBase64 = dataUrlMatch[2].trim();
  }
  cleanBase64 = cleanBase64.replace(/\s+/g, '');

  if (!cleanBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
    logAttachmentStage({
      stage: 'backend_validate_base64',
      fn: 'validateAndDecodeAttachment',
      fileKind: declared === 'application/pdf' ? 'document' : 'image',
      mimeType: declared,
      sizeBytes: cleanBase64.length,
      httpStatus: 400,
      errorCode: 'CORRUPTED_FILE',
      summary: 'Invalid base64 encoding in attachment payload.',
    });
    throw new AttachmentValidationError('بيانات المرفق تالفة أو غير مكتملة. يرجى إعادة اختيار الملف.', {
      status: 400,
      errorCode: 'CORRUPTED_FILE',
      stage: 'backend_validate_base64',
    });
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  const validated = validateBinaryBufferAttachment(buffer, {
    declaredMime: declared,
    name,
    maxBytes: MAX_INLINE_RAW_BYTES,
    fn: 'validateAndDecodeAttachment',
  });

  logAttachmentStage({
    stage: 'backend_validated',
    fn: 'validateAndDecodeAttachment',
    fileKind: validated.kind,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    pageCount: validated.pageCount,
    transport: 'inline_base64',
  });

  return {
    ...validated,
    base64: cleanBase64,
  };
}

/**
 * Builds an official @google/genai InteractionsInput Content_2 block
 * (`ImageContent` or `DocumentContent`) compatible with `ai.interactions.create({ api_version: 'v1beta' })`.
 */
export function buildInteractionAttachmentPart(validated: ValidatedAttachment | null) {
  if (!validated) return null;

  if (validated.uri) {
    return {
      type: validated.kind,
      uri: validated.uri,
      mime_type: validated.mimeType,
    };
  }

  if (!validated.base64) {
    throw new AttachmentValidationError('تعذر تجهيز بيانات المرفق للإرسال.', {
      status: 400,
      errorCode: 'CORRUPTED_FILE',
      stage: 'build_interaction_part',
    });
  }

  return {
    type: validated.kind,
    data: validated.base64,
    mime_type: validated.mimeType,
  };
}

export async function uploadAttachmentToGeminiFiles(
  ai: GeminiClientLike,
  validated: ValidatedAttachment
): Promise<{ uri: string; fileName: string; mimeType: SupportedAttachmentMime; expiresAt?: string }> {
  if (!ai.files?.upload) {
    throw new AttachmentValidationError('خدمة رفع الملفات المؤقتة غير متاحة حاليًا.', {
      status: 502,
      errorCode: 'UPLOAD_FAILED',
      stage: 'gemini_files_upload',
      retryable: true,
    });
  }
  if (!validated.buffer) {
    throw new AttachmentValidationError('بيانات الملف غير صالحة للرفع.', {
      status: 400,
      errorCode: 'EMPTY_FILE',
      stage: 'gemini_files_upload',
    });
  }

  const blob = new Blob([new Uint8Array(validated.buffer)], { type: validated.mimeType });
  const safeDisplayName = validated.name.replace(/[^\w.\-()\s\u0600-\u06FF]/g, '_').slice(0, 80) || 'physics-attachment';

  let uploaded: any = await ai.files.upload({
    file: blob,
    config: {
      mimeType: validated.mimeType,
      displayName: safeDisplayName,
    },
  });

  // Poll briefly if file state is still PROCESSING
  if (uploaded?.name && uploaded?.state === 'PROCESSING' && ai.files.get) {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 700));
      const checked = await ai.files.get({ name: uploaded.name });
      uploaded = checked;
      if (checked?.state !== 'PROCESSING') break;
    }
  }

  if (uploaded?.state === 'FAILED' || !uploaded?.uri) {
    throw new AttachmentValidationError('تعذر تجهيز الملف على خادم Gemini Files API. يرجى المحاولة مرة أخرى.', {
      status: 502,
      errorCode: 'UPLOAD_FAILED',
      stage: 'gemini_files_upload',
      retryable: true,
    });
  }

  logAttachmentStage({
    stage: 'gemini_files_uploaded',
    fn: 'uploadAttachmentToGeminiFiles',
    fileKind: validated.kind,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    pageCount: validated.pageCount,
    transport: 'files_api_uri',
    httpStatus: 200,
  });

  return {
    uri: String(uploaded.uri),
    fileName: String(uploaded.name || ''),
    mimeType: validated.mimeType,
    expiresAt: uploaded.expirationTime ? String(uploaded.expirationTime) : undefined,
  };
}

export async function deleteGeminiFileSafe(ai: GeminiClientLike, fileName?: string | null): Promise<boolean> {
  if (!fileName || !ai.files?.delete) return false;
  const cleaned = String(fileName).trim();
  if (!/^files\/[A-Za-z0-9_-]+$/.test(cleaned)) return false;
  try {
    await ai.files.delete({ name: cleaned });
    return true;
  } catch {
    return false;
  }
}
