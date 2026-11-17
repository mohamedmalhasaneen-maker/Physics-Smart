import type {
  ExamAttempt,
  ExamBlueprint,
  FormulaItem,
  LabExperimentConfig,
  Language,
  Lesson,
  LessonProgress,
  NavSection,
  QuestionItem,
  SavedGraph,
  StudyTask,
  ThemeMode,
  TrackId,
  TutorSession,
  UserProfile,
} from '../types/physics';

export const OFFLINE_DB_NAME = 'physics_smart_db';
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_MEDIA_CACHE_NAME = 'physics-smart-offline-media-v1';

export type DownloadScope = 'lesson' | 'unit' | 'curriculum';
export type DownloadStatus = 'idle' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadPackRecord {
  id: string; // e.g. "lesson:id", "unit:thanawiya:grade3:u1", "curriculum:thanawiya:grade3"
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
  downloadedBytes: number;
  progressPct: number;
  status: DownloadStatus;
  errorMsg?: string;
  updatedAt: number;
}

export interface ActiveExamSnapshot {
  uid: string;
  attemptId: string;
  examId: string;
  title: string;
  track: TrackId;
  questionIds: string[];
  durationMinutes: number;
  secondsLeft: number;
  lastTickAt: number;
  answers: Record<string, string>;
  examLang: 'ar' | 'en' | 'bilingual';
  startedAtMs: number;
}

export interface FavoriteRecord {
  key: string; // `${uid}::${itemType}::${itemId}`
  uid: string;
  itemType: 'lesson' | 'formula' | 'question';
  itemId: string;
  titleAr: string;
  titleEn: string;
  subtitle?: string;
  createdAt: number;
}

export interface StudyNoteRecord {
  key: string; // `${uid}::${itemType}::${itemId}`
  uid: string;
  itemType: 'lesson' | 'formula' | 'question';
  itemId: string;
  title: string;
  content: string;
  updatedAt: number;
}

export interface TutorOutboxItem {
  id: string;
  uid: string;
  sessionId: string;
  message: string;
  mode: 'tutor' | 'analyzer' | 'examiner';
  language: 'ar' | 'en' | 'bilingual';
  level: 'simple' | 'intermediate' | 'advanced';
  style: 'conceptual' | 'mathematical' | 'visual_analogy' | 'exam_focused';
  detail: 'concise' | 'detailed';
  track: string;
  grade: string;
  lessonContext: string;
  attachmentName?: string;
  createdAt: number;
  status: 'queued' | 'failed';
  errorMsg?: string;
}

export type SyncEntityType =
  | 'progress'
  | 'studyTask'
  | 'examAttempt'
  | 'tutorSession'
  | 'savedGraph'
  | 'profilePatch'
  | 'pointsAward';

export interface SyncQueueItem {
  id: string;
  uid: string;
  entityType: SyncEntityType;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: any;
  createdAtMs: number;
  updatedAtMs: number;
  retryCount: number;
  lastError?: string;
}

export interface UiPreferencesRecord {
  key: 'uiPreferences';
  lang: Language;
  theme: ThemeMode;
  activeSection?: NavSection;
  updatedAt: number;
}

export interface StorageBreakdownStats {
  quotaBytes: number;
  usageBytes: number;
  estimatedByStore: {
    contentBytes: number;
    downloadsMetaBytes: number;
    mediaCacheBytes: number;
    userDataBytes: number;
    tutorHistoryBytes: number;
    favoritesNotesBytes: number;
    syncQueueBytes: number;
  };
  counts: {
    lessons: number;
    questions: number;
    downloadedPacks: number;
    progress: number;
    examAttempts: number;
    tutorSessions: number;
    favorites: number;
    notes: number;
    pendingSync: number;
    tutorOutbox: number;
  };
  persistentGranted?: boolean;
}

const ALL_STORES = [
  { name: 'session', keyPath: 'key' },
  { name: 'content', keyPath: 'key' },
  { name: 'downloads', keyPath: 'id' },
  { name: 'progress', keyPath: 'key' },
  { name: 'examAttempts', keyPath: 'id' },
  { name: 'activeExam', keyPath: 'uid' },
  { name: 'studyTasks', keyPath: 'id' },
  { name: 'tutorSessions', keyPath: 'id' },
  { name: 'tutorOutbox', keyPath: 'id' },
  { name: 'savedGraphs', keyPath: 'id' },
  { name: 'favorites', keyPath: 'key' },
  { name: 'notes', keyPath: 'key' },
  { name: 'syncQueue', keyPath: 'id' },
] as const;

type StoreName = (typeof ALL_STORES)[number]['name'];

// Pure in-memory fallback when IndexedDB is unavailable (e.g. strict private mode or Node tests)
const memoryFallbackStores = new Map<StoreName, Map<string, any>>();
function getMemStore(name: StoreName): Map<string, any> {
  let m = memoryFallbackStores.get(name);
  if (!m) {
    m = new Map<string, any>();
    memoryFallbackStores.set(name, m);
  }
  return m;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let lastQuotaWarning = false;

export function hasQuotaExceededWarning(): boolean {
  return lastQuotaWarning;
}

function isIndexedDbSupported(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

export function resetOfflineDbConnectionForTest() {
  dbPromise = null;
  memoryFallbackStores.clear();
  lastQuotaWarning = false;
}

export function initSchemaOnUpgrade(db: IDBDatabase) {
  for (const def of ALL_STORES) {
    if (!db.objectStoreNames.contains(def.name)) {
      db.createObjectStore(def.name, { keyPath: def.keyPath });
    }
  }
}

export async function openOfflineDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbSupported()) return null;
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      req.onupgradeneeded = () => {
        initSchemaOnUpgrade(req.result);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        console.warn('IndexedDB unavailable, falling back to memory store:', req.error);
        resolve(null);
      };
      req.onblocked = () => {
        resolve(null);
      };
    } catch (err) {
      console.warn('IndexedDB open failed, falling back to memory store:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

function handleStorageError(err: any) {
  if (
    err?.name === 'QuotaExceededError' ||
    err?.code === 22 ||
    String(err?.message || '').toLowerCase().includes('quota')
  ) {
    lastQuotaWarning = true;
    console.warn('Offline storage quota exceeded:', err);
  } else {
    console.warn('Offline storage write warning:', err);
  }
}

async function idbGet<T>(store: StoreName, key: string): Promise<T | null> {
  const mem = getMemStore(store);
  const db = await openOfflineDb();
  if (!db) return (mem.get(key) as T) ?? null;

  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve((mem.get(key) as T) ?? null);
    } catch {
      resolve((mem.get(key) as T) ?? null);
    }
  });
}

async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const mem = getMemStore(store);
  const db = await openOfflineDb();
  if (!db) return Array.from(mem.values()) as T[];

  return new Promise<T[]>((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => resolve(Array.from(mem.values()) as T[]);
    } catch {
      resolve(Array.from(mem.values()) as T[]);
    }
  });
}

async function idbPut<T extends Record<string, any>>(store: StoreName, value: T): Promise<{ ok: boolean; quotaExceeded?: boolean }> {
  const def = ALL_STORES.find((s) => s.name === store)!;
  const keyVal = String(value[def.keyPath]);
  getMemStore(store).set(keyVal, value);

  const db = await openOfflineDb();
  if (!db) return { ok: true };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => {
        handleStorageError(tx.error);
        const quotaExceeded = tx.error?.name === 'QuotaExceededError';
        resolve({ ok: false, quotaExceeded });
      };
    } catch (err: any) {
      handleStorageError(err);
      resolve({ ok: false, quotaExceeded: err?.name === 'QuotaExceededError' });
    }
  });
}

async function idbPutMany<T extends Record<string, any>>(store: StoreName, items: T[]): Promise<{ ok: boolean; quotaExceeded?: boolean }> {
  if (items.length === 0) return { ok: true };
  const def = ALL_STORES.find((s) => s.name === store)!;
  const mem = getMemStore(store);
  for (const item of items) {
    mem.set(String(item[def.keyPath]), item);
  }

  const db = await openOfflineDb();
  if (!db) return { ok: true };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const item of items) {
        os.put(item);
      }
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => {
        handleStorageError(tx.error);
        resolve({ ok: false, quotaExceeded: tx.error?.name === 'QuotaExceededError' });
      };
    } catch (err: any) {
      handleStorageError(err);
      resolve({ ok: false, quotaExceeded: err?.name === 'QuotaExceededError' });
    }
  });
}

async function idbDelete(store: StoreName, key: string): Promise<void> {
  getMemStore(store).delete(key);
  const db = await openOfflineDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbClear(store: StoreName): Promise<void> {
  getMemStore(store).clear();
  const db = await openOfflineDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// --- Session & UI Preferences (NEVER stores passwords or API keys) ---

export function sanitizeProfileForOffline(profile: UserProfile): UserProfile {
  return {
    uid: String(profile.uid),
    displayName: String(profile.displayName || 'Student'),
    email: String(profile.email || ''),
    photoURL: profile.photoURL ? String(profile.photoURL) : '',
    track: profile.track,
    grade: String(profile.grade || ''),
    preferredLang: profile.preferredLang || 'ar',
    studyLang: profile.studyLang,
    role: profile.role || 'student',
    points: Number(profile.points || 0),
    level: Number(profile.level || 1),
    badges: Array.isArray(profile.badges) ? [...profile.badges] : [],
    updatedAt: Date.now(),
  };
}

export async function saveOfflineSessionProfile(profile: UserProfile | null): Promise<void> {
  if (!profile) {
    await idbDelete('session', 'currentUserProfile');
    return;
  }
  await idbPut('session', {
    key: 'currentUserProfile',
    profile: sanitizeProfileForOffline(profile),
    updatedAt: Date.now(),
  });
}

export async function getOfflineSessionProfile(): Promise<UserProfile | null> {
  const rec = await idbGet<{ key: string; profile: UserProfile }>('session', 'currentUserProfile');
  return rec?.profile || null;
}

export async function saveUiPreferences(prefs: Omit<UiPreferencesRecord, 'key' | 'updatedAt'>): Promise<void> {
  await idbPut('session', {
    key: 'uiPreferences',
    ...prefs,
    updatedAt: Date.now(),
  });
}

export async function getUiPreferences(): Promise<UiPreferencesRecord | null> {
  return idbGet<UiPreferencesRecord>('session', 'uiPreferences');
}

// --- Content Caching (Lessons, Questions, Exams, Labs, Formulas, Announcements) ---

export interface CachedContentSnapshot {
  lessons: Lesson[];
  questions: QuestionItem[];
  exams: ExamBlueprint[];
  labs: LabExperimentConfig[];
  announcements: Array<{ id: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }>;
}

export async function saveContentCollection<K extends keyof CachedContentSnapshot>(
  collectionKey: K,
  items: CachedContentSnapshot[K]
): Promise<void> {
  await idbPut('content', {
    key: collectionKey,
    items,
    updatedAt: Date.now(),
  });
}

export async function getContentCollection<K extends keyof CachedContentSnapshot>(
  collectionKey: K
): Promise<CachedContentSnapshot[K] | null> {
  const rec = await idbGet<{ key: string; items: CachedContentSnapshot[K] }>('content', collectionKey);
  return rec?.items || null;
}

export async function saveFormulasCache(formulas: FormulaItem[]): Promise<void> {
  await idbPut('content', { key: 'formulas', items: formulas, updatedAt: Date.now() });
}

// --- Progress & Conflict Merging ---

function normalizeTimestampMs(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return Date.parse(val) || 0;
  if (typeof val === 'object' && typeof val.seconds === 'number') return val.seconds * 1000;
  if (val instanceof Date) return val.getTime();
  return 0;
}

export function mergeProgressConflict(
  local: LessonProgress | undefined,
  remote: LessonProgress | undefined
): LessonProgress | undefined {
  if (!local) return remote;
  if (!remote) return local;

  const mergedParts = Array.from(
    new Set([...(local.completedParts || []), ...(remote.completedParts || [])])
  );
  const localTs = normalizeTimestampMs(local.updatedAt);
  const remoteTs = normalizeTimestampMs(remote.updatedAt);

  return {
    userId: remote.userId || local.userId,
    lessonId: remote.lessonId || local.lessonId,
    track: remote.track || local.track,
    completedParts: mergedParts,
    isCompleted: Boolean(local.isCompleted || remote.isCompleted),
    quizScore: Math.max(local.quizScore || 0, remote.quizScore || 0),
    studyMinutes: Math.max(local.studyMinutes || 0, remote.studyMinutes || 0),
    lastAccessedAt: localTs >= remoteTs ? local.lastAccessedAt : remote.lastAccessedAt,
    updatedAt: localTs >= remoteTs ? local.updatedAt : remote.updatedAt,
  };
}

export async function saveOfflineProgressMap(uid: string, map: Record<string, LessonProgress>): Promise<void> {
  const records = Object.values(map).map((p) => ({
    key: `${uid}::${p.lessonId}`,
    ...p,
    updatedAtMs: normalizeTimestampMs(p.updatedAt) || Date.now(),
  }));
  await idbPutMany('progress', records);
}

export async function saveOfflineProgressItem(uid: string, item: LessonProgress): Promise<void> {
  await idbPut('progress', {
    key: `${uid}::${item.lessonId}`,
    ...item,
    updatedAtMs: normalizeTimestampMs(item.updatedAt) || Date.now(),
  });
}

export async function getOfflineProgressMap(uid: string): Promise<Record<string, LessonProgress>> {
  const all = await idbGetAll<LessonProgress & { key: string }>('progress');
  const map: Record<string, LessonProgress> = {};
  for (const rec of all) {
    if (rec.userId === uid || rec.key?.startsWith(`${uid}::`)) {
      const { key: _k, ...rest } = rec as any;
      map[rec.lessonId] = rest as LessonProgress;
    }
  }
  return map;
}

// --- Study Tasks ---

export async function saveOfflineTasks(uid: string, tasks: StudyTask[]): Promise<void> {
  const filtered = tasks.filter((t) => t.userId === uid);
  await idbPutMany('studyTasks', filtered);
}

export async function saveOfflineTask(task: StudyTask): Promise<void> {
  await idbPut('studyTasks', task);
}

export async function deleteOfflineTask(taskId: string): Promise<void> {
  await idbDelete('studyTasks', taskId);
}

export async function getOfflineTasks(uid: string): Promise<StudyTask[]> {
  const all = await idbGetAll<StudyTask>('studyTasks');
  return all.filter((t) => t.userId === uid);
}

// --- Exam Attempts & In-Progress Snapshot (for exact offline/restart resume) ---

export async function saveOfflineAttempts(uid: string, attempts: ExamAttempt[]): Promise<void> {
  const filtered = attempts.filter((a) => a.userId === uid);
  await idbPutMany('examAttempts', filtered);
}

export async function saveOfflineAttempt(attempt: ExamAttempt): Promise<void> {
  await idbPut('examAttempts', {
    ...attempt,
    updatedAtMs: normalizeTimestampMs(attempt.updatedAt) || Date.now(),
  });
}

export async function getOfflineAttempts(uid: string): Promise<ExamAttempt[]> {
  const all = await idbGetAll<ExamAttempt & { updatedAtMs?: number }>('examAttempts');
  return all
    .filter((a) => a.userId === uid)
    .sort((a, b) => {
      const ta = normalizeTimestampMs(a.updatedAt) || a.updatedAtMs || 0;
      const tb = normalizeTimestampMs(b.updatedAt) || b.updatedAtMs || 0;
      return tb - ta;
    });
}

export async function saveActiveExamSnapshot(snapshot: ActiveExamSnapshot | null, uid?: string): Promise<void> {
  if (!snapshot) {
    if (uid) await idbDelete('activeExam', uid);
    return;
  }
  await idbPut('activeExam', snapshot);
}

export async function getActiveExamSnapshot(uid: string): Promise<ActiveExamSnapshot | null> {
  return idbGet<ActiveExamSnapshot>('activeExam', uid);
}

// --- Saved Graphs ---

export async function saveOfflineGraphs(uid: string, graphs: SavedGraph[]): Promise<void> {
  await idbPutMany('savedGraphs', graphs.filter((g) => g.userId === uid));
}

export async function saveOfflineGraph(graph: SavedGraph): Promise<void> {
  await idbPut('savedGraphs', graph);
}

export async function deleteOfflineGraph(graphId: string): Promise<void> {
  await idbDelete('savedGraphs', graphId);
}

export async function getOfflineGraphs(uid: string): Promise<SavedGraph[]> {
  const all = await idbGetAll<SavedGraph>('savedGraphs');
  return all.filter((g) => g.userId === uid);
}

// --- AI Tutor Sessions & Outbox ---

export async function saveOfflineTutorSessions(uid: string, sessions: TutorSession[]): Promise<void> {
  await idbPutMany('tutorSessions', sessions.filter((s) => s.userId === uid));
}

export async function saveOfflineTutorSession(session: TutorSession): Promise<void> {
  await idbPut('tutorSessions', {
    ...session,
    updatedAtMs: normalizeTimestampMs(session.updatedAt) || Date.now(),
  });
}

export async function deleteOfflineTutorSession(sessionId: string): Promise<void> {
  await idbDelete('tutorSessions', sessionId);
}

export async function getOfflineTutorSessions(uid: string): Promise<TutorSession[]> {
  const all = await idbGetAll<TutorSession & { updatedAtMs?: number }>('tutorSessions');
  return all
    .filter((s) => s.userId === uid)
    .sort((a, b) => {
      const ta = normalizeTimestampMs(a.updatedAt) || a.updatedAtMs || 0;
      const tb = normalizeTimestampMs(b.updatedAt) || b.updatedAtMs || 0;
      return tb - ta;
    });
}

export async function enqueueTutorOutbox(item: TutorOutboxItem): Promise<void> {
  await idbPut('tutorOutbox', item);
}

export async function removeTutorOutbox(id: string): Promise<void> {
  await idbDelete('tutorOutbox', id);
}

export async function getTutorOutbox(uid: string): Promise<TutorOutboxItem[]> {
  const all = await idbGetAll<TutorOutboxItem>('tutorOutbox');
  return all.filter((item) => item.uid === uid).sort((a, b) => a.createdAt - b.createdAt);
}

// --- Favorites & Study Notes ---

export async function toggleFavoriteItem(fav: Omit<FavoriteRecord, 'key' | 'createdAt'>): Promise<boolean> {
  const key = `${fav.uid}::${fav.itemType}::${fav.itemId}`;
  const existing = await idbGet<FavoriteRecord>('favorites', key);
  if (existing) {
    await idbDelete('favorites', key);
    return false;
  }
  await idbPut('favorites', {
    ...fav,
    key,
    createdAt: Date.now(),
  });
  return true;
}

export async function getOfflineFavorites(uid: string): Promise<FavoriteRecord[]> {
  const all = await idbGetAll<FavoriteRecord>('favorites');
  return all.filter((f) => f.uid === uid).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveOfflineNote(note: Omit<StudyNoteRecord, 'key' | 'updatedAt'>): Promise<void> {
  const key = `${note.uid}::${note.itemType}::${note.itemId}`;
  if (!note.content.trim()) {
    await idbDelete('notes', key);
    return;
  }
  await idbPut('notes', {
    ...note,
    key,
    updatedAt: Date.now(),
  });
}

export async function getOfflineNotes(uid: string): Promise<StudyNoteRecord[]> {
  const all = await idbGetAll<StudyNoteRecord>('notes');
  return all.filter((n) => n.uid === uid).sort((a, b) => b.updatedAt - a.updatedAt);
}

// --- Content Downloads Store ---

export async function saveDownloadPack(pack: DownloadPackRecord): Promise<{ ok: boolean; quotaExceeded?: boolean }> {
  return idbPut('downloads', pack);
}

export async function deleteDownloadPack(id: string): Promise<void> {
  await idbDelete('downloads', id);
}

export async function getAllDownloadPacks(): Promise<DownloadPackRecord[]> {
  const list = await idbGetAll<DownloadPackRecord>('downloads');
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

// --- Sync Queue ---

export async function putSyncQueueItem(item: SyncQueueItem): Promise<void> {
  await idbPut('syncQueue', item);
}

export async function removeSyncQueueItem(id: string): Promise<void> {
  await idbDelete('syncQueue', id);
}

export async function getSyncQueueItems(uid?: string): Promise<SyncQueueItem[]> {
  const all = await idbGetAll<SyncQueueItem>('syncQueue');
  return all
    .filter((i) => (!uid ? true : i.uid === uid))
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
}

// --- Storage Inspection & Management ---

function approxJsonBytes(data: unknown): number {
  try {
    return new Blob([JSON.stringify(data)]).size;
  } catch {
    return JSON.stringify(data || '').length * 2;
  }
}

export async function getMediaCacheSizeBytes(): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  try {
    const cache = await caches.open(OFFLINE_MEDIA_CACHE_NAME);
    const keys = await cache.keys();
    let total = 0;
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const lenHeader = res.headers.get('content-length');
      if (lenHeader && !Number.isNaN(Number(lenHeader))) {
        total += Number(lenHeader);
      } else {
        const clone = res.clone();
        const buf = await clone.arrayBuffer();
        total += buf.byteLength;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function getStorageStats(uid?: string): Promise<StorageBreakdownStats> {
  const [
    contentList,
    downloads,
    mediaCacheBytes,
    progress,
    attempts,
    tasks,
    graphs,
    sessions,
    outbox,
    favs,
    notes,
    syncItems,
  ] = await Promise.all([
    idbGetAll<any>('content'),
    getAllDownloadPacks(),
    getMediaCacheSizeBytes(),
    idbGetAll<any>('progress'),
    idbGetAll<any>('examAttempts'),
    idbGetAll<any>('studyTasks'),
    idbGetAll<any>('savedGraphs'),
    idbGetAll<any>('tutorSessions'),
    idbGetAll<any>('tutorOutbox'),
    idbGetAll<FavoriteRecord>('favorites'),
    idbGetAll<StudyNoteRecord>('notes'),
    getSyncQueueItems(uid),
  ]);

  let quotaBytes = 0;
  let usageBytes = 0;
  let persistentGranted: boolean | undefined;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      const est = await navigator.storage.estimate();
      quotaBytes = est.quota || 0;
      usageBytes = est.usage || 0;
    } catch {
      // ignore
    }
    try {
      if (typeof navigator.storage.persisted === 'function') {
        persistentGranted = await navigator.storage.persisted();
      }
    } catch {
      // ignore
    }
  }

  const lessonsRec = contentList.find((c) => c.key === 'lessons');
  const questionsRec = contentList.find((c) => c.key === 'questions');

  const contentBytes = approxJsonBytes(contentList);
  const downloadsMetaBytes = approxJsonBytes(downloads);
  const userDataBytes = approxJsonBytes([...progress, ...attempts, ...tasks, ...graphs]);
  const tutorHistoryBytes = approxJsonBytes([...sessions, ...outbox]);
  const favoritesNotesBytes = approxJsonBytes([...favs, ...notes]);
  const syncQueueBytes = approxJsonBytes(syncItems);

  const computedTotal =
    contentBytes + downloadsMetaBytes + mediaCacheBytes + userDataBytes + tutorHistoryBytes + favoritesNotesBytes + syncQueueBytes;

  return {
    quotaBytes,
    usageBytes: Math.max(usageBytes, computedTotal),
    estimatedByStore: {
      contentBytes,
      downloadsMetaBytes,
      mediaCacheBytes,
      userDataBytes,
      tutorHistoryBytes,
      favoritesNotesBytes,
      syncQueueBytes,
    },
    counts: {
      lessons: Array.isArray(lessonsRec?.items) ? lessonsRec.items.length : 0,
      questions: Array.isArray(questionsRec?.items) ? questionsRec.items.length : 0,
      downloadedPacks: downloads.filter((d) => d.status === 'completed').length,
      progress: uid ? progress.filter((p) => p.userId === uid).length : progress.length,
      examAttempts: uid ? attempts.filter((a) => a.userId === uid).length : attempts.length,
      tutorSessions: uid ? sessions.filter((s) => s.userId === uid).length : sessions.length,
      favorites: uid ? favs.filter((f) => f.uid === uid).length : favs.length,
      notes: uid ? notes.filter((n) => n.uid === uid).length : notes.length,
      pendingSync: syncItems.length,
      tutorOutbox: uid ? outbox.filter((o) => o.uid === uid).length : outbox.length,
    },
    persistentGranted,
  };
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

export async function clearOfflineMediaOnly(): Promise<void> {
  if (typeof caches !== 'undefined') {
    try {
      await caches.delete(OFFLINE_MEDIA_CACHE_NAME);
    } catch {
      // ignore
    }
  }
  await idbClear('downloads');
}

export async function clearAllOfflineCachesPreserveUserProgress(): Promise<void> {
  await clearOfflineMediaOnly();
  await idbClear('content');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
