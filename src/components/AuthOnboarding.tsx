import React, { useEffect, useState } from 'react';
import {
  auth,
  type AuthCredential,
  browserPopupRedirectResolver,
  extractFirebaseAuthCode,
  fetchSignInMethodsForEmail,
  getAuthErrorMessage,
  GoogleAuthProvider,
  googleProvider,
  isValidEmailAddress,
  linkWithCredential,
  linkWithPopup,
  logDevAuthError,
  shouldFallbackToRedirect,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from '../lib/firebase';
import { EDUCATIONAL_TRACKS } from '../data/tracks';
import { Language, StudyLanguage, ThemeMode, TrackId, UserProfile } from '../types/physics';
import { tFor } from '../i18n/translations';
import { PhysicsAmbientBg } from './PhysicsAmbientBg';
import { StudyLanguageSwitcher } from './BilingualBlock';
import {
  Atom,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Moon,
  Sun,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

interface PendingLinkState {
  credential: AuthCredential;
  email: string;
  methods: string[];
}

interface AuthOnboardingProps {
  lang: Language;
  theme: ThemeMode;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  firebaseUser: any | null;
  userProfile: UserProfile | null;
  initialAuthError?: unknown | null;
  initialPendingLink?: PendingLinkState | null;
  profileSyncWarning?: string | null;
  onClearRedirectError?: () => void;
  onRegisterWithEmail: (input: {
    fullName: string;
    email: string;
    password: string;
    track: TrackId;
    grade: string;
    studyLang?: StudyLanguage;
  }) => Promise<void>;
  onSaveTrackSelection: (
    track: TrackId,
    grade: string,
    displayName?: string,
    studyLang?: StudyLanguage
  ) => Promise<void>;
  onCancelSwitch?: () => void;
}

export function AuthOnboarding({
  lang,
  theme,
  onToggleLang,
  onToggleTheme,
  firebaseUser,
  userProfile,
  initialAuthError,
  initialPendingLink,
  profileSyncWarning,
  onClearRedirectError,
  onRegisterWithEmail,
  onSaveTrackSelection,
  onCancelSwitch,
}: AuthOnboardingProps) {
  const t = tFor(lang);
  const [authTab, setAuthTab] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [signupTrack, setSignupTrack] = useState<TrackId>('thanawiya');
  const signupTrackDef = EDUCATIONAL_TRACKS.find((tr) => tr.id === signupTrack) || EDUCATIONAL_TRACKS[0];
  const [signupGrade, setSignupGrade] = useState<string>(signupTrackDef.grades[0].id);
  const [signupStudyLang, setSignupStudyLang] = useState<StudyLanguage>(lang);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [suggestSignIn, setSuggestSignIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [googleError, setGoogleError] = useState('');
  const [googleInfo, setGoogleInfo] = useState('');
  const [showRedirectFallback, setShowRedirectFallback] = useState(false);
  const [pendingLinkCred, setPendingLinkCred] = useState<PendingLinkState | null>(null);
  const [linkMsg, setLinkMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [editDisplayName, setEditDisplayName] = useState<string>(userProfile?.displayName || '');
  const [selectedTrack, setSelectedTrack] = useState<TrackId>(
    userProfile?.track && userProfile.track !== 'unset' ? userProfile.track : 'thanawiya'
  );
  const currentTrackDef = EDUCATIONAL_TRACKS.find((tr) => tr.id === selectedTrack) || EDUCATIONAL_TRACKS[0];
  const [selectedGrade, setSelectedGrade] = useState<string>(
    userProfile?.grade || currentTrackDef.grades[0].id
  );
  const [selectedStudyLang, setSelectedStudyLang] = useState<StudyLanguage>(
    userProfile?.studyLang || (selectedTrack === 'american' ? 'bilingual' : lang)
  );

  useEffect(() => {
    if (!firebaseUser) {
      setEditDisplayName('');
      setSelectedTrack('thanawiya');
      setSelectedGrade(EDUCATIONAL_TRACKS[0].grades[0].id);
      setSelectedStudyLang(lang);
      setLinkMsg('');
      setErrorMsg('');
      return;
    }
    const nextTrack: TrackId =
      userProfile?.track && userProfile.track !== 'unset' ? userProfile.track : 'thanawiya';
    const nextTrackDef = EDUCATIONAL_TRACKS.find((tr) => tr.id === nextTrack) || EDUCATIONAL_TRACKS[0];
    setEditDisplayName(userProfile?.displayName || firebaseUser?.displayName || '');
    setSelectedTrack(nextTrack);
    setSelectedGrade(userProfile?.grade || nextTrackDef.grades[0].id);
    setSelectedStudyLang(
      userProfile?.studyLang || (nextTrack === 'american' ? 'bilingual' : lang)
    );
    setLinkMsg('');
    setErrorMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, userProfile?.uid, userProfile?.track, userProfile?.grade, userProfile?.studyLang, userProfile?.displayName]);

  useEffect(() => {
    if (initialPendingLink) {
      setPendingLinkCred(initialPendingLink);
      if (initialPendingLink.email) {
        setEmail(initialPendingLink.email);
      }
      setAuthTab('signin');
      setGoogleError(
        getAuthErrorMessage({ code: 'auth/account-exists-with-different-credential' }, lang)
      );
      setShowRedirectFallback(false);
    } else if (initialAuthError) {
      const code = extractFirebaseAuthCode(initialAuthError);
      setGoogleError(getAuthErrorMessage(initialAuthError, lang));
      setShowRedirectFallback(
        code === 'auth/internal-error' ||
          code === 'auth/popup-blocked' ||
          code === 'auth/popup-closed-by-user'
      );
    }
  }, [initialAuthError, initialPendingLink, lang]);

  const switchAuthTab = (tab: 'signin' | 'signup' | 'reset') => {
    setAuthTab(tab);
    setErrorMsg('');
    setInfoMsg('');
    setSuggestSignIn(false);
    if (tab !== 'signup') {
      setConfirmPassword('');
    }
  };

  const handleAccountExistsConflict = async (err: unknown) => {
    const credential =
      err && typeof err === 'object'
        ? GoogleAuthProvider.credentialFromError(err as Parameters<typeof GoogleAuthProvider.credentialFromError>[0])
        : null;
    const conflictEmail =
      typeof (err as any)?.customData?.email === 'string'
        ? (err as any).customData.email
        : email.trim();
    const methods = conflictEmail
      ? await fetchSignInMethodsForEmail(auth, conflictEmail).catch(() => [])
      : [];

    if (conflictEmail) {
      setEmail(conflictEmail);
    }
    if (credential) {
      setPendingLinkCred({ credential, email: conflictEmail, methods });
    }
    setAuthTab('signin');
    setSuggestSignIn(false);
    setShowRedirectFallback(false);

    const methodsLabel =
      methods.length > 0
        ? lang === 'ar'
          ? ` (${methods.join(' / ')})`
          : ` (${methods.join(' / ')})`
        : '';

    setGoogleError(
      `${getAuthErrorMessage(err, lang)}${methodsLabel}`
    );
    setGoogleInfo(
      lang === 'ar'
        ? 'أدخل كلمة مرور حسابك الحالي في نموذج تسجيل الدخول بالأسفل ليتم ربط حساب Google تلقائيًا بنفس حسابك.'
        : 'Enter your current account password below to sign in and automatically link your Google account.'
    );
  };

  const handleGoogleRedirectSignIn = async () => {
    setBusy(true);
    setGoogleError('');
    setGoogleInfo(
      lang === 'ar'
        ? 'جارٍ التحويل إلى صفحة تسجيل الدخول الآمنة من Google...'
        : 'Redirecting to Google secure sign-in...'
    );
    onClearRedirectError?.();
    try {
      await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
    } catch (err: unknown) {
      logDevAuthError('google-redirect', err);
      setGoogleInfo('');
      setGoogleError(getAuthErrorMessage(err, lang));
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setErrorMsg('');
    setInfoMsg('');
    setGoogleError('');
    setGoogleInfo('');
    setShowRedirectFallback(false);
    setSuggestSignIn(false);
    onClearRedirectError?.();

    try {
      await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
    } catch (err: unknown) {
      const code = extractFirebaseAuthCode(err);
      logDevAuthError('google-popup', err);

      if (shouldFallbackToRedirect(err)) {
        setGoogleInfo(
          lang === 'ar'
            ? 'المتصفح حظر النافذة المنبثقة؛ جارٍ المتابعة عبر إعادة التوجيه الآمن...'
            : 'Popup was blocked; continuing with secure redirect sign-in...'
        );
        try {
          await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
          return;
        } catch (redirectErr: unknown) {
          logDevAuthError('google-redirect-fallback', redirectErr);
          setGoogleInfo('');
          setGoogleError(getAuthErrorMessage(redirectErr, lang));
          setShowRedirectFallback(true);
        }
      } else if (code === 'auth/account-exists-with-different-credential') {
        await handleAccountExistsConflict(err);
      } else {
        setGoogleError(getAuthErrorMessage(err, lang));
        if (
          code === 'auth/internal-error' ||
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request' ||
          code === 'auth/redirect-operation-pending'
        ) {
          setShowRedirectFallback(true);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setSuggestSignIn(false);

    const cleanEmail = email.trim();
    if (!isValidEmailAddress(cleanEmail)) {
      setErrorMsg(
        lang === 'ar'
          ? 'يرجى إدخال بريد إلكتروني صحيح (Gmail أو Outlook أو Yahoo أو أي بريد آخر).'
          : 'Please enter a valid email address (Gmail, Outlook, Yahoo, or any valid domain).'
      );
      return;
    }
    if (!password) {
      setErrorMsg(lang === 'ar' ? 'يرجى إدخال كلمة المرور.' : 'Please enter your password.');
      return;
    }

    setBusy(true);
    try {
      // Strictly use signInWithEmailAndPassword for existing-account login
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      if (
        pendingLinkCred?.credential &&
        cred.user &&
        (!pendingLinkCred.email ||
          cred.user.email?.toLowerCase() === pendingLinkCred.email.toLowerCase())
      ) {
        try {
          await linkWithCredential(cred.user, pendingLinkCred.credential);
        } catch (linkErr: unknown) {
          logDevAuthError('link-google-credential', linkErr);
        } finally {
          setPendingLinkCred(null);
          onClearRedirectError?.();
        }
      }
    } catch (err: unknown) {
      logDevAuthError('email-signin', err);
      setErrorMsg(getAuthErrorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setSuggestSignIn(false);

    const cleanName = fullName.trim();
    const cleanEmail = email.trim();

    if (cleanName.length < 2) {
      setErrorMsg(
        lang === 'ar' ? 'يرجى إدخال الاسم الكامل (حرفان على الأقل).' : 'Please enter your full name (at least 2 characters).'
      );
      return;
    }
    if (!isValidEmailAddress(cleanEmail)) {
      setErrorMsg(
        lang === 'ar'
          ? 'صيغة البريد الإلكتروني غير صحيحة. يمكنك التسجيل بأي بريد صحيح مثل Gmail أو Outlook أو Yahoo.'
          : 'Invalid email format. You may register with any valid email such as Gmail, Outlook, or Yahoo.'
      );
      return;
    }
    if (password.length < 6) {
      setErrorMsg(
        lang === 'ar'
          ? 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.'
          : 'Password must be at least 6 characters long.'
      );
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg(
        lang === 'ar'
          ? 'كلمتا المرور غير متطابقتين. يرجى التأكد من تطابق كلمة المرور وتأكيدها.'
          : 'Passwords do not match. Please verify both password fields.'
      );
      return;
    }
    if (!signupTrack || !signupGrade) {
      setErrorMsg(
        lang === 'ar'
          ? 'يرجى اختيار النظام التعليمي والصف الدراسي.'
          : 'Please select your educational system and grade level.'
      );
      return;
    }

    setBusy(true);
    try {
      await onRegisterWithEmail({
        fullName: cleanName,
        email: cleanEmail,
        password,
        track: signupTrack,
        grade: signupGrade,
        studyLang: signupStudyLang,
      });
    } catch (err: unknown) {
      const code = extractFirebaseAuthCode(err);
      if (code === 'auth/email-already-in-use') {
        setSuggestSignIn(true);
      }
      setErrorMsg(getAuthErrorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setSuggestSignIn(false);

    const cleanEmail = email.trim();
    if (!isValidEmailAddress(cleanEmail)) {
      setErrorMsg(
        lang === 'ar'
          ? 'يرجى إدخال البريد الإلكتروني المسجل بصيغة صحيحة.'
          : 'Please enter a valid registered email address.'
      );
      return;
    }

    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfoMsg(t.auth.resetSuccess);
    } catch (err: unknown) {
      setErrorMsg(getAuthErrorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmTrack = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      await onSaveTrackSelection(selectedTrack, selectedGrade, editDisplayName, selectedStudyLang);
    } catch (err: unknown) {
      setErrorMsg(
        lang === 'ar'
          ? 'تعذر حفظ اختيار المسار حاليًا. حاول مرة أخرى.'
          : 'Failed to save track selection. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLinkGoogleAccount = async () => {
    if (!firebaseUser) return;
    setBusy(true);
    setErrorMsg('');
    setLinkMsg('');
    try {
      await linkWithPopup(firebaseUser, googleProvider, browserPopupRedirectResolver);
      setLinkMsg(
        lang === 'ar'
          ? 'تم ربط حساب Google بحسابك بنجاح! يمكنك استخدامه للدخول بنقرة واحدة لاحقًا.'
          : 'Google account linked successfully! You can now sign in with one click anytime.'
      );
    } catch (err: unknown) {
      logDevAuthError('google-link-popup', err);
      setErrorMsg(getAuthErrorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const hasGoogleLinked = Boolean(
    firebaseUser?.providerData?.some((p: { providerId?: string }) => p.providerId === 'google.com')
  );

  const DirArrow = lang === 'ar' ? ArrowLeft : ArrowRight;

  return (
    <div className="min-h-screen relative physics-space-canvas physics-grid-bg text-slate-900 dark:text-slate-100 flex flex-col">
      <PhysicsAmbientBg />

      {/* Top Bar Contract: 3 clean zones */}
      <header className="w-full border-b glass-topbar sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <img
              src="/assets/aistudio/__________________________425160ec.png"
              alt="Physics Smart"
              className="w-10 h-10 object-contain shrink-0"
            />
            <span className="font-display text-lg font-bold tracking-tight">Physics Smart</span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={onToggleLang}
              className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400" />
              {t.common.switchLang}
            </button>
            <button
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="p-2 rounded-xl glass-btn-secondary cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>
            {firebaseUser && (
              <button
                onClick={() => signOut(auth)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/12 border border-transparent hover:border-rose-500/20 transition-all whitespace-nowrap cursor-pointer"
              >
                {t.common.signOut}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 glass-enter">
        {!firebaseUser ? (
          /* STEP 1: SEPARATED SIGN IN / SIGN UP / PASSWORD RESET + HERO SHOWCASE */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl glass-card overflow-hidden">
              <div className="relative h-56 sm:h-72 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950">
                <div className="absolute inset-0 flex items-center justify-center opacity-20">
                  <Atom className="w-24 h-24 text-cyan-400" />
                </div>
                <img
                  src="/src/assets/images/hero_physics_observatory_1794579386979.jpg"
                  alt="Physics Smart Optical Observatory"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                  className="relative w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-transparent" />
                <div className="absolute bottom-5 inset-x-6 text-white">
                  <p className="text-xs font-medium text-cyan-300 mb-1">{t.brandSubtitle}</p>
                  <h1 className="text-2xl sm:text-3xl font-bold leading-snug text-balance">
                    {t.auth.welcomeTitle}
                  </h1>
                </div>
              </div>

              <div className="p-6 sm:p-8 space-y-6">
                <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                  {t.auth.welcomeDesc}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200/70 dark:border-white/10">
                  {EDUCATIONAL_TRACKS.map((tr) => (
                    <div key={tr.id} className="glass-subcard rounded-xl p-3 space-y-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {lang === 'ar' ? tr.nameAr : tr.nameEn}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {lang === 'ar' ? tr.subtitleAr : tr.subtitleEn}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="text-xs font-medium text-blue-600 dark:text-cyan-400">
                  {t.motto}
                </p>
              </div>
            </div>

            {/* Auth Card */}
            <div className="lg:col-span-5 rounded-2xl glass-panel border p-6 sm:p-8 flex flex-col justify-center">
              <div className="mb-5">
                <div className="flex items-center gap-3 mb-2">
                  <img
                    src="/assets/aistudio/__________________________425160ec.png"
                    alt="Physics Smart"
                    className="w-11 h-11 object-contain shrink-0"
                  />
                  <h2 className="text-xl font-bold">
                    {authTab === 'signin'
                      ? t.auth.signInTab
                      : authTab === 'signup'
                        ? t.auth.signUpTab
                        : t.auth.resetTab}
                  </h2>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {authTab === 'signin'
                    ? lang === 'ar'
                      ? 'سجّل الدخول بحسابك للوصول الفوري إلى دروسك ونتائجك من أي جهاز'
                      : 'Sign in with your account to access your synced progress from any device'
                    : authTab === 'signup'
                      ? lang === 'ar'
                        ? 'أنشئ حساب طالب جديد باستخدام أي بريد إلكتروني (Gmail أو Outlook أو Yahoo وغيرها)'
                        : 'Create a new student account with any valid email (Gmail, Outlook, Yahoo, etc.)'
                      : lang === 'ar'
                        ? 'أدخل بريدك الإلكتروني المسجل لاستلام رابط تعيين كلمة مرور جديدة'
                        : 'Enter your registered email address to receive a password reset link'}
                </p>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleSignIn}
                className="w-full py-3 px-4 rounded-xl glass-btn-primary font-semibold text-sm flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                {t.auth.googleBtn}
              </button>

              {googleError && (
                <div className="mt-3 text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{googleError}</span>
                  </div>
                  {showRedirectFallback && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleGoogleRedirectSignIn}
                      className="w-full py-1.5 px-3 rounded-lg glass-btn-secondary text-xs font-semibold cursor-pointer"
                    >
                      {lang === 'ar'
                        ? 'المحاولة عبر إعادة التوجيه (Redirect) بدلًا من النافذة المنبثقة'
                        : 'Try Redirect Sign-In instead of Popup'}
                    </button>
                  )}
                </div>
              )}

              {googleInfo && (
                <div className="mt-3 text-xs text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 rounded-xl p-3 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{googleInfo}</span>
                </div>
              )}

              <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                <div className="flex-1 h-px bg-slate-200/70 dark:bg-white/10" />
                <span>{t.auth.orDivider}</span>
                <div className="flex-1 h-px bg-slate-200/70 dark:bg-white/10" />
              </div>

              {/* Clearly Separated Mode Switcher */}
              <div className="flex gap-1 p-1 rounded-xl glass-subcard mb-5">
                {(['signin', 'signup', 'reset'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => switchAuthTab(tab)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                      authTab === tab
                        ? 'glass-btn-primary text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tab === 'signin' ? t.auth.signInTab : tab === 'signup' ? t.auth.signUpTab : t.auth.resetTab}
                  </button>
                ))}
              </div>

              {/* FORM 1: SIGN IN */}
              {authTab === 'signin' && (
                <form onSubmit={handleSignInSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">{t.auth.emailLabel}</label>
                    <input
                      type="email"
                      required
                      dir="ltr"
                      autoComplete="email"
                      placeholder={t.auth.emailPlaceholder}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium">{t.auth.passwordLabel}</label>
                      <button
                        type="button"
                        onClick={() => switchAuthTab('reset')}
                        className="text-[11px] font-medium text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                      >
                        {t.auth.goToReset}
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        dir="ltr"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3.5 py-2.5 pe-10 rounded-xl glass-input text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 end-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-2.5 px-4 rounded-xl glass-btn-secondary font-semibold text-sm disabled:opacity-60 cursor-pointer"
                  >
                    {busy ? t.common.loading : t.auth.signInAction}
                  </button>

                  <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'ar' ? 'طالب جديد؟' : 'New to Physics Smart?'}{' '}
                    <button
                      type="button"
                      onClick={() => switchAuthTab('signup')}
                      className="font-semibold text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                    >
                      {t.auth.goToSignUp}
                    </button>
                  </p>
                </form>
              )}

              {/* FORM 2: CREATE NEW ACCOUNT */}
              {authTab === 'signup' && (
                <form onSubmit={handleSignUpSubmit} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-medium mb-1">{t.auth.nameLabel}</label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      autoComplete="name"
                      placeholder={lang === 'ar' ? 'مثال: أحمد محمد علي' : 'e.g., Ahmed Mohamed'}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1">{t.auth.emailLabel}</label>
                    <input
                      type="email"
                      required
                      dir="ltr"
                      autoComplete="email"
                      placeholder={t.auth.emailPlaceholder}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">{t.auth.passwordLabel}</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          dir="ltr"
                          autoComplete="new-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full px-3 py-2.5 pe-9 rounded-xl glass-input text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">{t.auth.confirmPasswordLabel}</label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          dir="ltr"
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full px-3 py-2.5 pe-9 rounded-xl glass-input text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((v) => !v)}
                          aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                          className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        >
                          {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">{t.auth.trackLabel}</label>
                      <select
                        value={signupTrack}
                        onChange={(e) => {
                          const nextTrack = e.target.value as TrackId;
                          setSignupTrack(nextTrack);
                          const def = EDUCATIONAL_TRACKS.find((tr) => tr.id === nextTrack) || EDUCATIONAL_TRACKS[0];
                          setSignupGrade(def.grades[0].id);
                          if (nextTrack === 'american') setSignupStudyLang('bilingual');
                        }}
                        className="w-full px-3 py-2.5 rounded-xl glass-input text-xs font-medium"
                      >
                        {EDUCATIONAL_TRACKS.map((tr) => (
                          <option key={tr.id} value={tr.id}>
                            {lang === 'ar' ? tr.nameAr : tr.nameEn}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">{t.auth.gradeLabel}</label>
                      <select
                        value={signupGrade}
                        onChange={(e) => setSignupGrade(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl glass-input text-xs font-medium"
                      >
                        {signupTrackDef.grades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {lang === 'ar' ? g.labelAr : g.labelEn}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="rounded-xl glass-subcard p-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t.common.studyLangLabel}
                    </span>
                    <StudyLanguageSwitcher
                      value={signupStudyLang}
                      onChange={setSignupStudyLang}
                      uiLang={lang}
                      compact
                    />
                  </div>

                  {errorMsg && (
                    <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{errorMsg}</span>
                      </div>
                      {suggestSignIn && (
                        <button
                          type="button"
                          onClick={() => {
                            setPassword('');
                            setConfirmPassword('');
                            switchAuthTab('signin');
                          }}
                          className="w-full py-1.5 px-3 rounded-lg glass-btn-primary text-xs font-semibold cursor-pointer"
                        >
                          {t.auth.goToSignIn}
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-2.5 px-4 rounded-xl glass-btn-secondary font-semibold text-sm disabled:opacity-60 cursor-pointer"
                  >
                    {busy ? t.common.loading : t.auth.signUpAction}
                  </button>

                  <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'ar' ? 'لديك حساب بالفعل؟' : 'Already have an account?'}{' '}
                    <button
                      type="button"
                      onClick={() => switchAuthTab('signin')}
                      className="font-semibold text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                    >
                      {t.auth.goToSignIn}
                    </button>
                  </p>
                </form>
              )}

              {/* FORM 3: PASSWORD RESET */}
              {authTab === 'reset' && (
                <form onSubmit={handleResetSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">{t.auth.emailLabel}</label>
                    <input
                      type="email"
                      required
                      dir="ltr"
                      autoComplete="email"
                      placeholder={t.auth.emailPlaceholder}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm"
                    />
                  </div>

                  {errorMsg && (
                    <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}
                  {infoMsg && (
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-3 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{infoMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-2.5 px-4 rounded-xl glass-btn-secondary font-semibold text-sm disabled:opacity-60 cursor-pointer"
                  >
                    {busy ? t.common.loading : t.auth.resetAction}
                  </button>

                  <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                    <button
                      type="button"
                      onClick={() => switchAuthTab('signin')}
                      className="font-semibold text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                    >
                      {t.auth.goToSignIn}
                    </button>
                  </p>
                </form>
              )}
            </div>
          </div>
        ) : (
          /* STEP 2: STRICT TRACK & GRADE SELECTION BEFORE ENTERING CONTENT */
          <div className="max-w-5xl mx-auto space-y-8">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-balance">{t.auth.selectTrackTitle}</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t.auth.selectTrackDesc}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {EDUCATIONAL_TRACKS.map((tr) => {
                const isSelected = selectedTrack === tr.id;
                return (
                  <button
                    key={tr.id}
                    type="button"
                    onClick={() => {
                      setSelectedTrack(tr.id);
                      setSelectedGrade(tr.grades[0].id);
                      if (tr.id === 'american') setSelectedStudyLang('bilingual');
                    }}
                    className={`text-start rounded-2xl glass-card-interactive overflow-hidden flex flex-col ${
                      isSelected
                        ? '!border-cyan-400/70 ring-2 ring-cyan-400/25'
                        : ''
                    }`}
                  >
                    <div className="relative h-36 w-full bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 overflow-hidden">
                      <div className="absolute inset-0 flex items-center justify-center opacity-20">
                        <Atom className="w-12 h-12 text-cyan-400" />
                      </div>
                      <img
                        src={tr.image}
                        alt={lang === 'ar' ? tr.nameAr : tr.nameEn}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                        className="relative w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
                      {isSelected && (
                        <div className="absolute top-3 end-3 text-cyan-400">
                          <CheckCircle2 className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    <div className="p-5 space-y-2 flex-1">
                      <h3 className="text-lg font-bold">{lang === 'ar' ? tr.nameAr : tr.nameEn}</h3>
                      <p className="text-xs font-medium text-blue-600 dark:text-cyan-400">
                        {lang === 'ar' ? tr.subtitleAr : tr.subtitleEn}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {lang === 'ar' ? tr.descriptionAr : tr.descriptionEn}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Grade, Study Language & Profile Selector */}
            <div className="rounded-2xl glass-card p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold mb-1.5">
                  {lang === 'ar' ? 'الاسم المعروض في المنصة' : 'Student Display Name'}
                </label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder={userProfile?.displayName || (lang === 'ar' ? 'اسم الطالب...' : 'Student Name...')}
                  className="w-full max-w-md px-3.5 py-2.5 rounded-xl glass-input text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">{t.auth.selectGradeLabel}</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {currentTrackDef.grades.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGrade(g.id)}
                      className={`py-3 px-4 rounded-xl text-sm font-medium transition-all text-start ${
                        selectedGrade === g.id
                          ? 'glass-btn-primary text-white'
                          : 'glass-btn-secondary text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {lang === 'ar' ? g.labelAr : g.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{t.common.studyLangLabel}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedTrack === 'american'
                      ? lang === 'ar'
                        ? 'نظام American Diploma يدعم العربية والإنجليزية أو كلتيهما معًا بالكامل.'
                        : 'American Diploma fully supports Arabic, English, or Bilingual dual study.'
                      : lang === 'ar'
                        ? 'يمكنك تغيير لغة الدراسة في أي وقت دون فقدان تقدمك.'
                        : 'You can change your study language anytime without losing progress.'}
                  </p>
                </div>
                <StudyLanguageSwitcher
                  value={selectedStudyLang}
                  onChange={setSelectedStudyLang}
                  uiLang={lang}
                />
              </div>

              {profileSyncWarning && (
                <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{profileSyncWarning}</span>
                </div>
              )}

              {!hasGoogleLinked && (
                <div className="rounded-xl glass-subcard p-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {lang === 'ar' ? 'ربط حساب Google' : 'Link Google Account'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {lang === 'ar'
                        ? 'اربط حسابك بـ Google لتسجيل الدخول لاحقًا بنقرة واحدة دون فقدان تقدمك.'
                        : 'Link your Google account for one-click sign-in next time without losing progress.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleLinkGoogleAccount}
                    className="px-3.5 py-2 rounded-xl glass-btn-secondary text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{lang === 'ar' ? 'ربط Google الآن' : 'Link Google'}</span>
                  </button>
                </div>
              )}

              {linkMsg && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-2.5 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{linkMsg}</span>
                </p>
              )}

              {errorMsg && (
                <p className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
                  {errorMsg}
                </p>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                {onCancelSwitch && (
                  <button
                    type="button"
                    onClick={onCancelSwitch}
                    className="px-4 py-2.5 rounded-xl glass-btn-secondary text-sm font-medium"
                  >
                    {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleConfirmTrack}
                  className="px-6 py-3 rounded-xl glass-btn-primary font-semibold text-sm flex items-center gap-2 disabled:opacity-60"
                >
                  <span>{t.auth.enterPlatformBtn}</span>
                  <DirArrow className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
