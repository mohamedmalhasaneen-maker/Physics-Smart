import React, { useEffect, useState } from 'react';
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
  OperationType,
  serverTimestamp,
  signOut,
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
import { DashboardView } from './components/DashboardView';
import { CurriculumView } from './components/CurriculumView';
import { TutorView } from './components/TutorView';
import { SolverView } from './components/SolverView';
import { VirtualLabView } from './components/VirtualLabView';
import { QuestionBankView } from './components/QuestionBankView';
import { ExamsView } from './components/ExamsView';
import { FormulaLibraryView } from './components/FormulaLibraryView';
import { GraphingToolView } from './components/GraphingToolView';
import { ChallengesView } from './components/ChallengesView';
import { StudyPlannerView } from './components/StudyPlannerView';
import { AnalyticsView } from './components/AnalyticsView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { PhysicsAmbientBg } from './components/PhysicsAmbientBg';
import {
  Atom,
  BarChart3,
  BookOpen,
  Bot,
  Calculator,
  CalendarClock,
  ClipboardCheck,
  FlaskConical,
  Globe,
  HelpCircle,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Moon,
  Settings2,
  Shield,
  Sigma,
  Sun,
  Trophy,
  X,
} from 'lucide-react';

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

  // Sync HTML dir/lang/theme
  useEffect(() => {
    const root = document.documentElement;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    root.lang = lang;
    root.classList.toggle('dark', theme === 'dark');
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

  // Initial Firestore connection test + Google redirect completion + Auth listener
  useEffect(() => {
    testFirestoreConnection();
    const handleOnline = () => {
      testFirestoreConnection();
    };
    window.addEventListener('online', handleOnline);

    // Inspect redirect sign-in result if returning from signInWithRedirect
    getRedirectResult(auth, browserPopupRedirectResolver).catch(async (err) => {
      console.error('Google redirect sign-in error:', err);
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

      const safeName = sanitizeDisplayName(user.displayName, user.email);
      const safePhoto = sanitizePhotoUrl(user.photoURL);
      const isBootstrapAdmin = user.email === ADMIN_BOOTSTRAP_EMAIL && user.emailVerified;
      const fallbackProfile: UserProfile = {
        uid: user.uid,
        displayName: safeName,
        email: (user.email || '').slice(0, 200),
        photoURL: safePhoto,
        track: 'unset',
        grade: '',
        preferredLang: lang,
        role: isBootstrapAdmin ? 'admin' : 'student',
        points: 0,
        level: 1,
        badges: [],
      };

      try {
        const userRef = doc(db, 'users', user.uid);
        let snap;
        let readFailed = false;
        try {
          snap = await getDoc(userRef);
        } catch (err) {
          if (isFirestoreOfflineError(err)) {
            await new Promise((r) => setTimeout(r, 1000));
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
          if (data.preferredLang) setLang(data.preferredLang);

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
          setProfile(fallbackProfile);
          try {
            await setDoc(
              userRef,
              {
                ...fallbackProfile,
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
          // Auth succeeded while Firestore read was unreachable/offline; allow user to continue without blocking Auth
          setProfile(fallbackProfile);
          if (readFailed) {
            setProfileSyncWarning(
              lang === 'ar'
                ? 'تم تسجيل الدخول بنجاح. يتم العمل مؤقتًا حتى تستقر المزامنة السحابية لملفك الشخصي.'
                : 'Signed in successfully. Cloud profile sync will automatically resume once connected.'
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

  // Real-time Firestore listeners once signed in
  useEffect(() => {
    if (!firebaseUser || !profile) return;

    const uid = firebaseUser.uid;
    const unsubs: Array<() => void> = [];
    const handleListenerError = (err: unknown, op: OperationType, path: string) => {
      if (isFirestoreOfflineError(err)) {
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
            setProfile({ ...d, role: isBootstrapAdmin ? 'admin' : d.role });
          }
        },
        (err) => handleListenerError(err, OperationType.GET, `users/${uid}`)
      )
    );

    // 2. Progress subcollection
    const progQ = query(collection(db, 'users', uid, 'progress'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        progQ,
        (snap) => {
          const map: Record<string, LessonProgress> = {};
          snap.docs.forEach((d) => {
            map[d.id] = d.data() as LessonProgress;
          });
          setProgressMap(map);
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/progress`)
      )
    );

    // 3. Study tasks
    const tasksQ = query(collection(db, 'users', uid, 'studyTasks'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        tasksQ,
        (snap) => {
          setStudyTasks(snap.docs.map((d) => d.data() as StudyTask));
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/studyTasks`)
      )
    );

    // 4. Exam attempts
    const attemptsQ = query(collection(db, 'users', uid, 'examAttempts'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        attemptsQ,
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ExamAttempt);
          list.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
          setExamAttempts(list);
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/examAttempts`)
      )
    );

    // 5. Tutor sessions
    const sessionsQ = query(collection(db, 'users', uid, 'tutorSessions'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        sessionsQ,
        (snap) => {
          const list = snap.docs.map((d) => d.data() as TutorSession);
          list.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
          setTutorSessions(list);
        },
        (err) => handleListenerError(err, OperationType.LIST, `users/${uid}/tutorSessions`)
      )
    );

    // 6. Saved graphs
    const graphsQ = query(collection(db, 'users', uid, 'graphs'), where('userId', '==', uid));
    unsubs.push(
      onSnapshot(
        graphsQ,
        (snap) => {
          setSavedGraphs(snap.docs.map((d) => d.data() as SavedGraph));
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
          if (list.length > 0) setAnnouncements(list);
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
  }, [firebaseUser, profile?.uid, profile?.role]);

  // Merged Content (Seed + Admin Firestore overrides)
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
          setProfile({
            ...existingData,
            role: isBootstrapAdmin ? 'admin' : existingData.role,
          });
        } else {
          await setDoc(userRef, {
            ...newProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setProfile(newProfile);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${cred.user.uid}`);
      }

      setActiveSection('dashboard');
    } finally {
      signupInFlightRef.current = false;
    }
  };

  // Mutations with mandatory handleFirestoreError
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
    const updatePayload: Record<string, any> = {
      track,
      grade,
      preferredLang: lang,
      studyLang: resolvedStudyLang,
      updatedAt: serverTimestamp(),
    };
    if (trimmedName) {
      updatePayload.displayName = trimmedName;
      updateProfile(firebaseUser, { displayName: trimmedName }).catch(() => {});
    }
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await setDoc(ref, updatePayload, { merge: true });
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                track,
                grade,
                preferredLang: lang,
                studyLang: resolvedStudyLang,
                ...(trimmedName ? { displayName: trimmedName } : {}),
              }
            : prev
        );
      } else {
        const isBootstrapAdmin = firebaseUser.email === ADMIN_BOOTSTRAP_EMAIL && firebaseUser.emailVerified;
        const createdProfile: UserProfile = {
          uid: firebaseUser.uid,
          displayName: trimmedName || sanitizeDisplayName(firebaseUser.displayName, firebaseUser.email),
          email: (firebaseUser.email || '').slice(0, 200),
          photoURL: sanitizePhotoUrl(firebaseUser.photoURL),
          track,
          grade,
          preferredLang: lang,
          studyLang: resolvedStudyLang,
          role: isBootstrapAdmin ? 'admin' : 'student',
          points: 0,
          level: 1,
          badges: [],
        };
        await setDoc(
          ref,
          {
            ...createdProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        setProfile(createdProfile);
      }
      setProfileSyncWarning(null);
      setShowTrackSwitcher(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
    }
  };

  const handleToggleLang = async () => {
    const next: Language = lang === 'ar' ? 'en' : 'ar';
    setLang(next);
    if (firebaseUser && profile) {
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
      setProfile({ ...profile, studyLang: next });
    }
    if (firebaseUser && profile) {
      try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          studyLang: next,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
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
    const ref = doc(db, 'users', firebaseUser.uid, 'progress', lessonId);
    const existing = progressMap[lessonId];
    const payload = {
      userId: firebaseUser.uid,
      lessonId,
      track: profile.track,
      completedParts,
      isCompleted,
      quizScore: Math.max(quizScore, existing?.quizScore || 0),
      studyMinutes: (existing?.studyMinutes || 0) + 15,
      lastAccessedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(ref, payload);
      if (isCompleted && !existing?.isCompleted) {
        await handleAwardPoints(40, 'Lesson Master');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/progress/${lessonId}`);
    }
  };

  const handleAwardPoints = async (addPoints: number, badgeName?: string) => {
    if (!firebaseUser || !profile || profile.track === 'unset') return;
    const nextPoints = (profile.points || 0) + addPoints;
    const nextLevel = Math.max(1, Math.floor(nextPoints / 150) + 1);
    const currentBadges = profile.badges || [];
    const nextBadges =
      badgeName && !currentBadges.includes(badgeName) ? [...currentBadges, badgeName].slice(0, 30) : currentBadges;

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
      handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
    }
  };

  const handleSaveTask = async (task: StudyTask) => {
    if (!firebaseUser) return;
    const ref = doc(db, 'users', firebaseUser.uid, 'studyTasks', task.id);
    const exists = studyTasks.some((t) => t.id === task.id);
    try {
      if (exists) {
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
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/studyTasks/${task.id}`);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!firebaseUser) return;
    try {
      await deleteDoc(doc(db, 'users', firebaseUser.uid, 'studyTasks', taskId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${firebaseUser.uid}/studyTasks/${taskId}`);
    }
  };

  const handleSaveAttempt = async (attempt: ExamAttempt) => {
    if (!firebaseUser) return;
    const ref = doc(db, 'users', firebaseUser.uid, 'examAttempts', attempt.id);
    const exists = examAttempts.some((a) => a.id === attempt.id);
    try {
      if (exists) {
        await updateDoc(ref, {
          status: attempt.status,
          score: attempt.score,
          answersJson: attempt.answersJson || '{}',
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...attempt,
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      if (attempt.status === 'submitted' && attempt.score > 0) {
        await handleAwardPoints(attempt.score * 25);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/examAttempts/${attempt.id}`);
    }
  };

  const handleSaveSession = async (session: TutorSession) => {
    if (!firebaseUser) return;
    const ref = doc(db, 'users', firebaseUser.uid, 'tutorSessions', session.id);
    const exists = tutorSessions.some((s) => s.id === session.id);
    try {
      if (exists) {
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
      handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/tutorSessions/${session.id}`);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!firebaseUser) return;
    try {
      await deleteDoc(doc(db, 'users', firebaseUser.uid, 'tutorSessions', sessionId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${firebaseUser.uid}/tutorSessions/${sessionId}`);
    }
  };

  const handleSaveGraph = async (graph: SavedGraph) => {
    if (!firebaseUser) return;
    const ref = doc(db, 'users', firebaseUser.uid, 'graphs', graph.id);
    try {
      await setDoc(ref, {
        ...graph,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}/graphs/${graph.id}`);
    }
  };

  const handleDeleteGraph = async (graphId: string) => {
    if (!firebaseUser) return;
    try {
      await deleteDoc(doc(db, 'users', firebaseUser.uid, 'graphs', graphId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${firebaseUser.uid}/graphs/${graphId}`);
    }
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
        { id: 'questions', label: t.nav.questions, icon: <HelpCircle className="w-4 h-4" /> },
        { id: 'exams', label: t.nav.exams, icon: <ClipboardCheck className="w-4 h-4" /> },
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

  if (profile.role === 'admin') {
    navGroups.push({
      groupLabel: t.groups.admin,
      items: [{ id: 'admin', label: t.nav.admin, icon: <Shield className="w-4 h-4" /> }],
    });
  }

  const openLesson = (lessonId: string) => {
    setSelectedLessonId(lessonId);
    setActiveSection('curriculum');
    setMobileMenuOpen(false);
  };

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
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
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
            onClick={() => setShowTrackSwitcher(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 glass-btn-secondary"
          >
            <Settings2 className="w-4 h-4 text-blue-600 dark:text-cyan-400" />
            <span className="truncate">{t.common.changeTrack}</span>
          </button>
          <button
            onClick={() => signOut(auth)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/12 border border-transparent hover:border-rose-500/20 transition-all active:scale-[0.98]"
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
                onClick={() => {
                  setMobileMenuOpen(false);
                  setShowTrackSwitcher(true);
                }}
                className="w-full py-2 px-3 rounded-xl glass-btn-secondary text-xs font-medium"
              >
                {t.common.changeTrack}
              </button>
              <button
                onClick={() => signOut(auth)}
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
        {/* Top Bar: Clean Breadcrumb + Language/Study-Language/Theme Controls */}
        <header className="h-16 px-4 sm:px-6 border-b glass-topbar sticky top-0 z-30 flex items-center justify-between gap-4">
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

          <div className="flex items-center gap-2 shrink-0">
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
              {t.common.switchLang}
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
            />
          )}

          {activeSection === 'formulas' && (
            <FormulaLibraryView
              lang={lang}
              studyLang={studyLang}
              formulas={FORMULAS_SEED}
              onOpenLesson={openLesson}
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
            />
          )}

          {activeSection === 'solver' && <SolverView lang={lang} studyLang={studyLang} profile={profile} />}

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
        </main>
      </div>
    </div>
  );
}
