import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CURRICULUM_SEED } from '../src/data/curriculumSeed';
import { FORMULAS_SEED } from '../src/data/formulasSeed';
import { QUESTIONS_SEED } from '../src/data/questionsSeed';
import {
  ActiveExamSnapshot,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  enqueueTutorOutbox,
  formatBytes,
  getActiveExamSnapshot,
  getAllDownloadPacks,
  getOfflineFavorites,
  getOfflineNotes,
  getOfflineProgressMap,
  getOfflineSessionProfile,
  getSyncQueueItems,
  getTutorOutbox,
  initSchemaOnUpgrade,
  mergeProgressConflict,
  removeTutorOutbox,
  resetOfflineDbConnectionForTest,
  sanitizeProfileForOffline,
  saveActiveExamSnapshot,
  saveOfflineNote,
  saveOfflineProgressItem,
  saveOfflineSessionProfile,
  toggleFavoriteItem,
} from '../src/lib/offlineDb';
import {
  enqueueSyncMutation,
  flushSyncQueue,
  getSyncStatusSnapshot,
} from '../src/lib/offlineSync';
import {
  buildPackageEstimate,
  downloadContentPackage,
  isCacheableAssetUrl,
  isLessonAvailableOffline,
  removeDownloadedPackage,
} from '../src/lib/contentDownloader';
import { searchOfflinePhysicsKnowledge } from '../src/lib/offlinePhysicsFallback';

const rootDir = process.cwd();

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${filePath} must be valid PNG`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

async function runTests() {
  let passed = 0;

  // Test 1: Web App Manifest & PNG Icons Integrity
  {
    const manifestPath = path.join(rootDir, 'dist', 'manifest.webmanifest');
    assert.ok(fs.existsSync(manifestPath), 'dist/manifest.webmanifest must exist after build');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.ok(manifest.theme_color);
    assert.ok(manifest.background_color);
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4);

    const hasAny192 = manifest.icons.some((i: any) => i.sizes === '192x192' && i.purpose === 'any');
    const hasAny512 = manifest.icons.some((i: any) => i.sizes === '512x512' && i.purpose === 'any');
    const hasMask192 = manifest.icons.some((i: any) => i.sizes === '192x192' && i.purpose === 'maskable');
    const hasMask512 = manifest.icons.some((i: any) => i.sizes === '512x512' && i.purpose === 'maskable');
    assert.ok(hasAny192 && hasAny512 && hasMask192 && hasMask512, 'Separate any and maskable icons required');

    assert.deepEqual(readPngDimensions(path.join(rootDir, 'dist', 'pwa-192x192.png')), { width: 192, height: 192 });
    assert.deepEqual(readPngDimensions(path.join(rootDir, 'dist', 'pwa-512x512.png')), { width: 512, height: 512 });
    assert.deepEqual(readPngDimensions(path.join(rootDir, 'dist', 'pwa-maskable-192x192.png')), { width: 192, height: 192 });
    assert.deepEqual(readPngDimensions(path.join(rootDir, 'dist', 'pwa-maskable-512x512.png')), { width: 512, height: 512 });
    assert.deepEqual(readPngDimensions(path.join(rootDir, 'dist', 'apple-touch-icon.png')), { width: 180, height: 180 });
    assert.deepEqual(readPngDimensions(path.join(rootDir, 'dist', 'favicon.png')), { width: 64, height: 64 });

    const vercelConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));
    const swHeaderRule = vercelConfig.headers?.find((h: any) => h.source === '/sw.js');
    assert.ok(swHeaderRule, 'vercel.json must configure headers for /sw.js');
    assert.ok(
      swHeaderRule.headers.some((x: any) => x.key === 'Cache-Control' && x.value.includes('must-revalidate')),
      '/sw.js must not be immutably cached by CDN'
    );
    passed++;
    console.log('✓ Test 1 passed: Manifest, PNG icons & Vercel SW no-cache headers verified');
  }

  // Test 2: Service Worker precache, runtime caching & code splitting verification
  {
    const swPath = path.join(rootDir, 'dist', 'sw.js');
    assert.ok(fs.existsSync(swPath), 'dist/sw.js must exist');
    const swCode = fs.readFileSync(swPath, 'utf8');

    assert.ok(swCode.includes('precacheAndRoute'), 'SW must use precacheAndRoute');
    assert.ok(swCode.includes('index.html'), 'SW must precache index.html');
    assert.ok(swCode.includes('KaTeX_'), 'SW must precache KaTeX math fonts for offline equations');
    assert.ok(!swCode.includes('Physics-Ar-EB-part1'), 'SW must NOT precache 13.6 MB PDF');
    assert.ok(swCode.includes('NetworkOnly'), 'SW must enforce NetworkOnly for /api/ai/*');
    assert.ok(swCode.includes('physics-smart-offline-media-v1'), 'SW must configure media CacheFirst store');
    assert.ok(swCode.includes('NavigationRoute'), 'SW must handle offline SPA NavigationRoute');

    const assets = fs.readdirSync(path.join(rootDir, 'dist', 'assets'));
    const entryJs = assets.find((f) => f.startsWith('index-') && f.endsWith('.js'));
    assert.ok(entryJs, 'Main JS entry chunk must exist');
    const entrySize = fs.statSync(path.join(rootDir, 'dist', 'assets', entryJs)).size;
    assert.ok(entrySize < 600 * 1024, `Initial entry chunk should be < 600KB (got ${formatBytes(entrySize)})`);
    assert.ok(assets.some((f) => f.startsWith('CurriculumView-')), 'CurriculumView must be code-split');
    assert.ok(assets.some((f) => f.startsWith('ExamsView-')), 'ExamsView must be code-split');
    assert.ok(assets.some((f) => f.startsWith('VirtualLabView-')), 'VirtualLabView must be code-split');
    passed++;
    console.log(`✓ Test 2 passed: Service Worker routes & Vite code splitting verified (entry=${formatBytes(entrySize)})`);
  }

  // Test 3: IndexedDB Schema, Security Sanitization, Exam Snapshot, Favorites & Notes
  {
    resetOfflineDbConnectionForTest();
    assert.equal(OFFLINE_DB_NAME, 'physics_smart_db');
    assert.equal(OFFLINE_DB_VERSION, 1);

    const createdStores: string[] = [];
    const fakeIdb = {
      objectStoreNames: { contains: (n: string) => createdStores.includes(n) },
      createObjectStore: (name: string) => {
        createdStores.push(name);
        return {} as IDBObjectStore;
      },
    } as unknown as IDBDatabase;
    initSchemaOnUpgrade(fakeIdb);
    assert.equal(createdStores.length, 13, 'Must create all 13 IndexedDB object stores on upgrade');
    assert.ok(createdStores.includes('downloads') && createdStores.includes('activeExam') && createdStores.includes('syncQueue'));

    // Security check: strip secrets if accidentally attached
    const dirtyProfile = {
      uid: 'u1',
      displayName: 'Tariq',
      email: 'tariq@example.com',
      track: 'thanawiya',
      grade: 'grade3',
      preferredLang: 'ar',
      role: 'student',
      points: 120,
      level: 1,
      badges: ['Starter'],
      password: 'SHOULD_NEVER_BE_STORED',
      apiKey: 'AIza_SECRET',
      token: 'jwt_secret',
    } as any;
    const clean = sanitizeProfileForOffline(dirtyProfile);
    assert.equal((clean as any).password, undefined);
    assert.equal((clean as any).apiKey, undefined);
    assert.equal((clean as any).token, undefined);
    assert.equal(clean.track, 'thanawiya');

    await saveOfflineSessionProfile(dirtyProfile);
    const restored = await getOfflineSessionProfile();
    assert.ok(restored);
    assert.equal((restored as any).password, undefined);
    assert.equal(restored.displayName, 'Tariq');

    // Progress conflict merging & persistence
    const merged = mergeProgressConflict(
      {
        userId: 'u1',
        lessonId: 'l1',
        track: 'thanawiya',
        completedParts: ['summary', 'quiz'],
        isCompleted: true,
        quizScore: 90,
        studyMinutes: 20,
        lastAccessedAt: 1000,
        updatedAt: 2000,
      },
      {
        userId: 'u1',
        lessonId: 'l1',
        track: 'thanawiya',
        completedParts: ['summary', 'examples'],
        isCompleted: false,
        quizScore: 70,
        studyMinutes: 15,
        lastAccessedAt: 1500,
        updatedAt: 1500,
      }
    );
    assert.ok(merged);
    assert.deepEqual((merged.completedParts || []).slice().sort(), ['examples', 'quiz', 'summary']);
    assert.equal(merged.quizScore, 90);
    assert.equal(merged.isCompleted, true);
    assert.equal(merged.studyMinutes, 20);

    await saveOfflineProgressItem('u1', merged);
    const progMap = await getOfflineProgressMap('u1');
    assert.equal(progMap['l1']?.quizScore, 90);

    // Mid-exam snapshot save & resume
    const snapshot: ActiveExamSnapshot = {
      uid: 'u1',
      attemptId: 'att-123',
      examId: 'ex-1',
      title: 'امتحان الوحدة الأولى',
      track: 'thanawiya',
      questionIds: ['q1', 'q2'],
      durationMinutes: 15,
      secondsLeft: 742,
      lastTickAt: Date.now(),
      answers: { q1: 'A' },
      examLang: 'ar',
      startedAtMs: Date.now() - 158000,
    };
    await saveActiveExamSnapshot(snapshot, 'u1');
    const restoredSnap = await getActiveExamSnapshot('u1');
    assert.equal(restoredSnap?.secondsLeft, 742);
    assert.equal(restoredSnap?.answers['q1'], 'A');
    await saveActiveExamSnapshot(null, 'u1');
    assert.equal(await getActiveExamSnapshot('u1'), null);

    // Favorites & Notes
    const favAdded = await toggleFavoriteItem({
      uid: 'u1',
      itemType: 'lesson',
      itemId: CURRICULUM_SEED[0].id,
      titleAr: CURRICULUM_SEED[0].titleAr,
      titleEn: CURRICULUM_SEED[0].titleEn,
    });
    assert.equal(favAdded, true);
    assert.equal((await getOfflineFavorites('u1')).length, 1);

    await saveOfflineNote({
      uid: 'u1',
      itemType: 'lesson',
      itemId: CURRICULUM_SEED[0].id,
      title: CURRICULUM_SEED[0].titleAr,
      content: 'قانون أوم للدائرة المغلقة: I = V_B / (R + r)',
    });
    const notes = await getOfflineNotes('u1');
    assert.equal(notes.length, 1);
    assert.ok(notes[0].content.includes('قانون أوم'));

    // Tutor Outbox
    await enqueueTutorOutbox({
      id: 'out-1',
      uid: 'u1',
      sessionId: 'sess-1',
      message: 'اشرح قاعدة لنز بمثال عملي',
      mode: 'tutor',
      language: 'ar',
      level: 'intermediate',
      style: 'conceptual',
      detail: 'detailed',
      track: 'thanawiya',
      grade: 'grade3',
      lessonContext: '',
      createdAt: Date.now(),
      status: 'queued',
    });
    assert.equal((await getTutorOutbox('u1')).length, 1);
    await removeTutorOutbox('out-1');
    assert.equal((await getTutorOutbox('u1')).length, 0);

    passed++;
    console.log('✓ Test 3 passed: IndexedDB schema, sanitization, conflict merge, exam snapshot, notes & outbox verified');
  }

  // Test 4: Offline Sync Queue deduplication, error retry & flush
  {
    resetOfflineDbConnectionForTest();
    // Deduplicate progress mutations
    await enqueueSyncMutation({
      uid: 'u2',
      entityType: 'progress',
      entityId: 'lesson-1',
      op: 'upsert',
      payload: {
        userId: 'u2',
        lessonId: 'lesson-1',
        completedParts: ['summary'],
        isCompleted: false,
        quizScore: 60,
        studyMinutes: 10,
      },
    });
    await enqueueSyncMutation({
      uid: 'u2',
      entityType: 'progress',
      entityId: 'lesson-1',
      op: 'upsert',
      payload: {
        userId: 'u2',
        lessonId: 'lesson-1',
        completedParts: ['quiz'],
        isCompleted: true,
        quizScore: 95,
        studyMinutes: 25,
      },
    });
    await enqueueSyncMutation({
      uid: 'u2',
      entityType: 'pointsAward',
      entityId: 'u2',
      op: 'upsert',
      payload: { addPoints: 40, badgeName: 'Lesson Master' },
    });
    await enqueueSyncMutation({
      uid: 'u2',
      entityType: 'pointsAward',
      entityId: 'u2',
      op: 'upsert',
      payload: { addPoints: 25 },
    });

    const queue = await getSyncQueueItems('u2');
    assert.equal(queue.length, 2, 'Duplicate entity mutations must coalesce into 2 queued records');
    const progSync = queue.find((q) => q.entityType === 'progress')!;
    assert.deepEqual(progSync.payload.completedParts.sort(), ['quiz', 'summary']);
    assert.equal(progSync.payload.quizScore, 95);
    const ptsSync = queue.find((q) => q.entityType === 'pointsAward')!;
    assert.equal(ptsSync.payload.addPoints, 65);

    // Simulate failed sync first, then retry success
    let attempt = 0;
    const executed: string[] = [];
    const firstFlush = await flushSyncQueue('u2', async () => {
      attempt++;
      if (attempt === 1) throw new Error('Transient error');
    });
    assert.equal(firstFlush.failed, 1);
    assert.equal(firstFlush.remaining, 1);
    assert.equal(getSyncStatusSnapshot().state, 'error');

    const secondFlush = await flushSyncQueue('u2', async (item) => {
      executed.push(item.entityType);
    });
    assert.equal(secondFlush.processed, 1);
    assert.equal(secondFlush.remaining, 0);
    assert.equal(getSyncStatusSnapshot().state, 'synced');

    passed++;
    console.log('✓ Test 4 passed: Offline sync queue deduplication, retry & flush verified');
  }

  // Test 5: Content Download Manager & Offline Physics Fallback
  {
    resetOfflineDbConnectionForTest();
    assert.equal(isCacheableAssetUrl('/assets/aistudio/sample.pdf'), true);
    assert.equal(isCacheableAssetUrl('https://www.youtube.com/watch?v=12345'), false);

    const sampleLesson = CURRICULUM_SEED[0];
    const est = buildPackageEstimate({
      scope: 'lesson',
      lessons: CURRICULUM_SEED,
      questions: QUESTIONS_SEED,
      track: sampleLesson.track,
      grade: sampleLesson.grade,
      lessonId: sampleLesson.id,
      titleAr: sampleLesson.titleAr,
      titleEn: sampleLesson.titleEn,
    });
    assert.equal(est.lessonIds.length, 1);
    assert.ok(est.totalBytes > 0);

    const progressUpdates: number[] = [];
    const completedPack = await downloadContentPackage({
      estimate: est,
      allLessons: CURRICULUM_SEED,
      allQuestions: QUESTIONS_SEED,
      onProgress: (p) => progressUpdates.push(p.progressPct),
    });
    assert.equal(completedPack.status, 'completed');
    assert.equal(completedPack.progressPct, 100);
    assert.ok(progressUpdates.includes(100));

    const packs = await getAllDownloadPacks();
    assert.equal(isLessonAvailableOffline(sampleLesson.id, packs).available, true);

    await removeDownloadedPackage(completedPack);
    assert.equal((await getAllDownloadPacks()).length, 0);

    // Offline AI fallback search across local lessons & formulas
    const arMatches = searchOfflinePhysicsKnowledge({
      query: 'التيار الكهربي وأوم',
      lessons: CURRICULUM_SEED,
      formulas: FORMULAS_SEED,
      studyLang: 'ar',
    });
    assert.ok(arMatches.length > 0, 'Arabic query must match cached lessons/formulas offline');
    const enMatches = searchOfflinePhysicsKnowledge({
      query: 'Newton Force Acceleration',
      lessons: CURRICULUM_SEED,
      formulas: FORMULAS_SEED,
      studyLang: 'en',
    });
    assert.ok(enMatches.length > 0, 'English query must match cached lessons/formulas offline');

    passed++;
    console.log(`✓ Test 5 passed: Download manager (${est.totalBytes} B estimate) & offline fallback search (${arMatches.length} AR / ${enMatches.length} EN matches) verified`);
  }

  console.log(`\nALL ${passed}/5 OFFLINE & PWA TEST SUITES PASSED.`);
}

runTests().catch((err) => {
  console.error('Offline PWA test failure:', err);
  process.exit(1);
});
