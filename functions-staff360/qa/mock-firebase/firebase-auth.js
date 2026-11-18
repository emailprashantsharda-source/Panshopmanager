/* QA stand-in for Firebase Auth: OTP 123456 signs in; the phone picks the test user. */
const PHONES = { '+919000000001': 'owner', '+919800000001': 'newowner', '+919800000002': 'orgemp', '+919111111111': 'employee', '+919222222222': 'manager' };
const subs = [];
function current() { const k = localStorage.getItem('mock_user'); if (!k) return null; return { uid: k, key: k, phoneNumber: localStorage.getItem('mock_phone') }; }
const auth = { get currentUser() { return current(); } };
export const getAuth = () => auth;
export function onAuthStateChanged(a, cb) { subs.push(cb); setTimeout(() => cb(current()), 30); return () => {}; }
export async function signOut() { localStorage.removeItem('mock_user'); subs.forEach((f) => f(null)); }
export class RecaptchaVerifier { constructor() {} clear() {} }
export async function signInWithPhoneNumber(a, phone) {
  if (!/^\+91[6-9]\d{9}$/.test(phone)) { const e = new Error('bad'); e.code = 'auth/invalid-phone-number'; throw e; }
  return { confirm: async (code) => {
    if (code !== '123456') { const e = new Error('bad code'); e.code = 'auth/invalid-verification-code'; throw e; }
    localStorage.setItem('mock_user', PHONES[phone] || 'stranger'); localStorage.setItem('mock_phone', phone);
    const u = current(); subs.forEach((f) => f(u)); return { user: u };
  } };
}
