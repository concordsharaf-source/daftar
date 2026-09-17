/*
 * قفل التطبيق — باترن (نقاط) أو رمز سري أو بصمة الجهاز (WebAuthn).
 *
 * الأمان هنا حقيقي لا شكلي:
 *  - الباترن/الرمز يُشتق منه مفتاح AES-GCM (PBKDF2-SHA256، 210k دورة) ويُشفَّر به
 *    نص الملاحظات وعناوينها في قاعدة البيانات. بلا الباترن الصحيح تُقرأ البيانات
 *    كطلاسم فقط.
 *  - البصمة: نستخدم امتداد WebAuthn PRF للحصول على سر ثابت من معالج الجهاز
 *    (بصمة/وجه/Windows Hello) ويُشتق منه المفتاح. إن لم يدعم الجهاز PRF، يبقى
 *    القفل حاجزًا ضد الفتح العابر (ونُخبر المستخدم بذلك صراحةً).
 *  - محاولات فاشلة ⇒ قفل مؤقت تصاعدي (مطابق لسلوك نسخة أندرويد).
 */

import { getSettings, setSetting, migrateNotes } from './db.js';
import {
  randomBytes, bytesToB64, b64ToBytes, keyFromPattern, keyFromSecretBytes,
  createCanary, verifyCanary, setSessionKey, clearSessionKey, hasSessionKey,
  setFieldEncryption, isFieldEncryption,
} from './crypto.js';

export const METHODS = {
  pattern: 'باترن',
  pin: 'رمز سري',
  biometric: 'بصمة الجهاز',
};

const MAX_ATTEMPTS = 5;
const LOCKOUT_BASE_MS = 30_000;

const KEYS = {
  enabled: 'lockEnabled',
  method: 'lockMethod',
  salt: 'lockSalt',
  canary: 'lockCanary',
  encrypted: 'lockEncrypted',
  relock: 'lockRelockMs',
  credId: 'lockCredId',
  prfSalt: 'lockPrfSalt',
  attempts: 'lockAttempts',
  until: 'lockUntil',
  noteCred: 'noteCredId',
};

const state = {
  enabled: false,
  method: null,
  salt: null,          // Uint8Array
  canary: null,
  encrypted: false,
  relockMs: 0,
  credId: null,
  prfSalt: null,
  prfAvailable: null,  // null = لم يُختبر بعد
  attempts: 0,
  lockUntil: 0,
  unlocked: false,
  lastUnlockAt: 0,
  noteCredId: null,   // اعتماد بصمة يُستخدم لقفل الملاحظات وحده (قد يكون بلا قفل تطبيق)
};

// ---------------------------------------------------------------- التهيئة

export async function init() {
  const s = await getSettings();
  state.enabled = !!s[KEYS.enabled];
  state.method = s[KEYS.method] || null;
  state.salt = s[KEYS.salt] ? b64ToBytes(s[KEYS.salt]) : null;
  state.canary = s[KEYS.canary] || null;
  state.encrypted = !!s[KEYS.encrypted];
  state.relockMs = Number(s[KEYS.relock] ?? 0);
  state.credId = s[KEYS.credId] || null;
  state.prfSalt = s[KEYS.prfSalt] || null;
  state.attempts = Number(s[KEYS.attempts] ?? 0);
  state.lockUntil = Number(s[KEYS.until] ?? 0);
  state.lastUnlockAt = Number(s.lastUnlockTime || 0);
  state.noteCredId = s[KEYS.noteCred] || null;
  setFieldEncryption(state.enabled && state.encrypted);
  state.unlocked = !state.enabled; // التطبيق مفتوح إن لم يكن القفل مفعّلًا
  return snapshot();
}

function snapshot() {
  return {
    enabled: state.enabled,
    method: state.method,
    encrypted: state.encrypted,
    relockMs: state.relockMs,
    hasBiometric: !!state.credId,
    prfAvailable: state.prfAvailable,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - state.attempts),
    lockRemainingMs: Math.max(0, state.lockUntil - Date.now()),
    unlocked: state.unlocked,
  };
}

export function getState() { return snapshot(); }
export function isEnabled() { return state.enabled; }
export function isUnlocked() { return state.unlocked; }
export function isEncrypted() { return state.encrypted; }
export function hasBiometric() { return !!state.credId; }
export function methodLabel() { return METHODS[state.method] || ''; }
export function prfSupported() { return state.prfAvailable === true; }

export function lockRemainingMs() { return Math.max(0, state.lockUntil - Date.now()); }

/** آخر لحظة نجح فيها فتح التطبيق (للتحقق القريب قبل تغيير إعدادات القفل). */
export function lastUnlockAt() { return Number(state.lastUnlockAt || 0); }
export function attemptsLeft() { return Math.max(0, MAX_ATTEMPTS - state.attempts); }

// ---------------------------------------------------------------- المحاولات الفاشلة

async function recordFailure() {
  state.attempts += 1;
  if (state.attempts >= MAX_ATTEMPTS) {
    const overshoot = Math.floor(state.attempts / MAX_ATTEMPTS) - 1;
    const penalty = LOCKOUT_BASE_MS * Math.pow(2, Math.min(overshoot, 5));
    state.lockUntil = Date.now() + penalty;
    state.attempts = 0;
    await setSetting(KEYS.until, state.lockUntil);
  }
  await setSetting(KEYS.attempts, state.attempts);
}

async function resetFailures() {
  state.attempts = 0;
  state.lockUntil = 0;
  await setSetting(KEYS.attempts, 0);
  await setSetting(KEYS.until, 0);
}

// ---------------------------------------------------------------- التحقق من السر

/**
 * يتحقق من باترن/رمز. عند النجاح: يضع مفتاح الجلسة ويُعلن الفتح.
 * @returns {{ok:boolean, reason?:string, remaining?:number}}
 */
export async function unlockWithSecret(secret) {
  if (lockRemainingMs() > 0) {
    return { ok: false, reason: 'locked-out', remaining: lockRemainingMs() };
  }
  if (!state.salt || !state.canary) return { ok: false, reason: 'not-configured' };

  const key = await keyFromPattern(String(secret), state.salt);
  const ok = await verifyCanary(key, state.canary);
  if (!ok) {
    await recordFailure();
    return { ok: false, reason: 'wrong', remaining: attemptsLeft() };
  }
  setSessionKey(key);
  await resetFailures();
  state.unlocked = true;
  state.lastUnlockAt = Date.now();
  await setSetting('lastUnlockTime', state.lastUnlockAt);
  return { ok: true };
}

/** التحقق من السر بلا فتح التطبيق (لتغيير الطريقة أو إطفاء القفل). */
export async function verifySecret(secret) {
  if (!state.salt || !state.canary) return false;
  const key = await keyFromPattern(String(secret), state.salt);
  return verifyCanary(key, state.canary);
}

// ---------------------------------------------------------------- البصمة (WebAuthn)

export function platformAuthenticatorSupported() {
  return !!(window.PublicKeyCredential
    && typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function');
}

export async function checkPlatformAuthenticator() {
  if (!platformAuthenticatorSupported()) { state.prfAvailable = false; return false; }
  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) state.prfAvailable = false;
    return available;
  } catch {
    state.prfAvailable = false;
    return false;
  }
}

/**
 * تسجيل بصمة الجهاز. يحاول استخدام امتداد PRF لاستخراج سر يُشتق منه المفتاح.
 * @returns {{ok:boolean, prf:boolean, reason?:string}}
 */
export async function registerBiometric() {
  if (!platformAuthenticatorSupported()) return { ok: false, prf: false, reason: 'unsupported' };
  const available = await checkPlatformAuthenticator();
  if (!available) return { ok: false, prf: false, reason: 'no-authenticator' };

  const prfSalt = randomBytes(32);
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'دفتر', id: location.hostname },
        user: { id: randomBytes(16), name: 'daftar', displayName: 'دفتر' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    });
    const results = credential.getClientExtensionResults?.() || {};
    const prf = !!(results.prf && results.prf.enabled);
    state.prfAvailable = prf;
    state.credId = bytesToB64(new Uint8Array(credential.rawId));
    state.prfSalt = bytesToB64(prfSalt);
    await setSetting(KEYS.credId, state.credId);
    await setSetting(KEYS.prfSalt, state.prfSalt);
    await setSetting('lockPrf', prf);
    return { ok: true, prf };
  } catch (e) {
    return { ok: false, prf: false, reason: e?.name === 'NotAllowedError' ? 'cancelled' : String(e?.message || e) };
  }
}

/**
 * فتح بالبصمة. إن دعم الجهاز PRF نستخرج السر ونبني المفتاح (تشفير حقيقي)،
 * وإلا نكتفي بنجاح التحقق (حاجز بلا تشفير).
 */
export async function unlockWithBiometric() {
  if (!state.credId) return { ok: false, reason: 'no-credential' };
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: b64ToBytes(state.credId) }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: state.prfSalt ? { prf: { eval: { first: b64ToBytes(state.prfSalt) } } } : {},
      },
    });
    if (!assertion) return { ok: false, reason: 'cancelled' };

    const results = assertion.getClientExtensionResults?.() || {};
    const secret = results.prf?.results?.first
      ? new Uint8Array(results.prf.results.first)
      : null;

    if (secret && state.canary) {
      const key = await keyFromSecretBytes(secret);
      const valid = await verifyCanary(key, state.canary);
      if (!valid) return { ok: false, reason: 'key-mismatch' };
      setSessionKey(key);
    }
    state.unlocked = true;
    state.lastUnlockAt = Date.now();
    await resetFailures();
    await setSetting('lastUnlockTime', state.lastUnlockAt);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.name === 'NotAllowedError' ? 'cancelled' : String(e?.message || e) };
  }
}

// ---------------------------------------------------------------- الإعداد/التغيير

async function persistCommon(method, encrypted) {
  state.enabled = true;
  state.method = method;
  state.encrypted = encrypted;
  await setSetting(KEYS.enabled, true);
  await setSetting(KEYS.method, method);
  await setSetting(KEYS.encrypted, encrypted);
  setFieldEncryption(encrypted);
}

/** إعداد باترن/رمز جديد (يشفّر كل الملاحظات القائمة). */
export async function setupSecret(method, secret, { relockMs = 0 } = {}) {
  const salt = randomBytes(16);
  const key = await keyFromPattern(String(secret), salt);
  const canary = await createCanary(key);

  // ترحيل البيانات من الحالة السابقة (مفتوحة أو مفتاح قديم) إلى المفتاح الجديد
  await migrateNotes(key, true);

  state.salt = salt;
  state.canary = canary;
  await setSetting(KEYS.salt, bytesToB64(salt));
  await setSetting(KEYS.canary, canary);
  await setSetting(KEYS.relock, relockMs);
  state.relockMs = relockMs;
  await persistCommon(method, true);
  setSessionKey(key);
  state.unlocked = true;
  state.lastUnlockAt = Date.now();
  await setSetting('lastUnlockTime', state.lastUnlockAt);
  await resetFailures();
  return true;
}

/** إعداد البصمة كطريقة للقفل. */
export async function setupBiometric({ relockMs = 0 } = {}) {
  const reg = await registerBiometric();
  if (!reg.ok) return reg;

  let encrypted = false;
  if (reg.prf) {
    // استخرج السر مرة واحدة لبناء الشهادة والمفتاح
    const check = await capturePrfSecret();
    if (check.secret) {
      const key = await keyFromSecretBytes(check.secret);
      const canary = await createCanary(key);
      await migrateNotes(key, true);
      state.canary = canary;
      await setSetting(KEYS.canary, canary);
      setSessionKey(key);
      encrypted = true;
    }
  }
  if (!encrypted) {
    // بلا PRF: لا يمكن اشتقاق مفتاح ⇒ البيانات تبقى غير مشفّرة (نُخبر المستخدم)
    state.canary = null;
    await setSetting(KEYS.canary, '');
    await migrateNotes(null, false);
  }
  await setSetting(KEYS.relock, relockMs);
  state.relockMs = relockMs;
  await persistCommon('biometric', encrypted);
  state.unlocked = true;
  await resetFailures();
  return { ok: true, prf: reg.prf, encrypted };
}

/** يُنفّذ تحققًا استباقيًا لاستخراج سر PRF (يُستخدم عند الإعداد). */
async function capturePrfSecret() {
  if (!state.credId) return { secret: null };
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: b64ToBytes(state.credId) }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: state.prfSalt ? { prf: { eval: { first: b64ToBytes(state.prfSalt) } } } : {},
      },
    });
    const results = assertion?.getClientExtensionResults?.() || {};
    const secret = results.prf?.results?.first ? new Uint8Array(results.prf.results.first) : null;
    return { secret };
  } catch {
    return { secret: null };
  }
}

// ---------------------------------------------------------------- تحقق الجهاز (قفل الملاحظات)

/** هل يمكن التحقق بالجهاز (بصمة/وجه/Windows Hello)؟ */
export async function deviceVerificationAvailable() {
  return checkPlatformAuthenticator();
}

/** هل سبق تسجيل اعتماد للجهاز؟ (لتفادي تسجيل جديد بلا داعٍ) */
export function hasDeviceCredential() {
  return !!(state.credId || state.noteCredId);
}

/**
 * تحقق بالجهاز يظهر فيه حوار النظام مباشرة (بلا أي شاشة داخل التطبيق).
 * يُستخدم لقفل الملاحظات — مستقل تمامًا عن قفل التطبيق:
 *  - إن كان هناك اعتماد مسجّل (من قفل التطبيق أو من قفل ملاحظة سابق) نستخدمه.
 *  - وإلا نسجّل اعتمادًا جديدًا (حوار النظام مرة واحدة) ثم نتحقق.
 * لا يغيّر حالة قفل التطبيق ولا يمسح/يضع مفتاح الجلسة.
 */
export async function verifyWithDevice({ reason = 'لمتابعة العملية' } = {}) {
  const available = await checkPlatformAuthenticator();
  if (!available) return { ok: false, reason: 'unsupported' };
  try {
    let credId = state.credId || state.noteCredId;
    if (!credId) {
      const created = await navigator.credentials.create({
        publicKey: {
          challenge: randomBytes(32),
          rp: { name: 'دفتر', id: location.hostname },
          user: { id: randomBytes(16), name: 'daftar-notes', displayName: 'ملاحظات دفتر' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60_000,
          attestation: 'none',
        },
      });
      credId = bytesToB64(new Uint8Array(created.rawId));
      state.noteCredId = credId;
      await setSetting(KEYS.noteCred, credId);
    }

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: b64ToBytes(credId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return { ok: !!assertion };
  } catch (e) {
    const name = e?.name || '';
    const reason = name === 'NotAllowedError' || name === 'AbortError' ? 'cancelled' : String(e?.message || e);
    return { ok: false, reason };
  }
}

/** تغيير مدة القفل التلقائي. */
export async function setRelockMs(ms) {
  state.relockMs = Number(ms) || 0;
  await setSetting(KEYS.relock, state.relockMs);
}

/**
 * تصفير الحاجز الزمني ومحاولات الفشل (يُستخدم بعد إعادة الإعداد أو في الاختبارات).
 * لا يفتح التطبيق ولا يتجاوز التحقق: ما زال السر الصحيح مطلوبًا.
 */
export async function clearLockout() {
  state.lockUntil = 0;
  state.attempts = 0;
  await setSetting(KEYS.until, 0);
  await setSetting(KEYS.attempts, 0);
}

/** قفل فوري: يمسح مفتاح الجلسة من الذاكرة. */
export function lockNow() {
  clearSessionKey();
  state.unlocked = false;
}

/** إطفاء القفل: يفك التشفير ثم يمسح الإعدادات (يتطلب تحققًا مسبقًا من المتصل). */
export async function disableLock() {
  await migrateNotes(null, false);
  setFieldEncryption(false);
  clearSessionKey();
  state.enabled = false;
  state.method = null;
  state.salt = null;
  state.canary = null;
  state.encrypted = false;
  state.credId = null;
  state.prfSalt = null;
  state.unlocked = true;
  await setSetting(KEYS.enabled, false);
  await setSetting(KEYS.method, '');
  await setSetting(KEYS.salt, '');
  await setSetting(KEYS.canary, '');
  await setSetting(KEYS.encrypted, false);
  await setSetting(KEYS.credId, '');
  await setSetting(KEYS.prfSalt, '');
  await resetFailures();
  return true;
}

/**
 * مسح كل البيانات المحلية (حالة «نسيت الباترن/الرمز»).
 * لا يفتح المشفَّر ولا يتحايل عليه: يمحو قاعدة البيانات والإعدادات ويبدأ التطبيق نظيفًا.
 */
export async function wipeAllData() {
  clearSessionKey();
  try { localStorage.removeItem('daftar-settings'); } catch { /* غير متاح */ }
  try {
    if (typeof indexedDB !== 'undefined') {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('daftar');
        req.onsuccess = resolve;
        req.onerror = resolve;
        req.onblocked = resolve;
      });
    }
  } catch { /* لا شيء */ }
  try { sessionStorage.clear(); } catch { /* غير متاح */ }
  return true;
}

/** هل تحتاج الجلسة إعادة فتح؟ (يُستخدم عند العودة من الخلفية) */
export function shouldRelock(backgroundedAt) {
  if (!state.enabled) return false;
  if (!state.unlocked) return false;
  if (!backgroundedAt) return false;
  return (Date.now() - backgroundedAt) > state.relockMs;
}

export { hasSessionKey, isFieldEncryption };
