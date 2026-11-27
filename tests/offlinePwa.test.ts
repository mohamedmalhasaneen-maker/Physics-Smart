import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 1);

    const icon192 = manifest.icons.find(
      (i: any) => i.src === '/assets/aistudio/logo-192x192.png' && i.sizes === '192x192' && i.type === 'image/png'
    );
    const icon512Any = manifest.icons.find(
      (i: any) => i.src === '/assets/aistudio/logo-512x512.png' && i.sizes === '512x512' && i.purpose === 'any'
    );
    const icon512Maskable = manifest.icons.find(
      (i: any) => i.src === '/assets/aistudio/logo-512x512.png' && i.sizes === '512x512' && i.purpose === 'maskable'
    );
    const officialIcon = manifest.icons.find(
      (i: any) => i.src === '/assets/aistudio/__________________________425160ec.png' && i.type === 'image/png'
    );
    assert.ok(icon192, 'Manifest must include 192x192 official PNG icon for Android/Tablet WebAPK');
    assert.ok(icon512Any && icon512Maskable, 'Manifest must include separated 512x512 any & maskable PNG icons');
    assert.ok(officialIcon, 'Manifest must reference the official 1254x1254 Physics Smart PNG logo');
    assert.deepEqual(
      readPngDimensions(path.join(rootDir, 'dist', 'assets', 'aistudio', 'logo-192x192.png')),
      { width: 192, height: 192 }
    );
    assert.deepEqual(
      readPngDimensions(path.join(rootDir, 'dist', 'assets', 'aistudio', 'logo-512x512.png')),
      { width: 512, height: 512 }
    );
    assert.deepEqual(
      readPngDimensions(path.join(rootDir, 'dist', 'assets', 'aistudio', '__________________________425160ec.png')),
      { width: 1254, height: 1254 }
    );

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

  // Test 2: Service Worker precache, VM boot safety, runtime caching & code splitting verification
  {
    const swPath = path.join(rootDir, 'dist', 'sw.js');
    assert.ok(fs.existsSync(swPath), 'dist/sw.js must exist');
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'offline.html')), 'dist/offline.html must exist');
    const swCode = fs.readFileSync(swPath, 'utf8');

    assert.ok(swCode.includes('index.html'), 'SW must precache index.html');
    assert.ok(swCode.includes('offline.html'), 'SW must precache offline.html fallback');
    assert.ok(swCode.includes('KaTeX_') && swCode.includes('.woff2'), 'SW must precache KaTeX woff2 fonts');
    assert.ok(!/KaTeX_[^"']+\.(ttf|woff)["']/.test(swCode), 'SW must exclude legacy .ttf/.woff KaTeX fonts from install precache');
    assert.ok(swCode.includes('hero_physics_observatory_'), 'SW must precache bundled hero observatory image');
    assert.ok(swCode.includes('track_mechanics_lab_'), 'SW must precache bundled track images');
    assert.ok(!swCode.includes('Physics-Ar-EB-part1'), 'SW must NOT precache 13.6 MB PDF');
    assert.ok(swCode.includes('physics-smart-offline-media-v1'), 'SW must configure media CacheFirst store');
    assert.ok(swCode.includes('physics-smart'), 'SW must configure versioned cache prefix');

    // Execute dist/sw.js inside a simulated ServiceWorkerGlobalScope to catch any Workbox runtime errors
    // and verify install -> activate -> offline navigation (/, /curriculum, /exams, offline.html fallback)
    const registeredListeners: Record<string, Function[]> = {};
    const cacheBuckets = new Map<string, Map<string, Response>>();
    let isNetworkOffline = false;

    const getBucket = (name: string) => {
      let bucket = cacheBuckets.get(name);
      if (!bucket) {
        bucket = new Map<string, Response>();
        cacheBuckets.set(name, bucket);
      }
      return bucket;
    };

    const normalizeCacheKey = (reqOrUrl: Request | string) =>
      typeof reqOrUrl === 'string'
        ? new URL(reqOrUrl, 'https://physics-smart.vercel.app').href
        : reqOrUrl.url;

    const matchInBucket = (bucket: Map<string, Response>, reqOrUrl: Request | string, opts?: { ignoreSearch?: boolean }) => {
      const targetUrl = new URL(normalizeCacheKey(reqOrUrl));
      const direct = bucket.get(targetUrl.href);
      if (direct) return direct.clone();
      if (opts?.ignoreSearch) {
        for (const [k, v] of bucket.entries()) {
          const parsed = new URL(k);
          if (parsed.origin === targetUrl.origin && parsed.pathname === targetUrl.pathname) {
            return v.clone();
          }
        }
      }
      return undefined;
    };

    const mockCaches = {
      open: async (name: string) => {
        const bucket = getBucket(name);
        return {
          match: async (req: Request | string, opts?: { ignoreSearch?: boolean }) => matchInBucket(bucket, req, opts),
          put: async (req: Request | string, res: Response) => {
            bucket.set(normalizeCacheKey(req), res);
          },
          delete: async (req: Request | string) => bucket.delete(normalizeCacheKey(req)),
          keys: async () => Array.from(bucket.keys()).map((u) => new Request(u)),
        };
      },
      keys: async () => Array.from(cacheBuckets.keys()),
      match: async (req: Request | string, opts?: { ignoreSearch?: boolean }) => {
        for (const bucket of cacheBuckets.values()) {
          const hit = matchInBucket(bucket, req, opts);
          if (hit) return hit;
        }
        return undefined;
      },
      delete: async (name: string) => cacheBuckets.delete(name),
    };

    class MockFetchEvent {
      type: string;
      request: any;
      private _onRespond?: (p: Promise<Response>) => void;
      constructor(type: string, init: { request: any; onRespond?: (p: Promise<Response>) => void }) {
        this.type = type;
        this.request = init.request;
        this._onRespond = init.onRespond;
      }
      respondWith(p: Promise<Response>) {
        this._onRespond?.(p);
      }
      waitUntil() {}
    }

    let skipWaitingCalled = false;
    let clientsClaimCalled = false;

    const swSandbox: Record<string, any> = {
      URL,
      Headers,
      Request,
      Response,
      FetchEvent: MockFetchEvent,
      console,
      setTimeout,
      clearTimeout,
      fetch: async (input: Request | string) => {
        if (isNetworkOffline) {
          throw new TypeError('Failed to fetch');
        }
        const urlStr = typeof input === 'string' ? input : input.url;
        const pathname = new URL(urlStr, 'https://physics-smart.vercel.app').pathname;
        if (pathname === '/index.html') {
          return new Response('<!doctype html><html><body>PHYSICS_SMART_SHELL</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        if (pathname === '/offline.html') {
          return new Response('<!doctype html><html><body>OFFLINE_FALLBACK</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        return new Response('ok', { status: 200 });
      },
      registration: { scope: 'https://physics-smart.vercel.app/' },
      location: {
        href: 'https://physics-smart.vercel.app/sw.js',
        origin: 'https://physics-smart.vercel.app',
      },
      caches: mockCaches,
      clients: {
        claim: async () => {
          clientsClaimCalled = true;
        },
      },
      skipWaiting: async () => {
        skipWaitingCalled = true;
      },
      addEventListener: (type: string, fn: Function) => {
        registeredListeners[type] = registeredListeners[type] || [];
        registeredListeners[type].push(fn);
      },
    };
    swSandbox.self = swSandbox;
    vm.runInNewContext(swCode, swSandbox);
    assert.ok((registeredListeners['install'] || []).length >= 1, 'SW must register install handler');
    assert.ok((registeredListeners['activate'] || []).length >= 1, 'SW must register activate handler');
    assert.ok((registeredListeners['fetch'] || []).length >= 1, 'SW must register fetch handler');

    // Dispatch install & activate while online to populate precache
    const runLifecycleEvent = async (type: 'install' | 'activate') => {
      const promises: Promise<any>[] = [];
      for (const fn of registeredListeners[type] || []) {
        fn({ type, waitUntil: (p: Promise<any>) => promises.push(p) });
      }
      await Promise.all(promises);
    };
    await runLifecycleEvent('install');
    await runLifecycleEvent('activate');
    assert.equal(skipWaitingCalled, true, 'SW install must call skipWaiting() so updated SW never gets trapped in waiting');
    assert.equal(clientsClaimCalled, true, 'SW activate must call clients.claim() so controller is immediately active');

    // Verify GET_DIAGNOSTICS message handler responds with live SW metadata + deferred media warm-up
    let diagPayload: any = null;
    for (const fn of registeredListeners['message'] || []) {
      fn({
        data: { type: 'GET_DIAGNOSTICS' },
        ports: [{ postMessage: (msg: any) => { diagPayload = msg; } }],
      });
    }
    assert.ok(
      diagPayload && diagPayload.version && diagPayload.precacheCount > 10 && diagPayload.deferredMediaCount === 4,
      'SW GET_DIAGNOSTICS must reply with version, core precacheCount, and 4 deferred media entries'
    );
    const warmedImagesBucket = cacheBuckets.get('physics-smart-images-v2');
    assert.ok(
      warmedImagesBucket && warmedImagesBucket.size === 4,
      'SW activate must non-blockingly warm all 4 decorative background images into physics-smart-images-v2'
    );

    // Switch network completely offline and test closing + reopening routes for BOTH Phone & Tablet (Desktop-Site mode)
    isNetworkOffline = true;
    const dispatchOfflineRequest = async (
      routePath: string,
      opts?: { mode?: 'navigate' | 'cors'; destination?: string; userAgent?: string }
    ): Promise<Response> => {
      const reqUrl = `https://physics-smart.vercel.app${routePath}`;
      const headers = new Headers({
        Accept: opts?.mode === 'cors' ? 'application/manifest+json' : 'text/html',
      });
      if (opts?.userAgent) {
        headers.set('User-Agent', opts.userAgent);
      }
      const reqObj: any = {
        url: reqUrl,
        method: 'GET',
        mode: opts?.mode || 'navigate',
        destination: opts?.destination ?? (opts?.mode === 'cors' ? '' : 'document'),
        headers,
        clone() {
          return this;
        },
      };
      let responsePromise: Promise<Response> | null = null;
      const evt = new MockFetchEvent('fetch', {
        request: reqObj,
        onRespond: (p) => {
          responsePromise = p;
        },
      });
      for (const fn of registeredListeners['fetch'] || []) {
        fn(evt);
      }
      assert.ok(responsePromise, `SW fetch listener must handle request to ${routePath}`);
      return await responsePromise!;
    };

    // 1. Mobile Phone Offline Flows
    for (const route of ['/', '/curriculum', '/exams']) {
      const res = await dispatchOfflineRequest(route, {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Chrome/130.0.0.0 Safari/537.36',
      });
      assert.equal(res.status, 200, `Mobile offline launch ${route} must return HTTP 200`);
      const html = await res.text();
      assert.ok(html.includes('PHYSICS_SMART_SHELL'), `Mobile offline launch ${route} must serve cached App Shell`);
    }

    // 2. Android Tablet Chrome Desktop-Site Mode & Installed PWA Query Params Offline Flows
    const tabletDesktopUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    for (const route of ['/', '/?source=pwa', '/?mode=standalone', '/curriculum', '/exams']) {
      const res = await dispatchOfflineRequest(route, { userAgent: tabletDesktopUA });
      assert.equal(res.status, 200, `Tablet desktop-mode offline launch ${route} must return HTTP 200`);
      const html = await res.text();
      assert.ok(html.includes('PHYSICS_SMART_SHELL'), `Tablet offline launch ${route} must serve cached App Shell`);
    }
    const offlineManifestRes = await dispatchOfflineRequest('/manifest.webmanifest', {
      mode: 'cors',
      destination: 'manifest',
      userAgent: tabletDesktopUA,
    });
    assert.equal(offlineManifestRes.status, 200, 'Tablet installed PWA must be able to read /manifest.webmanifest offline');

    const dispatchOfflineNavigate = (routePath: string) => dispatchOfflineRequest(routePath);

    // Verify fallback to /offline.html if cached index.html is unavailable
    for (const bucket of cacheBuckets.values()) {
      for (const key of Array.from(bucket.keys())) {
        if (new URL(key).pathname === '/index.html') {
          bucket.delete(key);
        }
      }
    }
    const fallbackRes = await dispatchOfflineNavigate('/');
    assert.equal(fallbackRes.status, 200);
    assert.ok((await fallbackRes.text()).includes('OFFLINE_FALLBACK'), 'SW must fall back to /offline.html when index.html is missing');

    const assets = fs.readdirSync(path.join(rootDir, 'dist', 'assets'));
    const entryJs = assets.find((f) => f.startsWith('index-') && f.endsWith('.js'));
    assert.ok(entryJs, 'Main JS entry chunk must exist');
    const entrySize = fs.statSync(path.join(rootDir, 'dist', 'assets', entryJs)).size;
    assert.ok(entrySize < 600 * 1024, `Initial entry chunk should be < 600KB (got ${formatBytes(entrySize)})`);
    assert.ok(assets.some((f) => f.startsWith('CurriculumView-')), 'CurriculumView must be code-split');
    assert.ok(assets.some((f) => f.startsWith('ExamsView-')), 'ExamsView must be code-split');
    assert.ok(assets.some((f) => f.startsWith('VirtualLabView-')), 'VirtualLabView must be code-split');
    passed++;
    console.log(`✓ Test 2 passed: Service Worker VM execution, offline.html, routes & code splitting verified (entry=${formatBytes(entrySize)})`);
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
