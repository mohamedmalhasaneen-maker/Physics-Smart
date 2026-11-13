import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  linkWithPopup,
  updateProfile,
  signOut,
  type AuthCredential,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDocFromServer,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Language } from '../types/physics';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db: Firestore = (() => {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
        ignoreUndefinedProperties: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
})();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Ensure user authentication session persists securely across browser reloads
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Fallback handled automatically by Firebase SDK if storage is restricted
});

export const ADMIN_BOOTSTRAP_EMAIL = 'mohamed.m.alhasaneen@gmail.com';

export function isValidEmailAddress(email: string): boolean {
  const trimmed = email.trim();
  // Accepts all valid email providers (Gmail, Outlook, Yahoo, educational, custom domains)
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) && trimmed.length <= 200;
}

export function extractFirebaseAuthCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as any).code === 'string') {
    return (error as any).code.toLowerCase();
  }
  const msg = error instanceof Error ? error.message : String(error || '');
  const match = msg.match(/auth\/[a-z0-9-]+/i);
  return match ? match[0].toLowerCase() : '';
}

export function shouldFallbackToRedirect(error: unknown): boolean {
  const code = extractFirebaseAuthCode(error);
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment' ||
    code === 'auth/web-storage-unsupported'
  );
}

export function getAuthErrorMessage(error: unknown, lang: Language): string {
  const code = extractFirebaseAuthCode(error);
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const isAr = lang === 'ar';
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return isAr
        ? 'هذا البريد الإلكتروني مسجل بالفعل في المنصة. لا يمكن إنشاء حساب مكرر؛ يرجى تسجيل الدخول باستخدام كلمة المرور الخاصة بك.'
        : 'This email address is already registered. Duplicate accounts are not allowed; please sign in with your password.';
    case 'auth/invalid-email':
      return isAr
        ? 'صيغة البريد الإلكتروني غير صحيحة. أدخل بريدًا إلكترونيًا صالحًا من أي مزود (مثل Gmail أو Outlook أو Yahoo).'
        : 'Invalid email address format. Enter any valid email (Gmail, Outlook, Yahoo, school, or custom domain).';
    case 'auth/weak-password':
      return isAr
        ? 'كلمة المرور ضعيفة جدًا. يجب أن تتكون من 6 أحرف على الأقل ويفضل استخدام حروف وأرقام.'
        : 'Password is too weak. Please enter at least 6 characters with letters and numbers.';
    case 'auth/user-not-found':
      return isAr
        ? 'لا يوجد حساب مسجل بهذا البريد الإلكتروني. تحقق من البريد أو انتقل إلى إنشاء حساب جديد.'
        : 'No account is registered with this email address. Check your email or create a new account.';
    case 'auth/wrong-password':
      return isAr
        ? 'كلمة المرور غير صحيحة. يرجى المحاولة مرة أخرى أو استخدام خيار استعادة كلمة المرور.'
        : 'Incorrect password. Please try again or use Reset Password.';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return isAr
        ? 'بيانات الاعتماد غير صالحة أو منتهية الصلاحية (auth/invalid-credential). تأكد من البريد وكلمة المرور أو أعد المحاولة بحساب Google.'
        : 'Invalid or expired authentication credential (auth/invalid-credential). Verify your email/password or try Google sign-in again.';
    case 'auth/unauthorized-domain':
      return isAr
        ? `النطاق الحالي (${currentHost || 'unknown'}) غير مضاف في قائمة النطاقات المصرح بها (Authorized Domains) داخل إعدادات Firebase Authentication. أضف النطاق من Firebase Console ثم أعد المحاولة.`
        : `The current domain (${currentHost || 'unknown'}) is not in Firebase Authentication Authorized Domains. Add this domain in Firebase Console > Authentication > Settings > Authorized domains.`;
    case 'auth/account-exists-with-different-credential':
      return isAr
        ? 'هذا البريد الإلكتروني مسجل مسبقًا بطريقة دخول أخرى (مثل البريد وكلمة المرور). سجّل الدخول بطريقتك السابقة ليتم ربط حساب Google تلقائيًا بنفس الحساب دون فقدان بياناتك.'
        : 'An account already exists with this email using another sign-in method (such as Email/Password). Sign in with your original method to link Google automatically without losing data.';
    case 'auth/credential-already-in-use':
      return isAr
        ? 'حساب Google هذا مرتبط بالفعل بحساب طالب آخر في المنصة.'
        : 'This Google credential is already linked to another student account.';
    case 'auth/network-request-failed':
      return isAr
        ? 'فشل الاتصال بخوادم المصادقة (auth/network-request-failed). تحقق من اتصالك بالإنترنت أو تعطيل مانع الإعلانات ثم أعد المحاولة.'
        : 'Network request failed while reaching authentication servers (auth/network-request-failed). Check your connection or ad-blocker and try again.';
    case 'auth/internal-error':
      return isAr
        ? `حدث خطأ داخلي في مصادقة Firebase (auth/internal-error) قد يكون بسبب حظر ملفات تعريف الارتباط أو تقييد النوافذ المنبثقة. جرّب خيار تسجيل الدخول عبر إعادة التوجيه (Redirect).${rawMessage ? ` [${rawMessage}]` : ''}`
        : `Firebase Authentication internal error (auth/internal-error), often caused by blocked third-party cookies or restricted popups. Try the Redirect sign-in option.${rawMessage ? ` [${rawMessage}]` : ''}`;
    case 'auth/too-many-requests':
      return isAr
        ? 'تم إيقاف المحاولات مؤقتًا بسبب كثرة الطلبات المتكررة (auth/too-many-requests). انتظر قليلًا ثم أعد المحاولة.'
        : 'Too many requests detected (auth/too-many-requests). Please wait a short moment before trying again.';
    case 'auth/user-disabled':
      return isAr
        ? 'تم إيقاف هذا الحساب مؤقتًا. يرجى التواصل مع إدارة المنصة.'
        : 'This user account has been disabled. Please contact platform administration.';
    case 'auth/operation-not-allowed':
      return isAr
        ? 'مزود تسجيل الدخول المطلوب غير مفعّل في إعدادات مشروع Firebase (auth/operation-not-allowed). تأكد من تفعيل Google وEmail/Password في Firebase Console → Authentication → Sign-in method.'
        : 'This sign-in provider is disabled in Firebase Console (auth/operation-not-allowed). Enable Google and Email/Password under Authentication > Sign-in method.';
    case 'auth/popup-closed-by-user':
    case 'auth/redirect-cancelled-by-user':
      return isAr
        ? 'تم إغلاق نافذة تسجيل الدخول بحساب Google قبل إتمام العملية. يمكنك المحاولة مرة أخرى أو استخدام خيار إعادة التوجيه.'
        : 'Google sign-in window was closed before completion. You can try again or use Redirect sign-in.';
    case 'auth/cancelled-popup-request':
    case 'auth/redirect-operation-pending':
      return isAr
        ? 'هناك محاولة تسجيل دخول قيد التنفيذ حاليًا. أكمل النافذة المفتوحة أو أعد المحاولة بعد لحظة.'
        : 'Another sign-in popup or redirect is already in progress. Complete it or try again in a moment.';
    case 'auth/popup-blocked':
      return isAr
        ? 'حظر المتصفح النافذة المنبثقة لـ Google (auth/popup-blocked). اسمح بالنوافذ المنبثقة أو استخدم تسجيل الدخول عبر إعادة التوجيه.'
        : 'Browser blocked the Google sign-in popup (auth/popup-blocked). Allow popups or continue with Redirect sign-in.';
    case 'auth/web-storage-unsupported':
    case 'auth/operation-not-supported-in-this-environment':
      return isAr
        ? 'المتصفح الحالي يقيّد التخزين المحلي أو النوافذ المنبثقة. فعّل الكوكيز أو استخدم متصفح Chrome/Safari خارج وضع التصفح الخاص.'
        : 'This browser restricts web storage or popups. Enable cookies/storage or open in Chrome/Safari outside private browsing.';
    case 'auth/missing-password':
      return isAr ? 'يرجى إدخال كلمة المرور.' : 'Please enter your password.';
    default: {
      const detail = code || rawMessage;
      return isAr
        ? `تعذر إتمام المصادقة${detail ? ` (${detail})` : ''}. تحقق من إعدادات Firebase واتصال الشبكة وحاول مرة أخرى.`
        : `Authentication failed${detail ? ` (${detail})` : ''}. Verify Firebase configuration and network connection, then try again.`;
    }
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function isFirestoreOfflineError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof (error as any).code === 'string'
      ? (error as any).code.toLowerCase()
      : '';
  const message = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'failed-precondition' && message.includes('offline') ||
    message.includes('the client is offline') ||
    message.includes('client is offline') ||
    message.includes('could not reach cloud firestore backend')
  );
}

export async function testFirestoreConnection(): Promise<boolean> {
  const probe = async (): Promise<boolean> => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      return true;
    } catch (error) {
      if (isFirestoreOfflineError(error)) {
        return false;
      }
      // Permission denied on /test/connection is normal and proves server connectivity
      return true;
    }
  };

  const firstTry = await probe();
  if (firstTry) return true;

  // Retry once after brief warmup if browser is online
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const secondTry = await probe();
    if (secondTry) return true;
  }

  console.warn('Firestore backend is currently unreachable (offline mode active).');
  return false;
}

export {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  linkWithPopup,
  updateProfile,
  signOut,
  serverTimestamp,
  type AuthCredential,
};
