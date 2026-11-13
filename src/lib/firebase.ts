import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  setPersistence,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Language } from '../types/physics';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

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
    return (error as any).code;
  }
  const msg = error instanceof Error ? error.message : String(error || '');
  const match = msg.match(/auth\/[a-z0-9-]+/i);
  return match ? match[0].toLowerCase() : '';
}

export function getAuthErrorMessage(error: unknown, lang: Language): string {
  const code = extractFirebaseAuthCode(error);
  const isAr = lang === 'ar';

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
        ? 'بيانات الدخول غير صحيحة. تأكد من البريد الإلكتروني وكلمة المرور، أو قم باستعادة كلمة المرور.'
        : 'Invalid email or password. Please verify your credentials or reset your password.';
    case 'auth/network-request-failed':
      return isAr
        ? 'فشل الاتصال بالشبكة. يرجى التحقق من اتصالك بالإنترنت ثم المحاولة مرة أخرى.'
        : 'Network request failed. Please check your internet connection and try again.';
    case 'auth/too-many-requests':
      return isAr
        ? 'تم حظر المحاولات مؤقتًا بسبب كثرة المحاولات المتكررة. انتظر قليلًا ثم أعد المحاولة.'
        : 'Too many attempts detected. Please wait a short moment before trying again.';
    case 'auth/user-disabled':
      return isAr
        ? 'تم إيقاف هذا الحساب مؤقتًا. يرجى التواصل مع إدارة المنصة.'
        : 'This user account has been disabled. Please contact platform administration.';
    case 'auth/operation-not-allowed':
      return isAr
        ? 'خدمة التسجيل بالبريد الإلكتروني وكلمة المرور غير مفعّلة في إعدادات مشروع Firebase حاليًا. فعّل Email/Password في Firebase Console أو سجّل الدخول عبر Google.'
        : 'Email/Password sign-in is currently disabled in Firebase Console. Enable Email/Password under Authentication > Sign-in method or continue with Google.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return isAr
        ? 'تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.'
        : 'Sign-in window was closed before completion.';
    case 'auth/popup-blocked':
      return isAr
        ? 'حظر المتصفح النافذة المنبثقة. اسمح بالنوافذ المنبثقة أو استخدم تسجيل الدخول بالبريد الإلكتروني.'
        : 'Browser blocked the sign-in popup. Allow popups or sign in with email and password.';
    case 'auth/missing-password':
      return isAr ? 'يرجى إدخال كلمة المرور.' : 'Please enter your password.';
    default:
      return isAr
        ? 'تعذر إتمام العملية حاليًا. يرجى التحقق من البيانات المدخلة والمحاولة مرة أخرى.'
        : 'Could not complete authentication right now. Please check your details and try again.';
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

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Client is offline.');
      return false;
    }
    // Permission denied on /test/connection is normal and proves server connectivity
    return true;
  }
}

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  serverTimestamp,
};
