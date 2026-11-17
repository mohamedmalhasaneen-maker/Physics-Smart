import type { Lesson, QuestionItem, TrackId } from '../types/physics';
import {
  DownloadPackRecord,
  DownloadScope,
  OFFLINE_MEDIA_CACHE_NAME,
  deleteDownloadPack,
  getAllDownloadPacks,
  saveContentCollection,
  saveDownloadPack,
} from './offlineDb';

export interface PackageEstimate {
  id: string;
  scope: DownloadScope;
  track: TrackId;
  grade: string;
  unitId?: string;
  lessonId?: string;
  titleAr: string;
  titleEn: string;
  lessonIds: string[];
  questionIds: string[];
  assetUrls: string[];
  totalBytes: number;
}

const activeControllers = new Map<string, { paused: boolean; cancelled: boolean; abort: AbortController }>();

function utf8Bytes(obj: unknown): number {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    return JSON.stringify(obj || '').length * 2;
  }
}

export function isCacheableAssetUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  if (typeof window !== 'undefined' && url.startsWith(window.location.origin)) return true;
  // External YouTube/watch pages cannot be meaningfully cached as HTML for offline video playback
  return /\.(pdf|png|jpe?g|webp|svg|woff2?)(\?|$)/i.test(url);
}

export function buildPackageEstimate(params: {
  scope: DownloadScope;
  lessons: Lesson[];
  questions: QuestionItem[];
  track: TrackId;
  grade: string;
  unitId?: string;
  lessonId?: string;
  titleAr: string;
  titleEn: string;
}): PackageEstimate {
  const { scope, lessons, questions, track, grade, unitId, lessonId, titleAr, titleEn } = params;

  const targetLessons = lessons.filter((l) => {
    if (l.track !== track || l.grade !== grade) return false;
    if (scope === 'lesson') return l.id === lessonId;
    if (scope === 'unit') return l.unitId === unitId;
    return true;
  });

  const lessonIds = targetLessons.map((l) => l.id);
  const lessonIdSet = new Set(lessonIds);
  const linkedQuestions = questions.filter(
    (q) => lessonIdSet.has(q.lessonId) || targetLessons.some((l) => l.finalQuizQuestionIds.includes(q.id))
  );
  const questionIds = linkedQuestions.map((q) => q.id);

  const rawAssets: string[] = [];
  for (const l of targetLessons) {
    if (l.resourceUrls?.pdf && isCacheableAssetUrl(l.resourceUrls.pdf)) rawAssets.push(l.resourceUrls.pdf);
    if (l.resourceUrls?.image && isCacheableAssetUrl(l.resourceUrls.image)) rawAssets.push(l.resourceUrls.image);
    if (l.resourceUrls?.video && isCacheableAssetUrl(l.resourceUrls.video)) rawAssets.push(l.resourceUrls.video);
  }
  const assetUrls = Array.from(new Set(rawAssets));

  const jsonBytes = utf8Bytes(targetLessons) + utf8Bytes(linkedQuestions);
  // Estimate 1.2 MB per unmeasured PDF or 150 KB per image if remote size isn't fetched yet
  const estAssetsBytes = assetUrls.reduce((acc, url) => acc + (/\.pdf(\?|$)/i.test(url) ? 1_200_000 : 150_000), 0);

  const id =
    scope === 'lesson'
      ? `lesson:${lessonId}`
      : scope === 'unit'
      ? `unit:${track}:${grade}:${unitId}`
      : `curriculum:${track}:${grade}`;

  return {
    id,
    scope,
    track,
    grade,
    unitId,
    lessonId,
    titleAr,
    titleEn,
    lessonIds,
    questionIds,
    assetUrls,
    totalBytes: Math.max(jsonBytes + estAssetsBytes, 1024),
  };
}

export function isLessonAvailableOffline(
  lessonId: string,
  packs: DownloadPackRecord[]
): { available: boolean; viaScope?: DownloadScope } {
  for (const pack of packs) {
    if (pack.status === 'completed' && pack.lessonIds.includes(lessonId)) {
      return { available: true, viaScope: pack.scope };
    }
  }
  return { available: false };
}

export function pausePackageDownload(packId: string) {
  const ctrl = activeControllers.get(packId);
  if (ctrl) {
    ctrl.paused = true;
    ctrl.abort.abort();
  }
}

export function cancelPackageDownload(packId: string) {
  const ctrl = activeControllers.get(packId);
  if (ctrl) {
    ctrl.cancelled = true;
    ctrl.abort.abort();
  }
}

async function cacheAssetWithProgress(
  url: string,
  signal: AbortSignal,
  onChunk: (receivedBytes: number, contentLength: number) => void
): Promise<number> {
  if (typeof fetch === 'undefined') return 0;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const totalHeader = Number(response.headers.get('content-length') || 0);
  const cloneForCache = response.clone();

  if (response.body) {
    const reader = response.body.getReader();
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value ? value.byteLength : 0;
      onChunk(received, totalHeader || received);
    }
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(OFFLINE_MEDIA_CACHE_NAME);
      await cache.put(url, cloneForCache);
    }
    return received;
  }

  const buf = await response.arrayBuffer();
  onChunk(buf.byteLength, totalHeader || buf.byteLength);
  if (typeof caches !== 'undefined') {
    const cache = await caches.open(OFFLINE_MEDIA_CACHE_NAME);
    await cache.put(url, new Response(buf, { headers: response.headers }));
  }
  return buf.byteLength;
}

export async function downloadContentPackage(params: {
  estimate: PackageEstimate;
  allLessons: Lesson[];
  allQuestions: QuestionItem[];
  onProgress: (pack: DownloadPackRecord) => void;
}): Promise<DownloadPackRecord> {
  const { estimate, allLessons, allQuestions, onProgress } = params;
  const abort = new AbortController();
  const state = { paused: false, cancelled: false, abort };
  activeControllers.set(estimate.id, state);

  const pack: DownloadPackRecord = {
    id: estimate.id,
    scope: estimate.scope,
    track: estimate.track,
    grade: estimate.grade,
    unitId: estimate.unitId,
    lessonId: estimate.lessonId,
    titleAr: estimate.titleAr,
    titleEn: estimate.titleEn,
    lessonIds: estimate.lessonIds,
    questionIds: estimate.questionIds,
    assetUrls: estimate.assetUrls,
    totalBytes: estimate.totalBytes,
    downloadedBytes: 0,
    progressPct: 2,
    status: 'downloading',
    updatedAt: Date.now(),
  };

  await saveDownloadPack(pack);
  onProgress({ ...pack });

  try {
    // 1. Persist structured lessons & questions in IndexedDB (core JSON package)
    const targetLessons = allLessons.filter((l) => estimate.lessonIds.includes(l.id));
    const targetQuestions = allQuestions.filter((q) => estimate.questionIds.includes(q.id));
    const jsonBytes = utf8Bytes(targetLessons) + utf8Bytes(targetQuestions);

    // Ensure full merged collections stay fresh in IndexedDB
    await saveContentCollection('lessons', allLessons);
    await saveContentCollection('questions', allQuestions);

    pack.downloadedBytes = jsonBytes;
    const totalAssetsCount = estimate.assetUrls.length;
    pack.progressPct = totalAssetsCount === 0 ? 100 : Math.min(85, Math.max(15, Math.round((jsonBytes / estimate.totalBytes) * 100)));
    pack.updatedAt = Date.now();
    await saveDownloadPack(pack);
    onProgress({ ...pack });

    // 2. Cache downloadable PDFs/images into Cache API
    let assetsDownloadedTotal = 0;
    for (let i = 0; i < totalAssetsCount; i++) {
      if (state.paused || state.cancelled) break;
      const url = estimate.assetUrls[i];
      try {
        const assetBytes = await cacheAssetWithProgress(url, abort.signal, (received, expected) => {
          const base = jsonBytes + assetsDownloadedTotal;
          const curTotal = Math.max(pack.totalBytes, base + expected);
          const pct = Math.min(99, Math.max(15, Math.round(((base + received) / curTotal) * 100)));
          onProgress({
            ...pack,
            downloadedBytes: base + received,
            totalBytes: curTotal,
            progressPct: pct,
          });
        });
        assetsDownloadedTotal += assetBytes;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          break;
        }
        // Individual optional external asset error shouldn't destroy structured JSON offline availability
        console.warn('Asset cache warning for', url, err);
      }
    }

    if (state.cancelled) {
      await deleteDownloadPack(estimate.id);
      const cancelledPack: DownloadPackRecord = { ...pack, status: 'idle', progressPct: 0, downloadedBytes: 0 };
      onProgress(cancelledPack);
      return cancelledPack;
    }

    if (state.paused) {
      const pausedPack: DownloadPackRecord = {
        ...pack,
        downloadedBytes: jsonBytes + assetsDownloadedTotal,
        status: 'paused',
        updatedAt: Date.now(),
      };
      await saveDownloadPack(pausedPack);
      onProgress(pausedPack);
      return pausedPack;
    }

    const finalBytes = Math.max(jsonBytes + assetsDownloadedTotal, 1024);
    const completedPack: DownloadPackRecord = {
      ...pack,
      totalBytes: finalBytes,
      downloadedBytes: finalBytes,
      progressPct: 100,
      status: 'completed',
      errorMsg: undefined,
      updatedAt: Date.now(),
    };
    const saveRes = await saveDownloadPack(completedPack);
    if (!saveRes.ok && saveRes.quotaExceeded) {
      const errPack: DownloadPackRecord = {
        ...pack,
        status: 'error',
        errorMsg: 'Storage quota exceeded. Please free up space in Offline Storage Manager.',
        updatedAt: Date.now(),
      };
      await saveDownloadPack(errPack);
      onProgress(errPack);
      return errPack;
    }
    onProgress(completedPack);
    return completedPack;
  } catch (err: any) {
    const status = state.paused ? 'paused' : 'error';
    const failedPack: DownloadPackRecord = {
      ...pack,
      status,
      errorMsg: state.paused ? undefined : String(err?.message || 'Download failed'),
      updatedAt: Date.now(),
    };
    await saveDownloadPack(failedPack);
    onProgress(failedPack);
    return failedPack;
  } finally {
    activeControllers.delete(estimate.id);
  }
}

export async function removeDownloadedPackage(pack: DownloadPackRecord): Promise<void> {
  cancelPackageDownload(pack.id);
  await deleteDownloadPack(pack.id);

  // Only delete cached media assets if no other completed pack references them
  if (pack.assetUrls.length > 0 && typeof caches !== 'undefined') {
    const remaining = await getAllDownloadPacks();
    const stillUsed = new Set<string>();
    for (const p of remaining) {
      if (p.id !== pack.id && p.status === 'completed') {
        p.assetUrls.forEach((u) => stillUsed.add(u));
      }
    }
    try {
      const cache = await caches.open(OFFLINE_MEDIA_CACHE_NAME);
      for (const u of pack.assetUrls) {
        if (!stillUsed.has(u)) {
          await cache.delete(u);
        }
      }
    } catch {
      // ignore
    }
  }
}
