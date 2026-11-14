import { Language } from '../types/physics';

export interface PreparedAttachment {
  name: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  data?: string; // Base64 without data: prefix (used for inline images / small PDF fallback)
  uri?: string; // Gemini Files API URI (used for PDFs so follow-up turns avoid re-uploading)
  fileName?: string; // Gemini Files API resource name (e.g. files/abc123) for cleanup
  sizeBytes: number;
  pageCount?: number;
  expiresAt?: string;
}

export class ClientAttachmentError extends Error {
  public readonly errorCode: string;
  public readonly stage: string;

  constructor(message: string, errorCode: string, stage: string) {
    super(message);
    this.name = 'ClientAttachmentError';
    this.errorCode = errorCode;
    this.stage = stage;
  }
}

export const MAX_IMAGE_INPUT_BYTES = 12 * 1024 * 1024; // Accept large camera photos up to 12 MB and optimize cleanly
export const MAX_INLINE_BYTES = 2.5 * 1024 * 1024; // ~3.33 MB base64 JSON (< 4.5 MB Vercel limit)
export const MAX_PDF_UPLOAD_BYTES = Math.floor(4.2 * 1024 * 1024); // 4.2 MB binary (< 4.5 MB Vercel limit)
export const MAX_PDF_PAGES = 50;

function logClientStage(info: {
  stage: string;
  fn: string;
  fileKind: 'image' | 'document' | 'unknown';
  mimeType: string;
  sizeBytes: number;
  pageCount?: number;
  httpStatus?: number;
  errorCode?: string;
  summary?: string;
}) {
  console.info('[AttachmentClient]', {
    stage: info.stage,
    fn: info.fn,
    fileKind: info.fileKind,
    mimeType: info.mimeType || 'unknown',
    sizeBytes: info.sizeBytes,
    pageCount: info.pageCount ?? null,
    httpStatus: info.httpStatus ?? null,
    errorCode: info.errorCode ?? null,
    summary: info.summary ?? null,
  });
}

function detectMagicMime(bytes: Uint8Array): PreparedAttachment['mimeType'] | null {
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  // PDF: %PDF- within first 1024 bytes
  const headLen = Math.min(bytes.length, 1024);
  let headStr = '';
  for (let i = 0; i < headLen; i++) {
    headStr += String.fromCharCode(bytes[i]);
  }
  if (headStr.includes('%PDF-')) {
    return 'application/pdf';
  }
  return null;
}

function inspectPdfBytes(bytes: Uint8Array): { encrypted: boolean; pageCount: number } {
  const decoder = new TextDecoder('latin1');
  const text = decoder.decode(bytes);
  const encrypted = /\/Encrypt\b/.test(text);
  const matches = text.match(/\/Type\s*\/Page\b(?!s)/g);
  const pageCount = matches && matches.length > 0 ? matches.length : 1;
  return { encrypted, pageCount };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

async function decodeAndOptimizeImage(
  arrayBuf: ArrayBuffer,
  detectedMime: 'image/jpeg' | 'image/png' | 'image/webp',
  lang: Language
): Promise<{ mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; sizeBytes: number }> {
  // Always verify the browser can actually decode the image pixels (catches truncated/corrupt files)
  const blob = new Blob([arrayBuf], { type: detectedMime });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });

    if (!img.naturalWidth || !img.naturalHeight) {
      throw new ClientAttachmentError(
        lang === 'ar'
          ? 'الصورة تالفة أو أبعادها غير صالحة. يرجى اختيار صورة أخرى.'
          : 'Image appears corrupted or has invalid dimensions.',
        'CORRUPTED_FILE',
        'frontend_decode_image'
      );
    }

    // If image already fits safely under inline Vercel payload limit, keep 100% original bytes untouched!
    if (arrayBuf.byteLength <= MAX_INLINE_BYTES) {
      return {
        mimeType: detectedMime,
        data: arrayBufferToBase64(arrayBuf),
        sizeBytes: arrayBuf.byteLength,
      };
    }

    // For large camera photos (> 2.5 MB), resize cleanly keeping sharp readability for equations & graphs
    const maxDim = 2200;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    let targetW = Math.max(1, Math.round(img.naturalWidth * scale));
    let targetH = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new ClientAttachmentError(
        lang === 'ar' ? 'تعذر تجهيز الصورة الكبيرة في المتصفح.' : 'Could not process large image in browser.',
        'CORRUPTED_FILE',
        'frontend_optimize_image'
      );
    }

    const outputMime: 'image/jpeg' | 'image/webp' = detectedMime === 'image/webp' ? 'image/webp' : 'image/jpeg';
    let bestBlob: Blob | null = null;

    for (const quality of [0.91, 0.84, 0.76]) {
      canvas.width = targetW;
      canvas.height = targetH;
      if (outputMime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
      } else {
        ctx.clearRect(0, 0, targetW, targetH);
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const candidate = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), outputMime, quality)
      );
      if (candidate && candidate.size <= MAX_INLINE_BYTES) {
        bestBlob = candidate;
        break;
      }
      targetW = Math.max(800, Math.round(targetW * 0.82));
      targetH = Math.max(800, Math.round(targetH * 0.82));
      if (candidate) bestBlob = candidate;
    }

    if (!bestBlob || bestBlob.size > MAX_INLINE_BYTES) {
      throw new ClientAttachmentError(
        lang === 'ar'
          ? 'حجم الصورة ما زال أكبر من الحد المسموح حتى بعد التحسين. يرجى اختيار صورة أصغر.'
          : 'Image exceeds size limit even after optimization.',
        'FILE_TOO_LARGE',
        'frontend_optimize_image'
      );
    }

    const buf = await bestBlob.arrayBuffer();
    return {
      mimeType: outputMime,
      data: arrayBufferToBase64(buf),
      sizeBytes: bestBlob.size,
    };
  } catch (err: any) {
    if (err instanceof ClientAttachmentError) throw err;
    throw new ClientAttachmentError(
      lang === 'ar'
        ? 'الصورة تالفة أو غير قابلة للقراءة. تأكد من سلامة الصورة ثم حاول مجددًا.'
        : 'Image file is corrupted or unreadable.',
      'CORRUPTED_FILE',
      'frontend_decode_image'
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareAttachmentFile(
  file: File,
  lang: Language,
  opts: { useFilesApiForPdf?: boolean } = { useFilesApiForPdf: true }
): Promise<PreparedAttachment> {
  const rawName = file.name || 'attachment';
  const declaredMime = (file.type || '').toLowerCase();

  logClientStage({
    stage: 'frontend_selected',
    fn: 'prepareAttachmentFile',
    fileKind: declaredMime.includes('pdf') || rawName.toLowerCase().endsWith('.pdf') ? 'document' : 'image',
    mimeType: declaredMime,
    sizeBytes: file.size,
  });

  if (file.size === 0) {
    throw new ClientAttachmentError(
      lang === 'ar' ? 'الملف المختار فارغ (0 بايت). يرجى اختيار ملف صالح.' : 'Selected file is empty (0 bytes).',
      'EMPTY_FILE',
      'frontend_validate'
    );
  }

  let arrayBuf: ArrayBuffer;
  try {
    arrayBuf = await file.arrayBuffer();
  } catch {
    throw new ClientAttachmentError(
      lang === 'ar' ? 'تعذر قراءة الملف من الجهاز. تأكد من أن الملف غير تالف.' : 'Failed to read file from device.',
      'CORRUPTED_FILE',
      'frontend_read'
    );
  }

  const bytes = new Uint8Array(arrayBuf);
  const detectedMime = detectMagicMime(bytes);
  const lowerName = rawName.toLowerCase();
  const hasAllowedExtension =
    /\.(jpg|jpeg|png|webp|pdf)$/.test(lowerName) ||
    ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'].includes(declaredMime);

  if (!detectedMime) {
    if (hasAllowedExtension) {
      throw new ClientAttachmentError(
        lang === 'ar'
          ? 'الملف المختار تالف أو لا يطابق صيغة الصور/PDF الحقيقية. يرجى اختيار ملف آخر سليم.'
          : 'File appears corrupted or its contents do not match a valid JPG/PNG/WEBP/PDF.',
        'CORRUPTED_FILE',
        'frontend_magic_check'
      );
    }
    throw new ClientAttachmentError(
      lang === 'ar'
        ? 'نوع الملف غير مدعوم. الصيغ المسموحة فقط: صور (JPG, JPEG, PNG, WEBP) أو ملفات PDF.'
        : 'Unsupported file type. Only JPG, JPEG, PNG, WEBP, and PDF files are supported.',
      'UNSUPPORTED_FILE_TYPE',
      'frontend_magic_check'
    );
  }

  // Handle Images
  if (detectedMime !== 'application/pdf') {
    if (file.size > MAX_IMAGE_INPUT_BYTES) {
      throw new ClientAttachmentError(
        lang === 'ar'
          ? 'حجم الصورة يتجاوز الحد الأقصى المسموح (12 ميجابايت).'
          : 'Image size exceeds the 12 MB maximum limit.',
        'FILE_TOO_LARGE',
        'frontend_size_check'
      );
    }

    const prepared = await decodeAndOptimizeImage(arrayBuf, detectedMime, lang);
    logClientStage({
      stage: 'frontend_image_ready',
      fn: 'prepareAttachmentFile',
      fileKind: 'image',
      mimeType: prepared.mimeType,
      sizeBytes: prepared.sizeBytes,
    });
    return {
      name: rawName,
      mimeType: prepared.mimeType,
      data: prepared.data,
      sizeBytes: prepared.sizeBytes,
    };
  }

  // Handle PDF Documents
  if (bytes.byteLength > MAX_PDF_UPLOAD_BYTES) {
    throw new ClientAttachmentError(
      lang === 'ar'
        ? `حجم ملف PDF (${(bytes.byteLength / (1024 * 1024)).toFixed(2)} ميجابايت) يتجاوز الحد الأقصى المسموح على الخادم (4.2 ميجابايت).`
        : `PDF size (${(bytes.byteLength / (1024 * 1024)).toFixed(2)} MB) exceeds the 4.2 MB server limit.`,
      'FILE_TOO_LARGE',
      'frontend_pdf_size_check'
    );
  }

  const pdfMeta = inspectPdfBytes(bytes);
  if (pdfMeta.encrypted) {
    throw new ClientAttachmentError(
      lang === 'ar'
        ? 'ملف الـ PDF محمي بكلمة مرور أو مشفّر. يرجى إزالة كلمة المرور وحفظه مجددًا ثم رفعه.'
        : 'This PDF is password-protected or encrypted. Please remove password protection first.',
      'PDF_ENCRYPTED',
      'frontend_pdf_inspect'
    );
  }
  if (pdfMeta.pageCount > MAX_PDF_PAGES) {
    throw new ClientAttachmentError(
      lang === 'ar'
        ? `عدد صفحات ملف PDF (${pdfMeta.pageCount} صفحة) يتجاوز الحد المسموح (${MAX_PDF_PAGES} صفحة).`
        : `PDF page count (${pdfMeta.pageCount}) exceeds the ${MAX_PDF_PAGES}-page limit.`,
      'PDF_TOO_MANY_PAGES',
      'frontend_pdf_inspect'
    );
  }

  // Prefer binary upload to Gemini Files API so large/multi-page PDFs aren't inflated by +33% base64 and can be reused across follow-up turns
  if (opts.useFilesApiForPdf !== false) {
    try {
      const uploadRes = await fetch('/api/ai/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'x-file-mime': 'application/pdf',
          'x-file-name': encodeURIComponent(rawName),
        },
        body: bytes,
      });

      const respType = uploadRes.headers.get('content-type') || '';
      const rawText = await uploadRes.text();
      let payload: any = {};
      if (respType.includes('application/json') && rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          payload = {};
        }
      }

      if (uploadRes.ok && payload?.uri) {
        logClientStage({
          stage: 'frontend_pdf_files_api_ready',
          fn: 'prepareAttachmentFile',
          fileKind: 'document',
          mimeType: 'application/pdf',
          sizeBytes: bytes.byteLength,
          pageCount: payload.pageCount || pdfMeta.pageCount,
          httpStatus: uploadRes.status,
        });
        return {
          name: rawName,
          mimeType: 'application/pdf',
          uri: payload.uri,
          fileName: payload.fileName,
          sizeBytes: bytes.byteLength,
          pageCount: payload.pageCount || pdfMeta.pageCount,
          expiresAt: payload.expiresAt || undefined,
        };
      }

      // Hard non-fallback rejections (auth, encryption, size, corrupt)
      if (
        uploadRes.status === 401 ||
        uploadRes.status === 403 ||
        uploadRes.status === 413 ||
        uploadRes.status === 422 ||
        payload?.errorCode === 'PDF_ENCRYPTED' ||
        payload?.errorCode === 'CORRUPTED_FILE' ||
        payload?.errorCode === 'UNSUPPORTED_FILE_TYPE'
      ) {
        throw new ClientAttachmentError(
          payload?.error ||
            (lang === 'ar' ? 'تعذر معالجة ملف PDF المرفق.' : 'Failed to process PDF attachment.'),
          payload?.errorCode || 'UPLOAD_FAILED',
          'frontend_pdf_upload'
        );
      }

      logClientStage({
        stage: 'frontend_pdf_upload_fallback',
        fn: 'prepareAttachmentFile',
        fileKind: 'document',
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        httpStatus: uploadRes.status,
        errorCode: payload?.errorCode || 'UPLOAD_FAILED',
        summary: payload?.error || rawText.slice(0, 120),
      });
    } catch (err: any) {
      if (err instanceof ClientAttachmentError) throw err;
      logClientStage({
        stage: 'frontend_pdf_upload_network_fallback',
        fn: 'prepareAttachmentFile',
        fileKind: 'document',
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        errorCode: 'UPLOAD_FAILED',
        summary: String(err?.message || 'Upload error'),
      });
    }
  }

  // Fallback to inline Base64 ONLY if <= 2.5 MB (fits safely inside Vercel JSON limit)
  if (bytes.byteLength <= MAX_INLINE_BYTES) {
    return {
      name: rawName,
      mimeType: 'application/pdf',
      data: arrayBufferToBase64(arrayBuf),
      sizeBytes: bytes.byteLength,
      pageCount: pdfMeta.pageCount,
    };
  }

  throw new ClientAttachmentError(
    lang === 'ar'
      ? 'فشل رفع ملف PDF إلى الخادم المؤقت. يرجى الضغط على إعادة المحاولة أو اختيار ملف أصغر من 2.5 ميجابايت.'
      : 'Failed to upload PDF file. Please retry or use a file under 2.5 MB.',
    'UPLOAD_FAILED',
    'frontend_pdf_upload'
  );
}

export function cleanupUploadedAttachment(fileName?: string) {
  if (!fileName || !fileName.startsWith('files/')) return;
  void fetch(`/api/ai/files?fileName=${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
  }).catch(() => {});
}
