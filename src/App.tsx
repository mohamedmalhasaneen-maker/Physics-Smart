import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ADMIN_BOOTSTRAP_EMAIL,
  auth,
  type AuthCredential,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  db,
  fetchSignInMethodsForEmail,
  getRedirectResult,
  GoogleAuthProvider,
  handleFirestoreError,
  isFirestoreOfflineError,
  logDevAuthError,
  OperationType,
  serverTimestamp,
  signOut,
  syncAuthLanguage,
  testFirestoreConnection,
  updateProfile,
} from './lib/firebase';
import {
  ExamAttempt,
  ExamBlueprint,
  LabExperimentConfig,
  Language,
  LeaderboardEntry,
  Lesson,
  LessonProgress,
  NavSection,
  QuestionItem,
  SavedGraph,
  StudyLanguage,
  StudyTask,
  ThemeMode,
  TrackId,
  TutorSession,
  UserProfile,
} from './types/physics';
import { tFor } from './i18n/translations';
import { getGradeLabel, getTrackLabel } from './data/tracks';
import { resolveStudyLanguage } from './lib/bilingual';
import { StudyLanguageSwitcher } from './components/BilingualBlock';
import { CURRICULUM_SEED } from './data/curriculumSeed';
import { FORMULAS_SEED } from './data/formulasSeed';
import { CHALLENGES_SEED, EXAMS_SEED, QUESTIONS_SEED } from './data/questionsSeed';
import { LAB_EXPERIMENTS } from './data/labsSeed';
import { AuthOnboarding } from './components/AuthOnboarding';
import { PhysicsAmbientBg } from './components/PhysicsAmbientBg';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineStatusBar } from './components/OfflineStatusBar';
import { OfflineCenterModal } from './components/OfflineCenterModal';
import { useOnlineStatus, useSWUpdates } from './hooks/usePWA';
import {
  ActiveExamSnapshot,
  DownloadPackRecord,
  FavoriteRecord,
  StudyNoteRecord,
  SyncQueueItem,
  deleteOfflineGraph,
  deleteOfflineTask,
  deleteOfflineTutorSession,
  getActiveExamSnapshot,
  getAllDownloadPacks,
  getContentCollection,
  getOfflineAttempts,
  getOfflineFavorites,
  getOfflineGraphs,
  getOfflineNotes,
  getOfflineProgressMap,
  getOfflineSessionProfile,
  getOfflineTasks,
  getOfflineTutorSessions,
  getSyncQueueItems,
  getUiPreferences,
  mergeProgressConflict,
  saveActiveExamSnapshot,
  saveContentCollection,
  saveFormulasCache,
  saveOfflineAttempt,
  saveOfflineAttempts,
  saveOfflineGraph,
  saveOfflineGraphs,
  saveOfflineNote,
  saveOfflineProgressItem,
  saveOfflineProgressMap,
  saveOfflineSessionProfile,
  saveOfflineTask,
  saveOfflineTasks,
  saveOfflineTutorSession,
  saveOfflineTutorSessions,
  saveUiPreferences,
  toggleFavoriteItem,
} from './lib/offlineDb';
import {
  SyncStatusSnapshot,
  enqueueSyncMutation,
  flushSyncQueue,
  getSyncStatusSnapshot,
  isBrowserOffline,
  refreshPendingSyncCount,
  setOnlineSyncIndicator,
  subscribeSyncStatus,
} from './lib/offlineSync';
import {
  Atom,
  BarChart3,
  BookOpen,
  Bot,
  Calculator,
  CalendarClock,
  FlaskConical,
  Globe,
  HardDrive,
  LayoutDashboard,
  LineChart,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Settings2,
  Sigma,
  Sun,
  Trophy,
  X,
} from 'lucide-react';

// Code-split heavy views for rapid offline shell startup & minimal initial JS payload
const DashboardView = React.lazy(() =>
  import('./components/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const CurriculumView = React.lazy(() =>
  import('./components/CurriculumView').then((m) => ({ default: m.CurriculumView }))
);
const TutorView = React.lazy(() =>
  import('./components/TutorView').then((m) => ({ default: m.TutorView }))
);
const SolverView = React.lazy(() =>
  import('./components/SolverView').then((m) => ({ default: m.SolverView }))
);
const VirtualLabView = React.lazy(() =>
  import('./components/VirtualLabView').then((m) => ({ default: m.VirtualLabView }))
);
const QuestionBankView = React.lazy(() =>
  import('./components/QuestionBankView').then((m) => ({ default: m.QuestionBankView }))
);
const ExamsView = React.lazy(() =>
  import('./components/ExamsView').then((m) => ({ default: m.ExamsView }))
);
const FormulaLibraryView = React.lazy(() =>
  import('./components/FormulaLibraryView').then((m) => ({ default: m.FormulaLibraryView }))
);
const GraphingToolView = React.lazy(() =>
  import('./components/GraphingToolView').then((m) => ({ default: m.GraphingToolView }))
);
const ChallengesView = React.lazy(() =>
  import('./components/ChallengesView').then((m) => ({ default: m.ChallengesView }))
);
const StudyPlannerView = React.lazy(() =>
  import('./components/StudyPlannerView').then((m) => ({ default: m.StudyPlannerView }))
);
const AnalyticsView = React.lazy(() =>
  import('./components/AnalyticsView').then((m) => ({ default: m.AnalyticsView }))
);
const AdminDashboardView = React.lazy(() =>
  import('./components/AdminDashboardView').then((m) => ({ default: m.AdminDashboardView }))
);

export default function App() {
  const [lang, setLang] = useState<Language>('ar');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showTrackSwitcher, setShowTrackSwitcher] = useState(false);
  const [redirectAuthError, setRedirectAuthError] = useState<unknown | null>(null);
  const [redirectPendingLink, setRedirectPendingLink] = useState<{
    credential: AuthCredential;
    email: string;
    methods: string[];
  } | null>(null);
  const [profileSyncWarning, setProfileSyncWarning] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [tutorLessonContext, setTutorLessonContext] = useState<Lesson | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Offline-first PWA State
  const isOnline = useOnlineStatus();
  const [isExamActive, setIsExamActive] = useState(false);
  const swUpdates = useSWUpdates({ deferReload: isExamActive });
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot>(getSyncStatusSnapshot);
  const [downloadPacks, setDownloadPacks] = useState<DownloadPackRecord[]>([]);
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);
  const [notes, setNotes] = useState<StudyNoteRecord[]>([]);
  const [activeExamSnapshot, setActiveExamSnapshot] = useState<ActiveExamSnapshot | null>(null);
  const [offlineCenterOpen, setOfflineCenterOpen] = useState(false);
  const [offlineCenterTab, setOfflineCenterTab] = useState<'downloads' | 'storage' | 'saved'>('downloads');

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Synced Data State
  const [progressMap, setProgressMap] = useState<Record<string, LessonProgress>>({});
  const [studyTasks, setStudyTasks] = useState<StudyTask[]>([]);
  const [examAttempts, setExamAttempts] = useState<ExamAttempt[]>([]);
  const [tutorSessions, setTutorSessions] = useState<TutorSession[]>([]);
  const [savedGraphs, setSavedGraphs] = useState<SavedGraph[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  const [adminLessons, setAdminLessons] = useState<Lesson[]>([]);
  const [adminQuestions, setAdminQuestions] = useState<QuestionItem[]>([]);
  const [adminExams, setAdminExams] = useState<ExamBlueprint[]>([]);
  const [adminLabs, setAdminLabs] = useState<LabExperimentConfig[]>([]);
  const [adminStudents, setAdminStudents] = useState<UserProfile[]>([]);
  const [announcements, setAnnouncements] = useState<
    Array<{ id: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }>
  >([
    {
      id: 'welcome-ann',
      titleAr: 'مرحبًا بك في منصة Physics Smart',
      titleEn: 'Welcome to Physics Smart',
      bodyAr: 'جميع الدروس والمعامل وبنك الأسئلة مخصصة بالكامل لنظامك وصفك الدراسي.',
      bodyEn: 'All lessons, virtual labs, and assessments are isolated to your selected educational track.',
    },
  ]);

  // Hydrate UI preferences, downloaded packs & offline educational collections on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [prefs, packs, cachedLessons, cachedQuestions, cachedExams, cachedLabs, cachedAnn] =
        await Promise.all([
          getUiPreferences(),
          getAllDownloadPacks(),
          getContentCollection('lessons'),
          getContentCollection('questions'),
          getContentCollection('exams'),
          getContentCollection('labs'),
          getContentCollection('announcements'),
        ]);
      if (!mounted) return;
      if (prefs?.lang) setLang(prefs.lang);
      if (prefs?.theme) setTheme(prefs.theme);
      setDownloadPacks(packs);
      if (cachedLessons?.length) {
        const seedIds = new Set(CURRICULUM_SEED.map((l) => l.id));
        const overrides = cachedLessons.filter((l) => !seedIds.has(l.id));
        if (overrides.length > 0) setAdminLessons(overrides);
      }
      if (cachedQuestions?.length) {
        const seedIds = new Set(QUESTIONS_SEED.map((q) => q.id));
        const overrides = cachedQuestions.filter((q) => !seedIds.has(q.id));
        if (overrides.length > 0) setAdminQuestions(overrides);
      }
      if (cachedExams?.length) {
        const seedIds = new Set(EXAMS_SEED.map((e) => e.id));
        const overrides = cachedExams.filter((e) => !seedIds.has(e.id));
        if (overrides.length > 0) setAdminExams(overrides);
      }
      if (cachedLabs?.length) {
        const seedIds = new Set(LAB_EXPERIMENTS.map((l) => l.id));
        const overrides = cachedLabs.filter((l) => !seedIds.has(l.id));
        if (overrides.length > 0) setAdminLabs(overrides);
      }
      if (cachedAnn?.length) {
        setAnnouncements(cachedAnn);
      }
      saveFormulasCache(FORMULAS_SEED).catch(() => {});
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Persist UI preferences locally
  useEffect(() => {
    saveUiPreferences({ lang, theme, activeSection }).catch(() => {});
  }, [lang, theme, activeSection]);

  // Subscribe to offline sync queue status
  useEffect(() => {
    const unsub = subscribeSyncStatus(setSyncStatus);
    return () => unsub();
  }, []);

  useEffect(() => {
    setOnlineSyncIndicator(isOnline);
  }, [isOnline]);

  // Sync HTML dir/lang/theme & Firebase Auth localization
  useEffect(() => {
    const root = document.documentElement;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    root.lang = lang;
    root.classList.toggle('dark', theme === 'dark');
    syncAuthLanguage(lang);
  }, [lang, theme]);

  const signupInFlightRef = React.useRef(false);

  const sanitizeDisplayName = (rawName?: string | null, email?: string | null): string => {
    const candidate = (rawName || email?.split('@')[0] || 'Student').trim();
    return (candidate || 'Student').slice(0, 120);
  };

  const sanitizePhotoUrl = (rawUrl?: string | null): string => {
    const clean = (rawUrl || '').trim();
    return clean.length <= 500 ? clean : '';
  };

  const sanitizeEmail = (user: User): string => {
    const candidate = (
      user.email ||
      user.providerData?.find((p) => p.email)?.email ||
      `${user.uid}@google.user`
    ).trim();
    return (candidate.length >= 3 ? candidate : `${user.uid}@google.user`).slice(0, 200);
  };

  const hydrateUserOfflineData = useCallback(async (uid: string) => {
    const [
      cachedProgress,
      cachedTasks,
      cachedAttempts,
      cachedSessions,
      cachedGraphs,
      cachedFavs,
      cachedNotes,
      cachedSnapshot,
    ] = await Promise.all([
      getOfflineProgressMap(uid),
      getOfflineTasks(uid),
      getOfflineAttempts(uid),
      getOfflineTutorSessions(uid),
      getOfflineGraphs(uid),
      getOfflineFavorites(uid),
      getOfflineNotes(uid),
      getActiveExamSnapshot(uid),
    ]);

    setProgressMap(cachedProgress);
    setStudyTasks(cachedTasks);
    setExamAttempts(cachedAttempts);
    setTutorSessions(cachedSessions);
    setSavedGraphs(cachedGraphs);
    setFavorites(cachedFavs);
    setNotes(cachedNotes);
    setActiveExamSnapshot(cachedSnapshot);
    await refreshPendingSyncCount(uid);
  }, []);

  // Initial Firestore connection test + Google redirect completion + Auth listener
  useEffect(() => {
    if (navigator.onLine) {
      testFirestoreConnection();
    }
    const handleOnline = () => {
      testFirestoreConnection();
    };
    window.addEventListener('online', handleOnline);

    // Inspect redirect sign-in result if returning from signInWithRedirect
    getRedirectResult(auth, browserPopupRedirectResolver)
      .then((result) => {
        if (result?.user) {
          setRedirectAuthError(null);
          setRedirectPendingLink(null);
        }
      })
      .catch(async (err) => {
        logDevAuthError('getRedirectResult', err);
        const code =
          err && typeof err === 'object' && 'code' in err && typeof (err as any).code === 'string'
            ? (err as any).code.toLowerCase()
            : '';
        if (code === 'auth/account-exists-with-different-credential') {
          const pendingCred = GoogleAuthProvider.credentialFromError(err);
          const conflictEmail = typeof (err as any)?.customData?.email === 'string' ? (err as any).customData.email : '';
          const methods = conflictEmail ? await fetchSignInMethodsForEmail(auth, conflictEmail).catch(() => []) : [];
          if (pendingCred) {
            setRedirectPendingLink({ credential: pendingCred, email: conflictEmail, methods });
          }
        }
        setRedirectAuthError(err);
      });

    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setProfileSyncWarning(null);
        setProgressMap({});
        setStudyTasks([]);
        setExamAttempts([]);
        setTutorSessions([]);
        setSavedGraphs([]);
        setFavorites([]);
        setNotes([]);
        setActiveExamSnapshot(null);
        setAdminStudents([]);
        setShowTrackSwitcher(false);
        setSelectedLessonId(null);
        setTutorLessonContext(null);
        setActiveSection('dashboard');
        setAuthReady(true);
        return;
      }

      if (signupInFlightRef.current) {
        // Email sign-up handler creates the Firestore profile atomically with full name, track, and grade
        setAuthReady(true);
        return;
      }

      const safeEmail = sanitizeEmail(user);
      const safeName = sanitizeDisplayName(user.displayName, safeEmail);
      const safePhoto = sanitizePhotoUrl(user.photoURL);
      const isBootstrapAdmin = user.email === ADMIN_BOOTSTRAP_EMAIL && user.emailVerified;
      const fallbackProfile: UserProfile = {
        uid: user.uid,
        displayName: safeName,
        email: safeEmail,
        photoURL: safePhoto,
        track: 'unset',
        grade: '',
        preferredLang: lang,
        role: isBootstrapAdmin ? 'admin' : 'student',
        points: 0,
        level: 1,
        badges: [],
      };

      // Immediately hydrate cached profile & offline study data for instant offline launch
      const cachedProfile = await getOfflineSessionProfile();
      const hasValidCachedProfile = Boolean(cachedProfile && cachedProfile.uid === user.uid);
      if (hasValidCachedProfile && cachedProfile) {
        setProfile(cachedProfile);
        if (cachedProfile.preferredLang) setLang(cachedProfile.preferredLang);
        await hydrateUserOfflineData(user.uid);
        setAuthReady(true);
      }

      // If browser is offline right now, never block waiting for Firestore server timeouts
      if (typeof navigator !== 'undefined' && isBrowserOffline()) {
        if (!hasValidCachedProfile) {
          setProfile(fallbackProfile);
          await hydrateUserOfflineData(user.uid);
        }
        setAuthReady(true);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        let snap;
        let readFailed = false;
        try {
          snap = await getDoc(userRef);
        } catch (err) {
          if (isFirestoreOfflineError(err)) {
            await new Promise((r) => setTimeout(r, 800));
            try {
              snap = await getDoc(userRef);
            } catch (retryErr) {
              readFailed = true;
              console.warn('Firestore profile read paused while offline:', retryErr);
            }
          } else {
            readFailed = true;
            console.error('Firestore profile read failed after auth:', err);
          }
        }

        if (snap && snap.exists()) {
          const data = snap.data() as UserProfile;
          const resolvedRole = isBootstrapAdmin ? 'admin' : data.role;
          const resolvedName = data.displayName?.trim() ? data.displayName : safeName;
          const resolvedPhoto = safePhoto || data.photoURL || '';
          const resolvedProfile: UserProfile = {
            ...data,
            displayName: resolvedName,
            photoURL: resolvedPhoto,
            role: resolvedRole,
          };
          setProfile(resolvedProfile);
          saveOfflineSessionProfile(resolvedProfile).catch(() => {});
          if (data.preferredLang) setLang(data.preferredLang);
          if (!hasValidCachedProfile) {
            await hydrateUserOfflineData(user.uid);
          }

          // Sync identity updates (without overwriting existing track, grade, points, level, badges, or createdAt)
          const needsIdentitySync =
            (!data.displayName?.trim() && resolvedName !== data.displayName) ||
            (resolvedPhoto && resolvedPhoto !== (data.photoURL || '')) ||
            (isBootstrapAdmin && data.role !== 'admin');

          if (needsIdentitySync) {
            const identityPatch: Record<string, any> = {
              displayName: resolvedName.slice(0, 120),
              photoURL: resolvedPhoto,
              updatedAt: serverTimestamp(),
            };
            if (isBootstrapAdmin && data.role !== 'admin') {
              identityPatch.role = 'admin';
            }
            try {
              await setDoc(userRef, identityPatch, { merge: true });
              setProfileSyncWarning(null);
            } catch (syncErr) {
              console.warn('Non-blocking profile identity sync error:', syncErr);
            }
          } else {
            setProfileSyncWarning(null);
          }
        } else if (snap && !snap.exists()) {
          // First-time sign-in (e.g., Google OAuth): immediately unblock UI and sync profile cleanly
          const initialProfile =
            hasValidCachedProfile && cachedProfile && cachedProfile.track !== 'unset'
              ? cachedProfile
              : fallbackProfile;
          setProfile(initialProfile);
          saveOfflineSessionProfile(initialProfile).catch(() => {});
          if (!hasValidCachedProfile) {
            await hydrateUserOfflineData(user.uid);
          }
          try {
            await setDoc(
              userRef,
              {
                ...initialProfile,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
            setProfileSyncWarning(null);
          } catch (createErr) {
            console.error('Non-blocking Firestore profile creation warning:', createErr);
            setProfileSyncWarning(
              lang === 'ar'
                ? 'تم تسجيل دخولك بنجاح، لكن تعذر مزامنة ملفك مع قاعدة البيانات مؤقتًا. سيتم الحفظ عند اختيار المسار.'
                : 'Signed in successfully, though syncing your cloud profile is temporarily delayed. It will retry when saving your track.'
            );
          }
        } else {
          // Auth succeeded while Firestore read was unreachable/offline; preserve cached track & profile!
          const safeOfflineProfile = hasValidCachedProfile && cachedProfile ? cachedProfile : fallbackProfile;
          setProfile(safeOfflineProfile);
          if (!hasValidCachedProfile) {
            await hydrateUserOfflineData(user.uid);
          }
          if (readFailed && !hasValidCachedProfile) {
            setProfileSyncWarning(
              lang === 'ar'
                ? 'تم تسجيل دخولك بنجاح. يتم العمل بالذاكرة المحلية حتى تستقر المزامنة السحابية.'
                : 'Signed in successfully. Working offline from local storage until cloud sync resumes.'
            );
          }
        }
      } finally {
        setAuthReady(true);
      }
    });
    return () => {
      window.removeEventListener('online', handleOnline);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Conflict-safe Sync Executor for queued offline student mutations
  const executeSyncItem = useCallback(
    async (uid: string, item: SyncQueueItem) => {
      switch (item.entityType) {
        case 'profilePatch': {
          const userRef = doc(db, 'users', uid);
          const snap = await getDoc(userRef);
          if (snap.exists()) {
            await updateDoc(userRef, {
              ...item.payload,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(
              userRef,
              {
                ...(profile || {
                  uid,
                  displayName: firebaseUser?.displayName || 'Student',
                  email: firebaseUser?.email || `${uid}@user`,
                  photoURL: '',
                  track: 'thanawiya',
                  grade: 'grade3',
                  preferredLang: lang,
                  role: 'student',
                  points: 0,
                  level: 1,
                  badges: [],
                }),
                ...item.payload,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
          break;
        }
        case 'pointsAward': {
          const userRef = doc(db, 'users', uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) return;
          const serverData = snap.data() as UserProfile;
          const nextPoints = Number(serverData.points || 0) + Number(item.payload?.addPoints || 0);
          const nextLevel = Math.max(1, Math.floor(nextPoints / 150) + 1);
          const addedBadges: string[] = Array.isArray(item.payload?.badges)
            ? item.payload.badges
            : item.payload?.badgeName
            ? [String(item.payload.badgeName)]
            : [];
          const nextBadges = Array.from(new Set([...(serverData.badges || []), ...addedBadges])).slice(0, 30);

          await updateDoc(userRef, {
            points: nextPoints,
            level: nextLevel,
            badges: nextBadges,
            updatedAt: serverTimestamp(),
          });

          const lbRef = doc(db, 'leaderboardPublic', uid);
          await setDoc(lbRef, {
            uid,
            displayName: serverData.displayName || profile?.displayName || 'Student',
            track: serverData.track || profile?.track || 'thanawiya',
            grade: serverData.grade || profile?.grade || 'grade3',
            points: nextPoints,
            accuracy: 100,
            level: nextLevel,
            updatedAt: serverTimestamp(),
          });
          break;
        }
        case 'progress': {
          const ref = doc(db, 'users', uid, 'progress', item.entityId);
          const snap = await getDoc(ref);
          const p = item.payload as LessonProgress;
          if (snap.exists()) {
            const merged = mergeProgressConflict(p, snap.data() as LessonProgress)!;
            await updateDoc(ref, {
              completedParts: merged.completedParts,
              isCompleted: merged.isCompleted,
              quizScore: merged.quizScore,
              studyMinutes: merged.studyMinutes,
              lastAccessedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(ref, {
              userId: uid,
              lessonId: p.lessonId,
              track: p.track,
              completedParts: p.completedParts,
              isCompleted: p.isCompleted,
              quizScore: p.quizScore,
              studyMinutes: p.studyMinutes,
              lastAccessedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'studyTask': {
          const ref = doc(db, 'users', uid, 'studyTasks', item.entityId);
          if (item.op === 'delete') {
            await deleteDoc(ref);
          } else {
            const task = item.payload as StudyTask;
            const snap = await getDoc(ref);
            if (snap.exists()) {
              await updateDoc(ref, {
                title: task.title,
                lessonId: task.lessonId || '',
                scheduledDate: task.scheduledDate,
                durationMinutes: task.durationMinutes,
                taskType: task.taskType,
                completed: task.completed,
                updatedAt: serverTimestamp(),
              });
            } else {
              await setDoc(ref, {
                ...task,
                lessonId: task.lessonId || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }
          break;
        }
        case 'examAttempt': {
          const ref = doc(db, 'users', uid, 'examAttempts', item.entityId);
          const attempt = item.payload as ExamAttempt;
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            await setDoc(ref, {
              ...attempt,
              startedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else if (snap.data()?.status === 'in_progress') {
            await updateDoc(ref, {
              status: attempt.status,
              score: attempt.score,
              answersJson: attempt.answersJson || '{}',
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'tutorSession': {
          const ref = doc(db, 'users', uid, 'tutorSessions', item.entityId);
          if (item.op === 'delete') {
            await deleteDoc(ref);
          } else {
            const session = item.payload as TutorSession;
            const snap = await getDoc(ref);
            if (snap.exists()) {
              await updateDoc(ref, {
                title: session.title,
                mode: session.mode,
                messagesJson: session.messagesJson,
                updatedAt: serverTimestamp(),
              });
            } else {
              await setDoc(ref, {
                ...session,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }
          break;
        }
        case 'savedGraph': {
          const ref = doc(db, 'users', uid, 'graphs', item.entityId);
          if (item.op === 'delete') {
            await deleteDoc(ref);
          } else {
            const graph = item.payload as SavedGraph;
            const snap = await getDoc(ref);
            if (snap.exists()) {
              await updateDoc(ref, {
                title: graph.title,
                graphType: graph.graphType,
                xLabel: graph.xLabel,
                yLabel: graph.yLabel,
                pointsJson: graph.pointsJson,
                updatedAt: serverTimestamp(),
              });
            } else {
              await setDoc(ref, {
                ...graph,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }
          break;
        }
      }
    },
    [firebaseUser, lang, profile]
  );

  const handleTriggerSync = useCallback(async () => {
    if (!firebaseUser || !isOnline) return;
    await flushSyncQueue(firebaseUser.uid, (item) => executeSyncItem(firebaseUser.uid, item));
  }, [firebaseUser, isOnline, executeSyncItem]);

  // Auto-flush offline sync queue upon returning online
  useEffect(() => {
    if (isOnline && firebaseUser && profile && profile.track !== 'unset') {
      handleTriggerSync().catch(() => {});
    }
  }, [isOnline, firebaseUser, profile?.uid, profile?.track, handleTriggerSync]);

  // Real-time Firestore listeners once signed in & online
  useEffect(() => {
    if (!firebaseUser || !profile || !isOnline) return;

    const uid = firebaseUser.uid;
    const unsubs: Array<() => void> = [];
    const handleListenerError = (err: unknown, op: OperationType, path: string) => {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        console.warn(`Firestore listener paused while offline (${path})`);
        return;
      }
      handleFirestoreError(err, op, path);
    };

    // 1. User profile live sync
    unsubs.push(
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data() as UserProfile;
            const isBootstrapAdmin = firebaseUser.email === ADMIN_BOOTSTRAP_EMAIL && firebaseUser.emailVerified;
            const nextProf = { ...d, role: isBootstrapAdmin ? 'admin' : d.role };
            setProfile(nextProf);
            saveOfflineSessionProfile(nextProf).catch(() => {});
          }
        },
        (err) => handleListenerError(err, OperationType.GET, `users/${uid}`)
      )
    );

    // 2. Progress subcollection (merges conflict-safely with local unsynced progress)
    const progQ = query(collection(db, 'users', uid, 'progress'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        progQ,
        async (snap) => {
          const pending = await getSyncQueueItems(uid);
          const pendingMap = new Map<string, LessonProgress>();
          for (const qItem of pending) {
            if (qItem.entityType === 'progress' && qItem.op === 'upsert') {
              pendingMap.set(qItem.entityId, qItem.payload as LessonProgress);
            }
          }
          const nextMap: Record<string, LessonProgress> = {};
          snap.docs.forEach((d) => {
            const remoteItem = d.data() as LessonProgress;
            nextMap[d.id] = mergeProgressConflict(pendingMap.get(d.id), remoteItem) || remoteItem;
          });
          pendingMap.forEach((localPending, id) => {
            if (!nextMap[id]) nextMap[id] = localPending;
          });
          setProgressMap(nextMap);
          saveOfflineProgressMap(uid, nextMap).catch(() => {});
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/progress`)
      )
    );

    // 3. Study tasks
    const tasksQ = query(collection(db, 'users', uid, 'studyTasks'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        tasksQ,
        async (snap) => {
          const pending = await getSyncQueueItems(uid);
          const deletedIds = new Set(
            pending.filter((i) => i.entityType === 'studyTask' && i.op === 'delete').map((i) => i.entityId)
          );
          const pendingUpserts = new Map(
            pending
              .filter((i) => i.entityType === 'studyTask' && i.op === 'upsert')
              .map((i) => [i.entityId, i.payload as StudyTask])
          );
          const merged = new Map<string, StudyTask>();
          snap.docs.forEach((d) => {
            if (!deletedIds.has(d.id)) merged.set(d.id, d.data() as StudyTask);
          });
          pendingUpserts.forEach((val, id) => merged.set(id, val));
          const list = Array.from(merged.values());
          setStudyTasks(list);
          saveOfflineTasks(uid, list).catch(() => {});
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/studyTasks`)
      )
    );

    // 4. Exam attempts
    const attemptsQ = query(collection(db, 'users', uid, 'examAttempts'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        attemptsQ,
        async (snap) => {
          const pending = await getSyncQueueItems(uid);
          const pendingAttempts = new Map(
            pending
              .filter((i) => i.entityType === 'examAttempt')
              .map((i) => [i.entityId, i.payload as ExamAttempt])
          );
          const merged = new Map<string, ExamAttempt>();
          snap.docs.forEach((d) => merged.set(d.id, d.data() as ExamAttempt));
          pendingAttempts.forEach((val, id) => merged.set(id, val));
          const list = Array.from(merged.values());
          list.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
          setExamAttempts(list);
          saveOfflineAttempts(uid, list).catch(() => {});
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/examAttempts`)
      )
    );

    // 5. Tutor sessions
    const sessionsQ = query(collection(db, 'users', uid, 'tutorSessions'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        sessionsQ,
        async (snap) => {
          const pending = await getSyncQueueItems(uid);
          const deletedIds = new Set(
            pending.filter((i) => i.entityType === 'tutorSession' && i.op === 'delete').map((i) => i.entityId)
          );
          const pendingUpserts = new Map(
            pending
              .filter((i) => i.entityType === 'tutorSession' && i.op === 'upsert')
              .map((i) => [i.entityId, i.payload as TutorSession])
          );
          const merged = new Map<string, TutorSession>();
          snap.docs.forEach((d) => {
            if (!deletedIds.has(d.id)) merged.set(d.id, d.data() as TutorSession);
          });
          pendingUpserts.forEach((val, id) => merged.set(id, val));
          const list = Array.from(merged.values());
          list.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
          setTutorSessions(list);
          saveOfflineTutorSessions(uid, list).catch(() => {});
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/tutorSessions`)
      )
    );

    // 6. Saved graphs
    const graphsQ = query(collection(db, 'users', uid, 'graphs'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        graphsQ,
        async (snap) => {
          const pending = await getSyncQueueItems(uid);
          const deletedIds = new Set(
            pending.filter((i) => i.entityType === 'savedGraph' && i.op === 'delete').map((i) => i.entityId)
          );
          const pendingUpserts = new Map(
            pending
              .filter((i) => i.entityType === 'savedGraph' && i.op === 'upsert')
              .map((i) => [i.entityId, i.payload as SavedGraph])
          );
          const merged = new Map<string, SavedGraph>();
          snap.docs.forEach((d) => {
            if (!deletedIds.has(d.id)) merged.set(d.id, d.data() as SavedGraph);
          });
          pendingUpserts.forEach((val, id) => merged.set(id, val));
          const list = Array.from(merged.values());
          setSavedGraphs(list);
          saveOfflineGraphs(uid, list).catch(() => {});
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/graphs`)
      )
    );

    // 7. Public Leaderboard
    const lbQ = query(collection(db, 'leaderboardPublic'), where('points', '>=', 0), orderBy('points', 'desc'));
    unsubs.push(
      onSnapshot(
        lbQ,
        (snap) => {
          setLeaderboard(snap.docs.map((d) => d.data() as LeaderboardEntry));
        },
        (err) => handleListenerError(err, OperationType.LIST, 'leaderboardPublic')
      )
    );

    // 8. Admin-managed Curricula
    const currQ = query(
      collection(db, 'curricula'),
      where('track', 'in', ['thanawiya', 'baccalaureate', 'american'])
    );
    unsubs.push(
      onSnapshot(
        currQ,
        (snap) => {
          const list: Lesson[] = [];
          snap.docs.forEach((d) => {
            try {
              const raw = d.data();
              list.push(JSON.parse(raw.payloadJson));
            } catch {
              // ignore malformed
            }
          });
          setAdminLessons(list);
        },
        (err) => handleListenerError(err, OperationType.LIST, 'curricula')
      )
    );

    // 9. Admin-managed Questions
    const questQ = query(
      collection(db, 'questions'),
      where('track', 'in', ['thanawiya', 'baccalaureate', 'american'])
    );
    unsubs.push(
      onSnapshot(
        questQ,
        (snap) => {
          const list: QuestionItem[] = [];
          snap.docs.forEach((d) => {
            try {
              list.push(JSON.parse(d.data().payloadJson));
            } catch {
              // ignore
            }
          });
          setAdminQuestions(list);
        },
        (err) => handleListenerError(err, OperationType.LIST, 'questions')
      )
    );

    // 10. Admin-managed Exams
    const examQ = query(
      collection(db, 'exams'),
      where('track', 'in', ['thanawiya', 'baccalaureate', 'american'])
    );
    unsubs.push(
      onSnapshot(
        examQ,
        (snap) => {
          const list: ExamBlueprint[] = [];
          snap.docs.forEach((d) => {
            try {
              list.push(JSON.parse(d.data().payloadJson));
            } catch {
              // ignore
            }
          });
          setAdminExams(list);
        },
        (err) => handleListenerError(err, OperationType.LIST, 'exams')
      )
    );

    // 11. Admin-managed Lab Configs
    const labQ = query(
      collection(db, 'labConfigs'),
      where('category', 'in', ['mechanics', 'electricity', 'waves', 'magnetism', 'optics'])
    );
    unsubs.push(
      onSnapshot(
        labQ,
        (snap) => {
          const list: LabExperimentConfig[] = [];
          snap.docs.forEach((d) => {
            try {
              list.push(JSON.parse(d.data().payloadJson));
            } catch {
              // ignore
            }
          });
          setAdminLabs(list);
        },
        (err) => handleListenerError(err, OperationType.LIST, 'labConfigs')
      )
    );

    // 12. Platform Settings / Announcements
    const settingsQ = query(collection(db, 'platformSettings'), where('id', '>=', ''));
    unsubs.push(
      onSnapshot(
        settingsQ,
        (snap) => {
          const list: Array<{ id: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }> = [];
          snap.docs.forEach((d) => {
            try {
              list.push(JSON.parse(d.data().payloadJson));
            } catch {
              // ignore
            }
          });
          if (list.length > 0) {
            setAnnouncements(list);
            saveContentCollection('announcements', list).catch(() => {});
          }
        },
        (err) => handleListenerError(err, OperationType.LIST, 'platformSettings')
      )
    );

    // 13. Admin-only: Students list
    if (profile.role === 'admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => {
            setAdminStudents(snap.docs.map((d) => d.data() as UserProfile));
          },
          (err) => handleListenerError(err, OperationType.LIST, 'users')
        )
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [firebaseUser, profile?.uid, profile?.role, isOnline]);

  // Merged Content (Seed + Admin Firestore overrides) & auto-cache locally
  const mergedLessons = React.useMemo(() => {
    const map = new Map<string, Lesson>();
    CURRICULUM_SEED.forEach((l) => map.set(l.id, l));
    adminLessons.forEach((l) => map.set(l.id, l));
    return Array.from(map.values());
  }, [adminLessons]);

  const mergedQuestions = React.useMemo(() => {
    const map = new Map<string, QuestionItem>();
    QUESTIONS_SEED.forEach((q) => map.set(q.id, q));
    adminQuestions.forEach((q) => map.set(q.id, q));
    return Array.from(map.values());
  }, [adminQuestions]);

  const mergedExams = React.useMemo(() => {
    const map = new Map<string, ExamBlueprint>();
    EXAMS_SEED.forEach((e) => map.set(e.id, e));
    adminExams.forEach((e) => map.set(e.id, e));
    return Array.from(map.values());
  }, [adminExams]);

  const mergedLabs = React.useMemo(() => {
    const map = new Map<string, LabExperimentConfig>();
    LAB_EXPERIMENTS.forEach((l) => map.set(l.id, l));
    adminLabs.forEach((l) => map.set(l.id, l));
    return Array.from(map.values());
  }, [adminLabs]);

  useEffect(() => {
    saveContentCollection('lessons', mergedLessons).catch(() => {});
  }, [mergedLessons]);

  useEffect(() => {
    saveContentCollection('questions', mergedQuestions).catch(() => {});
  }, [mergedQuestions]);

  useEffect(() => {
    saveContentCollection('exams', mergedExams).catch(() => {});
  }, [mergedExams]);

  useEffect(() => {
    saveContentCollection('labs', mergedLabs).catch(() => {});
  }, [mergedLabs]);

  // Email/Password Registration with Atomic Firestore Profile Creation
  const handleEmailSignUp = async (input: {
    fullName: string;
    email: string;
    password: string;
    track: TrackId;
    grade: string;
    studyLang?: StudyLanguage;
  }) => {
    const cleanEmail = input.email.trim();
    const cleanName = input.fullName.trim();
    const resolvedStudyLang: StudyLanguage =
      input.studyLang || (input.track === 'american' ? 'bilingual' : lang);
    signupInFlightRef.current = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, input.password);
      await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});

      const userRef = doc(db, 'users', cred.user.uid);
      const isBootstrapAdmin = cred.user.email === ADMIN_BOOTSTRAP_EMAIL && cred.user.emailVerified;
      const newProfile: UserProfile = {
        uid: cred.user.uid,
        displayName: cleanName,
        email: cred.user.email || cleanEmail,
        photoURL: cred.user.photoURL || '',
        track: input.track,
        grade: input.grade,
        preferredLang: lang,
        studyLang: resolvedStudyLang,
        role: isBootstrapAdmin ? 'admin' : 'student',
        points: 0,
        level: 1,
        badges: [],
      };

      try {
        const existingSnap = await getDoc(userRef);
        if (existingSnap.exists()) {
          const existingData = existingSnap.data() as UserProfile;
          const resolved = {
            ...existingData,
            role: isBootstrapAdmin ? 'admin' : existingData.role,
          };
          setProfile(resolved);
          saveOfflineSessionProfile(resolved).catch(() => {});
        } else {
          await setDoc(userRef, {
            ...newProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setProfile(newProfile);
          saveOfflineSessionProfile(newProfile).catch(() => {});
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${cred.user.uid}`);
      }

      setActiveSection('dashboard');
    } finally {
      signupInFlightRef.current = false;
    }
  };

  // Offline-first & Conflict-safe Student Mutations
  const handleSaveTrackSelection = async (
    track: TrackId,
    grade: string,
    displayName?: string,
    selectedStudyLang?: StudyLanguage
  ) => {
    if (!firebaseUser) return;
    const ref = doc(db, 'users', firebaseUser.uid);
    const trimmedName = displayName?.trim().slice(0, 120);
    const resolvedStudyLang: StudyLanguage =
      selectedStudyLang || (track === 'american' ? profile?.studyLang || 'bilingual' : lang);

    const optimisticProfile: UserProfile = profile
      ? {
          ...profile,
          track,
          grade,
          preferredLang: lang,
          studyLang: resolvedStudyLang,
          ...(trimmedName ? { displayName: trimmedName } : {}),
        }
      : {
          uid: firebaseUser.uid,
          displayName: trimmedName || sanitizeDisplayName(firebaseUser.displayName, firebaseUser.email),
          email: sanitizeEmail(firebaseUser),
          photoURL: sanitizePhotoUrl(firebaseUser.photoURL),
          track,
          grade,
          preferredLang: lang,
          studyLang: resolvedStudyLang,
          role:
            firebaseUser.email === ADMIN_BOOTSTRAP_EMAIL && firebaseUser.emailVerified
              ? 'admin'
              : 'student',
          points: 0,
          level: 1,
          badges: [],
        };

    setProfile(optimisticProfile);
    await saveOfflineSessionProfile(optimisticProfile);
    setShowTrackSwitcher(false);

    const patchPayload: Record<string, any> = {
      track,
      grade,
      preferredLang: lang,
      studyLang: resolvedStudyLang,
    };
    if (trimmedName) {
      patchPayload.displayName = trimmedName;
      updateProfile(firebaseUser, { displayName: trimmedName }).catch(() => {});
    }

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'profilePatch',
        entityId: firebaseUser.uid,
        op: 'upsert',
        payload: patchPayload,
      });
      return;
    }

    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          ...patchPayload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(
          ref,
          {
            ...optimisticProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      setProfileSyncWarning(null);
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'profilePatch',
          entityId: firebaseUser.uid,
          op: 'upsert',
          payload: patchPayload,
        });
      } else {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }
  };

  const handleToggleLang = async () => {
    const next: Language = lang === 'ar' ? 'en' : 'ar';
    setLang(next);
    if (firebaseUser && profile) {
      const nextProf = { ...profile, preferredLang: next };
      setProfile(nextProf);
      saveOfflineSessionProfile(nextProf).catch(() => {});
      if (isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'profilePatch',
          entityId: firebaseUser.uid,
          op: 'upsert',
          payload: { preferredLang: next },
        });
        return;
      }
      try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          preferredLang: next,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // non-blocking preference sync
      }
    }
  };

  const handleChangeStudyLang = async (next: StudyLanguage) => {
    if (profile) {
      const nextProf = { ...profile, studyLang: next };
      setProfile(nextProf);
      saveOfflineSessionProfile(nextProf).catch(() => {});
    }
    if (firebaseUser && profile) {
      if (isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'profilePatch',
          entityId: firebaseUser.uid,
          op: 'upsert',
          payload: { studyLang: next },
        });
        return;
      }
      try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          studyLang: next,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        if (isFirestoreOfflineError(err) || isBrowserOffline()) {
          await enqueueSyncMutation({
            uid: firebaseUser.uid,
            entityType: 'profilePatch',
            entityId: firebaseUser.uid,
            op: 'upsert',
            payload: { studyLang: next },
          });
        } else {
          handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
        }
      }
    }
  };

  const handleAwardPoints = async (addPoints: number, badgeName?: string) => {
    if (!firebaseUser || !profile || profile.track === 'unset') return;
    const nextPoints = (profile.points || 0) + addPoints;
    const nextLevel = Math.max(1, Math.floor(nextPoints / 150) + 1);
    const currentBadges = profile.badges || [];
    const nextBadges =
      badgeName && !currentBadges.includes(badgeName) ? [...currentBadges, badgeName].slice(0, 30) : currentBadges;

    const updatedProf: UserProfile = {
      ...profile,
      points: nextPoints,
      level: nextLevel,
      badges: nextBadges,
    };
    setProfile(updatedProf);
    await saveOfflineSessionProfile(updatedProf);

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'pointsAward',
        entityId: firebaseUser.uid,
        op: 'upsert',
        payload: { addPoints, badgeName },
      });
      return;
    }

    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        points: nextPoints,
        level: nextLevel,
        badges: nextBadges,
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'leaderboardPublic', firebaseUser.uid), {
        uid: firebaseUser.uid,
        displayName: profile.displayName,
        track: profile.track,
        grade: profile.grade,
        points: nextPoints,
        accuracy: 100,
        level: nextLevel,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'pointsAward',
          entityId: firebaseUser.uid,
          op: 'upsert',
          payload: { addPoints, badgeName },
        });
      } else {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }
  };

  const handleSaveProgress = async (
    lessonId: string,
    completedParts: string[],
    isCompleted: boolean,
    quizScore: number
  ) => {
    if (!firebaseUser || !profile || profile.track === 'unset') return;
    const existing = progressMap[lessonId];
    const mergedParts = Array.from(new Set([...(existing?.completedParts || []), ...completedParts]));
    const nextProgress: LessonProgress = {
      userId: firebaseUser.uid,
      lessonId,
      track: profile.track,
      completedParts: mergedParts,
      isCompleted: Boolean(existing?.isCompleted || isCompleted),
      quizScore: Math.max(quizScore, existing?.quizScore || 0),
      studyMinutes: (existing?.studyMinutes || 0) + 15,
      lastAccessedAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Optimistic update + IndexedDB persist immediately
    setProgressMap((prev) => ({ ...prev, [lessonId]: nextProgress }));
    await saveOfflineProgressItem(firebaseUser.uid, nextProgress);

    const awardLessonBadge = isCompleted && !existing?.isCompleted;

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'progress',
        entityId: lessonId,
        op: 'upsert',
        payload: nextProgress,
      });
      if (awardLessonBadge) {
        await handleAwardPoints(40, 'Lesson Master');
      }
      return;
    }

    const ref = doc(db, 'users', firebaseUser.uid, 'progress', lessonId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          completedParts: nextProgress.completedParts,
          isCompleted: nextProgress.isCompleted,
          quizScore: nextProgress.quizScore,
          studyMinutes: nextProgress.studyMinutes,
          lastAccessedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          userId: nextProgress.userId,
          lessonId: nextProgress.lessonId,
          track: nextProgress.track,
          completedParts: nextProgress.completedParts,
          isCompleted: nextProgress.isCompleted,
          quizScore: nextProgress.quizScore,
          studyMinutes: nextProgress.studyMinutes,
          lastAccessedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      if (awardLessonBadge) {
        await handleAwardPoints(40, 'Lesson Master');
      }
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'progress',
          entityId: lessonId,
          op: 'upsert',
          payload: nextProgress,
        });
        if (awardLessonBadge) {
          await handleAwardPoints(40, 'Lesson Master');
        }
      } else {
        handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/progress/${lessonId}`);
      }
    }
  };

  const handleSaveTask = async (task: StudyTask) => {
    if (!firebaseUser) return;
    const cleanTask: StudyTask = { ...task, lessonId: task.lessonId || '', updatedAt: Date.now() };
    const exists = studyTasks.some((t) => t.id === task.id);

    setStudyTasks((prev) =>
      exists ? prev.map((t) => (t.id === task.id ? cleanTask : t)) : [cleanTask, ...prev]
    );
    await saveOfflineTask(cleanTask);

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'studyTask',
        entityId: task.id,
        op: 'upsert',
        payload: cleanTask,
      });
      return;
    }

    const ref = doc(db, 'users', firebaseUser.uid, 'studyTasks', task.id);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          title: cleanTask.title,
          lessonId: cleanTask.lessonId || '',
          scheduledDate: cleanTask.scheduledDate,
          durationMinutes: cleanTask.durationMinutes,
          taskType: cleanTask.taskType,
          completed: cleanTask.completed,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...cleanTask,
          lessonId: cleanTask.lessonId || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'studyTask',
          entityId: task.id,
          op: 'upsert',
          payload: cleanTask,
        });
      } else {
        handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/studyTasks/${task.id}`);
      }
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!firebaseUser) return;
    setStudyTasks((prev) => prev.filter((t) => t.id !== taskId));
    await deleteOfflineTask(taskId);

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'studyTask',
        entityId: taskId,
        op: 'delete',
        payload: { id: taskId },
      });
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', firebaseUser.uid, 'studyTasks', taskId));
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'studyTask',
          entityId: taskId,
          op: 'delete',
          payload: { id: taskId },
        });
      } else {
        handleFirestoreError(err, OperationType.DELETE, `users/${firebaseUser.uid}/studyTasks/${taskId}`);
      }
    }
  };

  const handleSaveAttempt = async (attempt: ExamAttempt) => {
    if (!firebaseUser) return;
    const existingLocal = examAttempts.find((a) => a.id === attempt.id);
    const nextAttempt: ExamAttempt = { ...attempt, updatedAt: { seconds: Math.floor(Date.now() / 1000) } };
    const shouldAwardExamPoints =
      attempt.status === 'submitted' && attempt.score > 0 && existingLocal?.status !== 'submitted';

    setExamAttempts((prev) =>
      prev.some((a) => a.id === attempt.id)
        ? prev.map((a) => (a.id === attempt.id ? nextAttempt : a))
        : [nextAttempt, ...prev]
    );
    await saveOfflineAttempt(nextAttempt);

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'examAttempt',
        entityId: attempt.id,
        op: 'upsert',
        payload: nextAttempt,
      });
      if (shouldAwardExamPoints) {
        await handleAwardPoints(attempt.score * 25);
      }
      return;
    }

    const ref = doc(db, 'users', firebaseUser.uid, 'examAttempts', attempt.id);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        if (snap.data()?.status === 'in_progress') {
          await updateDoc(ref, {
            status: attempt.status,
            score: attempt.score,
            answersJson: attempt.answersJson || '{}',
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        await setDoc(ref, {
          ...attempt,
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      if (shouldAwardExamPoints) {
        await handleAwardPoints(attempt.score * 25);
      }
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'examAttempt',
          entityId: attempt.id,
          op: 'upsert',
          payload: nextAttempt,
        });
        if (shouldAwardExamPoints) {
          await handleAwardPoints(attempt.score * 25);
        }
      } else {
        handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/examAttempts/${attempt.id}`);
      }
    }
  };

  const handleSaveSession = async (session: TutorSession) => {
    if (!firebaseUser) return;
    const cleanSession: TutorSession = { ...session, updatedAt: { seconds: Math.floor(Date.now() / 1000) } };
    setTutorSessions((prev) => {
      const exists = prev.some((s) => s.id === session.id);
      return exists ? prev.map((s) => (s.id === session.id ? cleanSession : s)) : [cleanSession, ...prev];
    });
    await saveOfflineTutorSession(cleanSession);

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'tutorSession',
        entityId: session.id,
        op: 'upsert',
        payload: cleanSession,
      });
      return;
    }

    const ref = doc(db, 'users', firebaseUser.uid, 'tutorSessions', session.id);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          title: session.title,
          mode: session.mode,
          messagesJson: session.messagesJson,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...session,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'tutorSession',
          entityId: session.id,
          op: 'upsert',
          payload: cleanSession,
        });
      } else {
        handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/tutorSessions/${session.id}`);
      }
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!firebaseUser) return;
    setTutorSessions((prev) => prev.filter((s) => s.id !== sessionId));
    await deleteOfflineTutorSession(sessionId);

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'tutorSession',
        entityId: sessionId,
        op: 'delete',
        payload: { id: sessionId },
      });
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', firebaseUser.uid, 'tutorSessions', sessionId));
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'tutorSession',
          entityId: sessionId,
          op: 'delete',
          payload: { id: sessionId },
        });
      } else {
        handleFirestoreError(err, OperationType.DELETE, `users/${firebaseUser.uid}/tutorSessions/${sessionId}`);
      }
    }
  };

  const handleSaveGraph = async (graph: SavedGraph) => {
    if (!firebaseUser) return;
    setSavedGraphs((prev) =>
      prev.some((g) => g.id === graph.id) ? prev.map((g) => (g.id === graph.id ? graph : g)) : [graph, ...prev]
    );
    await saveOfflineGraph(graph);

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'savedGraph',
        entityId: graph.id,
        op: 'upsert',
        payload: graph,
      });
      return;
    }

    const ref = doc(db, 'users', firebaseUser.uid, 'graphs', graph.id);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          title: graph.title,
          graphType: graph.graphType,
          xLabel: graph.xLabel,
          yLabel: graph.yLabel,
          pointsJson: graph.pointsJson,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...graph,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'savedGraph',
          entityId: graph.id,
          op: 'upsert',
          payload: graph,
        });
      } else {
        handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/graphs/${graph.id}`);
      }
    }
  };

  const handleDeleteGraph = async (graphId: string) => {
    if (!firebaseUser) return;
    setSavedGraphs((prev) => prev.filter((g) => g.id !== graphId));
    await deleteOfflineGraph(graphId);

    if (isBrowserOffline()) {
      await enqueueSyncMutation({
        uid: firebaseUser.uid,
        entityType: 'savedGraph',
        entityId: graphId,
        op: 'delete',
        payload: { id: graphId },
      });
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', firebaseUser.uid, 'graphs', graphId));
    } catch (err) {
      if (isFirestoreOfflineError(err) || isBrowserOffline()) {
        await enqueueSyncMutation({
          uid: firebaseUser.uid,
          entityType: 'savedGraph',
          entityId: graphId,
          op: 'delete',
          payload: { id: graphId },
        });
      } else {
        handleFirestoreError(err, OperationType.DELETE, `users/${firebaseUser.uid}/graphs/${graphId}`);
      }
    }
  };

  // Offline Favorites, Study Notes & Exam Resume Handlers
  const handleRefreshSaved = useCallback(async () => {
    if (!firebaseUser) return;
    const [nextFavs, nextNotes] = await Promise.all([
      getOfflineFavorites(firebaseUser.uid),
      getOfflineNotes(firebaseUser.uid),
    ]);
    setFavorites(nextFavs);
    setNotes(nextNotes);
  }, [firebaseUser]);

  const handleToggleFavorite = async (item: {
    itemType: 'lesson' | 'formula' | 'question';
    itemId: string;
    titleAr: string;
    titleEn: string;
  }) => {
    if (!firebaseUser) return;
    await toggleFavoriteItem({
      uid: firebaseUser.uid,
      ...item,
    });
    await handleRefreshSaved();
  };

  const handleSaveNote = async (note: {
    itemType: 'lesson' | 'formula' | 'question';
    itemId: string;
    title: string;
    content: string;
  }) => {
    if (!firebaseUser) return;
    await saveOfflineNote({
      uid: firebaseUser.uid,
      ...note,
    });
    await handleRefreshSaved();
  };

  const handleSaveActiveExamSnapshot = async (snapshot: ActiveExamSnapshot | null) => {
    setActiveExamSnapshot(snapshot);
    await saveActiveExamSnapshot(snapshot, firebaseUser?.uid);
  };

  const handleSignOut = async () => {
    await saveOfflineSessionProfile(null).catch(() => {});
    await signOut(auth);
  };

  // Admin Mutations
  const handleAdminSaveLesson = async (lesson: Lesson) => {
    try {
      await setDoc(doc(db, 'curricula', lesson.id), {
        id: lesson.id,
        track: lesson.track,
        grade: lesson.grade,
        titleAr: lesson.titleAr,
        titleEn: lesson.titleEn,
        payloadJson: JSON.stringify(lesson),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `curricula/${lesson.id}`);
    }
  };

  const handleAdminDeleteLesson = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'curricula', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `curricula/${id}`);
    }
  };

  const handleAdminSaveQuestion = async (q: QuestionItem) => {
    try {
      await setDoc(doc(db, 'questions', q.id), {
        id: q.id,
        track: q.track,
        grade: q.grade,
        difficulty: q.difficulty,
        payloadJson: JSON.stringify(q),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `questions/${q.id}`);
    }
  };

  const handleAdminDeleteQuestion = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'questions', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `questions/${id}`);
    }
  };

  const handleAdminSaveExam = async (exam: ExamBlueprint) => {
    try {
      await setDoc(doc(db, 'exams', exam.id), {
        id: exam.id,
        track: exam.track,
        grade: exam.grade,
        titleAr: exam.titleAr,
        titleEn: exam.titleEn,
        payloadJson: JSON.stringify(exam),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `exams/${exam.id}`);
    }
  };

  const handleAdminDeleteExam = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'exams', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `exams/${id}`);
    }
  };

  const handleAdminSaveLab = async (lab: LabExperimentConfig) => {
    try {
      await setDoc(doc(db, 'labConfigs', lab.id), {
        id: lab.id,
        category: lab.category,
        payloadJson: JSON.stringify(lab),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `labConfigs/${lab.id}`);
    }
  };

  const handleAdminSaveAnnouncement = async (ann: {
    id: string;
    titleAr: string;
    titleEn: string;
    bodyAr: string;
    bodyEn: string;
  }) => {
    try {
      await setDoc(doc(db, 'platformSettings', ann.id), {
        id: ann.id,
        payloadJson: JSON.stringify(ann),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `platformSettings/${ann.id}`);
    }
  };

  const t = tFor(lang);

  if (!authReady) {
    return (
      <div className="min-h-screen relative physics-space-canvas physics-grid-bg flex items-center justify-center text-slate-900 dark:text-slate-100">
        <PhysicsAmbientBg />
        <div className="relative z-10 glass-card rounded-2xl px-6 py-4 flex items-center gap-3 text-sm font-medium">
          <span className="glass-icon glass-icon-cyan w-9 h-9">
            <Atom className="w-5 h-5 animate-spin" />
          </span>
          <span>{t.common.loading}</span>
        </div>
      </div>
    );
  }

  // Gate 1: Not signed in OR hasn't chosen track/grade OR user clicked "Switch Track & Grade"
  if (!firebaseUser || !profile || profile.track === 'unset' || showTrackSwitcher) {
    return (
      <AuthOnboarding
        lang={lang}
        theme={theme}
        onToggleLang={handleToggleLang}
        onToggleTheme={() => setTheme((th) => (th === 'dark' ? 'light' : 'dark'))}
        firebaseUser={firebaseUser}
        userProfile={profile}
        initialAuthError={redirectAuthError}
        initialPendingLink={redirectPendingLink}
        profileSyncWarning={profileSyncWarning}
        onClearRedirectError={() => {
          setRedirectAuthError(null);
          setRedirectPendingLink(null);
        }}
        onRegisterWithEmail={handleEmailSignUp}
        onSaveTrackSelection={handleSaveTrackSelection}
        onCancelSwitch={profile && profile.track !== 'unset' ? () => setShowTrackSwitcher(false) : undefined}
      />
    );
  }

  const studyLang = resolveStudyLanguage(profile.studyLang, lang, profile.track);
  const trackLabel = getTrackLabel(profile.track, studyLang);
  const gradeLabel = getGradeLabel(profile.track, profile.grade, studyLang);

  const navGroups: Array<{
    groupLabel: string;
    items: Array<{ id: NavSection; label: string; icon: React.ReactNode }>;
  }> = [
    {
      groupLabel: t.groups.learn,
      items: [
        { id: 'dashboard', label: t.nav.dashboard, icon: <LayoutDashboard className="w-4 h-4" /> },
        { id: 'curriculum', label: t.nav.curriculum, icon: <BookOpen className="w-4 h-4" /> },
        { id: 'formulas', label: t.nav.formulas, icon: <Sigma className="w-4 h-4" /> },
      ],
    },
    {
      groupLabel: t.groups.practice,
      items: [
        { id: 'lab', label: t.nav.lab, icon: <FlaskConical className="w-4 h-4" /> },
        { id: 'graphing', label: t.nav.graphing, icon: <LineChart className="w-4 h-4" /> },
      ],
    },
    {
      groupLabel: t.groups.smart,
      items: [
        { id: 'tutor', label: t.nav.tutor, icon: <Bot className="w-4 h-4" /> },
        { id: 'solver', label: t.nav.solver, icon: <Calculator className="w-4 h-4" /> },
      ],
    },
    {
      groupLabel: t.groups.progress,
      items: [
        { id: 'planner', label: t.nav.planner, icon: <CalendarClock className="w-4 h-4" /> },
        { id: 'challenges', label: t.nav.challenges, icon: <Trophy className="w-4 h-4" /> },
        { id: 'analytics', label: t.nav.analytics, icon: <BarChart3 className="w-4 h-4" /> },
      ],
    },
  ];

  const openLesson = (lessonId: string) => {
    setSelectedLessonId(lessonId);
    setActiveSection('curriculum');
    setMobileMenuOpen(false);
  };

  const openOfflineCenter = (tab: 'downloads' | 'storage' | 'saved' = 'downloads') => {
    setOfflineCenterTab(tab);
    setOfflineCenterOpen(true);
    setMobileMenuOpen(false);
  };

  const completedPacksCount = downloadPacks.filter((p) => p.status === 'completed').length;

  const lazyFallback = (
    <div className="glass-card rounded-2xl p-8 flex items-center justify-center gap-3 text-sm font-medium min-h-[260px]">
      <span className="glass-icon glass-icon-cyan w-9 h-9">
        <Atom className="w-5 h-5 animate-spin" />
      </span>
      <span>{t.common.loading}</span>
    </div>
  );

  return (
    <div className="min-h-screen relative physics-space-canvas physics-grid-bg text-slate-900 dark:text-slate-100 flex">
      <PhysicsAmbientBg />

      {/* Desktop Sidebar (260px) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-e glass-sidebar sticky top-0 h-screen z-20">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200/70 dark:border-white/10">
          <span className="glass-icon glass-icon-cyan w-9 h-9 shrink-0">
            <Atom className="w-5 h-5" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">Physics Smart</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              <p className="px-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400/80">
                {group.groupLabel}
              </p>
              {group.items.map((item) => {
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveSection(item.id);
                      if (item.id !== 'curriculum') setSelectedLessonId(null);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                      active
                        ? 'glass-btn-primary text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/[0.06] border border-transparent hover:border-slate-200/70 dark:hover:border-white/10 active:scale-[0.98]'
                    }`}
                  >
                    <span className={active ? 'text-white' : 'text-blue-600 dark:text-cyan-400/90'}>
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-200/70 dark:border-white/10 space-y-1.5">
          <button
            onClick={() => openOfflineCenter('downloads')}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 glass-btn-secondary cursor-pointer"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <HardDrive className="w-4 h-4 text-blue-600 dark:text-cyan-400 shrink-0" />
              <span className="truncate">{lang === 'ar' ? 'مركز أوفلاين والتخزين' : 'Offline & Storage'}</span>
            </span>
            {(completedPacksCount > 0 || favorites.length > 0) && (
              <span className="px-1.5 py-0.5 rounded-md bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 font-mono-num text-[10px]">
                {completedPacksCount + favorites.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowTrackSwitcher(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 glass-btn-secondary cursor-pointer"
          >
            <Settings2 className="w-4 h-4 text-blue-600 dark:text-cyan-400" />
            <span className="truncate">{t.common.changeTrack}</span>
          </button>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/12 border border-transparent hover:border-rose-500/20 transition-all active:scale-[0.98] cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.common.signOut}</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-72 max-w-[85vw] glass-modal h-full flex flex-col p-4 z-10 overflow-y-auto glass-enter">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200/70 dark:border-white/10">
              <div className="flex items-center gap-2.5">
                <span className="glass-icon glass-icon-cyan w-8 h-8">
                  <Atom className="w-4 h-4" />
                </span>
                <span className="font-display font-bold">Physics Smart</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 rounded-lg glass-btn-secondary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 py-4 space-y-4">
              {navGroups.map((group, gIdx) => (
                <div key={gIdx} className="space-y-1">
                  <p className="px-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{group.groupLabel}</p>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveSection(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                        activeSection === item.id
                          ? 'glass-btn-primary text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            <div className="pt-3 border-t border-slate-200/70 dark:border-white/10 space-y-2">
              <button
                onClick={() => openOfflineCenter('downloads')}
                className="w-full py-2 px-3 rounded-xl glass-btn-secondary text-xs font-medium flex items-center justify-between"
              >
                <span>{lang === 'ar' ? 'مركز أوفلاين والتخزين' : 'Offline & Storage'}</span>
                <HardDrive className="w-3.5 h-3.5 text-cyan-500" />
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setShowTrackSwitcher(true);
                }}
                className="w-full py-2 px-3 rounded-xl glass-btn-secondary text-xs font-medium"
              >
                {t.common.changeTrack}
              </button>
              <button
                onClick={handleSignOut}
                className="w-full py-2 px-3 rounded-xl text-xs font-medium text-rose-500 hover:bg-rose-500/10 transition-colors"
              >
                {t.common.signOut}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {/* Top Bar: Clean Breadcrumb + Offline Status / PWA Install + Language/Theme Controls */}
        <header className="h-16 px-4 sm:px-6 border-b glass-topbar sticky top-0 z-30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl glass-btn-secondary"
              aria-label="Menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
                {trackLabel} · {gradeLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <OfflineStatusBar
              lang={lang}
              isOnline={isOnline}
              syncStatus={syncStatus}
              downloadedPacksCount={completedPacksCount}
              favoritesCount={favorites.length}
              offlineReady={swUpdates.offlineReady}
              onDismissOfflineReady={swUpdates.dismissOfflineReady}
              needRefresh={swUpdates.needRefresh}
              updating={swUpdates.updating}
              onApplyUpdate={swUpdates.applyUpdate}
              onDismissUpdate={swUpdates.dismissUpdate}
              onTriggerSync={handleTriggerSync}
              onOpenOfflineCenter={openOfflineCenter}
            />
            <div className="hidden md:flex items-center">
              <StudyLanguageSwitcher
                value={studyLang}
                onChange={handleChangeStudyLang}
                uiLang={lang}
                compact
              />
            </div>
            <button
              onClick={handleToggleLang}
              className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400" />
              <span className="hidden sm:inline">{t.common.switchLang}</span>
            </button>
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-xl glass-btn-secondary cursor-pointer"
              title={lang === 'ar' ? 'ملء الشاشة' : 'Toggle Fullscreen'}
              aria-label="Toggle Fullscreen"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 text-blue-600 dark:text-cyan-400" />
              ) : (
                <Maximize2 className="w-4 h-4 text-blue-600 dark:text-cyan-400" />
              )}
            </button>
            <button
              onClick={() => setTheme((th) => (th === 'dark' ? 'light' : 'dark'))}
              className="p-2 rounded-xl glass-btn-secondary cursor-pointer"
              aria-label="Theme toggle"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>
          </div>
        </header>

        <main key={activeSection} className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto glass-enter">
          {profileSyncWarning && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3">
              <span>{profileSyncWarning}</span>
              <button
                type="button"
                onClick={() => setProfileSyncWarning(null)}
                className="px-2 py-1 rounded-lg glass-btn-secondary text-[11px] font-medium shrink-0"
              >
                {lang === 'ar' ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}

          <ErrorBoundary lang={lang}>
            <Suspense fallback={lazyFallback}>
              {activeSection === 'dashboard' && (
                <DashboardView
                  lang={lang}
                  studyLang={studyLang}
                  onChangeStudyLang={handleChangeStudyLang}
                  profile={profile}
                  lessons={mergedLessons}
                  progressMap={progressMap}
                  examAttempts={examAttempts}
                  studyTasks={studyTasks}
                  announcements={announcements}
                  onNavigate={(sec) => setActiveSection(sec)}
                  onOpenLesson={openLesson}
                  onToggleTask={(task) => handleSaveTask({ ...task, completed: !task.completed })}
                />
              )}

              {activeSection === 'curriculum' && (
                <CurriculumView
                  lang={lang}
                  studyLang={studyLang}
                  onChangeStudyLang={handleChangeStudyLang}
                  profile={profile}
                  lessons={mergedLessons}
                  questions={mergedQuestions}
                  progressMap={progressMap}
                  selectedLessonId={selectedLessonId}
                  onSelectLesson={setSelectedLessonId}
                  onSaveProgress={handleSaveProgress}
                  onAskTutorWithLesson={(lesson) => {
                    setTutorLessonContext(lesson);
                    setActiveSection('tutor');
                  }}
                  isOnline={isOnline}
                  downloadPacks={downloadPacks}
                  onDownloadPacksChange={setDownloadPacks}
                  favorites={favorites}
                  onToggleFavorite={handleToggleFavorite}
                  notes={notes}
                  onSaveNote={handleSaveNote}
                  onOpenOfflineDownloads={() => openOfflineCenter('downloads')}
                />
              )}

              {activeSection === 'formulas' && (
                <FormulaLibraryView
                  lang={lang}
                  studyLang={studyLang}
                  formulas={FORMULAS_SEED}
                  onOpenLesson={openLesson}
                  favorites={favorites}
                  onToggleFavorite={handleToggleFavorite}
                />
              )}

              {activeSection === 'lab' && <VirtualLabView lang={lang} studyLang={studyLang} labs={mergedLabs} />}

              {activeSection === 'graphing' && (
                <GraphingToolView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  savedGraphs={savedGraphs}
                  onSaveGraph={handleSaveGraph}
                  onDeleteGraph={handleDeleteGraph}
                />
              )}

              {activeSection === 'questions' && (
                <QuestionBankView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  questions={mergedQuestions}
                  favorites={favorites}
                  onToggleFavorite={handleToggleFavorite}
                />
              )}

              {activeSection === 'exams' && (
                <ExamsView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  exams={mergedExams}
                  questions={mergedQuestions}
                  attempts={examAttempts}
                  onSaveAttempt={handleSaveAttempt}
                  activeSnapshot={activeExamSnapshot}
                  onSaveSnapshot={handleSaveActiveExamSnapshot}
                  onExamActiveChange={setIsExamActive}
                  isOnline={isOnline}
                />
              )}

              {activeSection === 'tutor' && (
                <TutorView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  lessons={mergedLessons}
                  sessions={tutorSessions}
                  initialLessonContext={tutorLessonContext}
                  onSaveSession={handleSaveSession}
                  onDeleteSession={handleDeleteSession}
                  isOnline={isOnline}
                  onOpenLesson={openLesson}
                />
              )}

              {activeSection === 'solver' && (
                <SolverView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  lessons={mergedLessons}
                  isOnline={isOnline}
                  onOpenLesson={openLesson}
                />
              )}

              {activeSection === 'planner' && (
                <StudyPlannerView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  lessons={mergedLessons}
                  progressMap={progressMap}
                  tasks={studyTasks}
                  onSaveTask={handleSaveTask}
                  onDeleteTask={handleDeleteTask}
                />
              )}

              {activeSection === 'challenges' && (
                <ChallengesView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  challenges={CHALLENGES_SEED}
                  leaderboard={leaderboard}
                  onAwardPoints={handleAwardPoints}
                />
              )}

              {activeSection === 'analytics' && (
                <AnalyticsView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  lessons={mergedLessons}
                  progressMap={progressMap}
                  attempts={examAttempts}
                  onOpenLesson={openLesson}
                />
              )}

              {activeSection === 'admin' && (
                <AdminDashboardView
                  lang={lang}
                  studyLang={studyLang}
                  profile={profile}
                  lessons={mergedLessons}
                  questions={mergedQuestions}
                  exams={mergedExams}
                  labs={mergedLabs}
                  students={adminStudents}
                  announcements={announcements}
                  onSaveLesson={handleAdminSaveLesson}
                  onDeleteLesson={handleAdminDeleteLesson}
                  onSaveQuestion={handleAdminSaveQuestion}
                  onDeleteQuestion={handleAdminDeleteQuestion}
                  onSaveExam={handleAdminSaveExam}
                  onDeleteExam={handleAdminDeleteExam}
                  onSaveLab={handleAdminSaveLab}
                  onSaveAnnouncement={handleAdminSaveAnnouncement}
                />
              )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Offline Center Modal (Content Downloader, Storage Manager, Favorites & Notes) */}
      <OfflineCenterModal
        open={offlineCenterOpen}
        initialTab={offlineCenterTab}
        onClose={() => setOfflineCenterOpen(false)}
        lang={lang}
        studyLang={studyLang}
        profile={profile}
        lessons={mergedLessons}
        questions={mergedQuestions}
        downloadPacks={downloadPacks}
        onDownloadPacksChange={setDownloadPacks}
        favorites={favorites}
        notes={notes}
        onRefreshSaved={handleRefreshSaved}
        onOpenLesson={openLesson}
        syncStatus={syncStatus}
        isOnline={isOnline}
        onTriggerSync={handleTriggerSync}
      />
    </div>
  );
}
