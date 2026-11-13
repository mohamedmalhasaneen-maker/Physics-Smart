import React, { useState } from 'react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from '../lib/firebase';
import { updateProfile } from 'firebase/auth';
import { EDUCATIONAL_TRACKS } from '../data/tracks';
import { Language, ThemeMode, TrackId, UserProfile } from '../types/physics';
import { tFor } from '../i18n/translations';
import { PhysicsAmbientBg } from './PhysicsAmbientBg';
import { Atom, ArrowRight, ArrowLeft, CheckCircle2, Globe, Moon, Sun, ShieldCheck } from 'lucide-react';

interface AuthOnboardingProps {
  lang: Language;
  theme: ThemeMode;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  firebaseUser: any | null;
  userProfile: UserProfile | null;
  onSaveTrackSelection: (track: TrackId, grade: string, displayName?: string) => Promise<void>;
  onCancelSwitch?: () => void;
}

export function AuthOnboarding({
  lang,
  theme,
  onToggleLang,
  onToggleTheme,
  firebaseUser,
  userProfile,
  onSaveTrackSelection,
  onCancelSwitch,
}: AuthOnboardingProps) {
  const t = tFor(lang);
  const [authTab, setAuthTab] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [editDisplayName, setEditDisplayName] = useState<string>(userProfile?.displayName || '');
  const [selectedTrack, setSelectedTrack] = useState<TrackId>(
    userProfile?.track && userProfile.track !== 'unset' ? userProfile.track : 'thanawiya'
  );
  const currentTrackDef = EDUCATIONAL_TRACKS.find((tr) => tr.id === selectedTrack) || EDUCATIONAL_TRACKS[0];
  const [selectedGrade, setSelectedGrade] = useState<string>(
    userProfile?.grade || currentTrackDef.grades[0].id
  );

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Google Sign-In failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg('');
    setInfoMsg('');
    try {
      if (authTab === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else if (authTab === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (fullName.trim()) {
          await updateProfile(cred.user, { displayName: fullName.trim() });
        }
      } else {
        await sendPasswordResetEmail(auth, email);
        setInfoMsg(t.auth.resetSuccess);
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setErrorMsg(
          lang === 'ar'
            ? 'تسجيل البريد الإلكتروني غير مُفعّل في إعدادات Firebase بعد — يمكنك الدخول فورًا بزر Google أو تفعيل Email/Password من Firebase Console.'
            : 'Email/Password sign-in is not yet enabled in Firebase Console — use Google Sign-In above or enable Email/Password provider in Firebase Authentication.'
        );
      } else {
        setErrorMsg(err?.message || 'Authentication error.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmTrack = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      await onSaveTrackSelection(selectedTrack, selectedGrade, editDisplayName);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save selection.');
    } finally {
      setBusy(false);
    }
  };

  const DirArrow = lang === 'ar' ? ArrowLeft : ArrowRight;

  return (
    <div className="min-h-screen relative physics-space-canvas physics-grid-bg text-slate-900 dark:text-slate-100 flex flex-col">
      <PhysicsAmbientBg />

      {/* Top Bar Contract: 3 clean zones */}
      <header className="w-full border-b glass-topbar sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <span className="glass-icon glass-icon-cyan w-9 h-9">
              <Atom className="w-5 h-5" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">Physics Smart</span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={onToggleLang}
              className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400" />
              {t.common.switchLang}
            </button>
            <button
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="p-2 rounded-xl glass-btn-secondary"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>
            {firebaseUser && (
              <button
                onClick={() => signOut(auth)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/12 border border-transparent hover:border-rose-500/20 transition-all whitespace-nowrap"
              >
                {t.common.signOut}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 glass-enter">
        {!firebaseUser ? (
          /* STEP 1: AUTHENTICATION + HERO SHOWCASE */
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
              <div className="mb-6">
                <h2 className="text-xl font-bold mb-1">
                  {lang === 'ar' ? 'ابدأ رحلتك في الفيزياء' : 'Start Your Physics Journey'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'ar'
                    ? 'سجّل الدخول لحفظ تقدمك، نتائجك، وخطتك الدراسية'
                    : 'Sign in to sync your progress, exam scores, and study planner'}
                </p>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleSignIn}
                className="w-full py-3 px-4 rounded-xl glass-btn-primary font-semibold text-sm flex items-center justify-center gap-2.5 disabled:opacity-60"
              >
                <ShieldCheck className="w-4 h-4" />
                {t.auth.googleBtn}
              </button>

              <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                <div className="flex-1 h-px bg-slate-200/70 dark:bg-white/10" />
                <span>{t.auth.orDivider}</span>
                <div className="flex-1 h-px bg-slate-200/70 dark:bg-white/10" />
              </div>

              <div className="flex gap-1 p-1 rounded-xl glass-subcard mb-5">
                {(['signin', 'signup', 'reset'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      setAuthTab(tab);
                      setErrorMsg('');
                      setInfoMsg('');
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      authTab === tab
                        ? 'bg-white/90 dark:bg-white/12 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tab === 'signin' ? t.auth.signInTab : tab === 'signup' ? t.auth.signUpTab : t.auth.resetTab}
                  </button>
                ))}
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-4">
                {authTab === 'signup' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">{t.auth.nameLabel}</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium mb-1">{t.auth.emailLabel}</label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm"
                  />
                </div>

                {authTab !== 'reset' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">{t.auth.passwordLabel}</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm"
                    />
                  </div>
                )}

                {errorMsg && (
                  <p className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
                    {errorMsg}
                  </p>
                )}
                {infoMsg && (
                  <p className="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5">
                    {infoMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2.5 px-4 rounded-xl glass-btn-secondary font-semibold text-sm disabled:opacity-60"
                >
                  {authTab === 'signin'
                    ? t.auth.signInAction
                    : authTab === 'signup'
                    ? t.auth.signUpAction
                    : t.auth.resetAction}
                </button>
              </form>
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

            {/* Grade & Profile Selector */}
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
