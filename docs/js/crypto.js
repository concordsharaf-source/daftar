/*
 * طبقة التشفير — أساس «قفل التطبيق» في نسخة الويب.
 *
 * المبدأ: القفل ليس حاجزًا بصريًا فقط، بل مفتاح فعلي:
 *  - الباترن/الرمز يُشتق منه مفتاح AES-GCM عبر PBKDF2-SHA256 (210,000 دورة).
 *  - نص الملاحظة والعنوان يُشفَّران قبل الكتابة في IndexedDB، ولا يُفكّان إلا
 *    بعد الفتح الصحيح ⇒ من يقرأ بيانات المتصفح يجد نصًا مشفّرًا لا ملاحظات.
 *
 * البنية:
 *  - مفتاح الجلسة (sessionKey) يعيش في الذاكرة فقط، ويُمسح عند القفل.
 *  - «الشاهد» (canary): نص معروف مشفّر بالمفتاح، يُستخدم للتحقق من صحة
 *    الباترن/الرمز بسرعة وبلا حاجة لتجربة فك تشفير كل الملاحظات.
 */

const PBKDF2_ITERATIONS = 210_000;
const AES_KEY_BITS = 256;
export const FIELD_PREFIX = 'enc:v1:';
export const CANARY_PLAINTEXT = 'daftar-canary-v1';

// ---------------------------------------------------------------- أدوات ثنائية

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function bytesToB64(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

export function b64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- حالة الجلسة

let sessionKey = null;        // CryptoKey لـAES-GCM
let fieldEncryption = false;  // هل التشفير مفعّل في هذا الجهاز؟

export function setSessionKey(key) { sessionKey = key || null; }
export function getSessionKey() { return sessionKey; }
export function hasSessionKey() { return !!sessionKey; }
export function clearSessionKey() { sessionKey = null; }
export function setFieldEncryption(enabled) { fieldEncryption = !!enabled; }
export function isFieldEncryption() { return fieldEncryption; }

// ---------------------------------------------------------------- اشتقاق المفاتيح

/** يشتق 64 بايت من الباترن/الرمز: أول 32 مفتاح تشفير، وآخر 32 للتحقق. */
export async function deriveSecretBits(secret, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(secret)), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, base, 512,
  );
  return new Uint8Array(bits);
}

export async function importAesKey(keyBytes) {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function keyFromPattern(pattern, saltBytes) {
  const bits = await deriveSecretBits(pattern, saltBytes);
  return importAesKey(bits.slice(0, AES_KEY_BITS / 8));
}

export async function keyFromSecretBytes(secretBytes) {
  return importAesKey(new Uint8Array(secretBytes).slice(0, AES_KEY_BITS / 8));
}

export const ITERATIONS = PBKDF2_ITERATIONS;

// ---------------------------------------------------------------- تشفير الحقول

/** يشفّر نصًا ويعيده بصيغة enc:v1:<iv b64>:<ciphertext b64>. */
export async function encryptString(key, text) {
  const iv = randomBytes(12);
  const data = new TextEncoder().encode(String(text ?? ''));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return `${FIELD_PREFIX}${bytesToB64(iv)}:${bytesToB64(cipher)}`;
}

/** يفك تشفير نص مشفّر. يعيد null عند الفشل (مفتاح خاطئ أو بيانات تالفة). */
export async function decryptString(key, value) {
  if (typeof value !== 'string' || !value.startsWith(FIELD_PREFIX)) return value ?? null;
  try {
    const [ivB64, ctB64] = value.slice(FIELD_PREFIX.length).split(':');
    const iv = b64ToBytes(ivB64);
    const ct = b64ToBytes(ctB64);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(FIELD_PREFIX);
}

/** تشفير حقل حسب حالة الجلسة (يُستدعى من db.js عند الكتابة). */
export async function encryptField(text) {
  if (!fieldEncryption || !sessionKey) return text ?? '';
  return encryptString(sessionKey, text ?? '');
}

/**
 * فك تشفير حقل حسب حالة الجلسة (يُستدعى من db.js عند القراءة).
 * إن كان النص مشفّرًا ولا يوجد مفتاح جلسة ⇒ يعيد '' (لن تُعرض بيانات مكشوفة).
 */
export async function decryptField(value) {
  if (!isEncryptedValue(value)) return value ?? '';
  if (!sessionKey) return '';
  const plain = await decryptString(sessionKey, value);
  return plain === null ? '' : plain;
}

// ---------------------------------------------------------------- الشاهد (canary)

/** ينشئ شاهدًا مشفّرًا للتحقق من صحة المفتاح. */
export async function createCanary(key) {
  return encryptString(key, CANARY_PLAINTEXT);
}

/** يتحقق أن المفتاح يفتح الشاهد (أي أن الباترن/الرمز صحيح). */
export async function verifyCanary(key, canary) {
  const plain = await decryptString(key, canary);
  return plain === CANARY_PLAINTEXT;
}

/** قوة تقريبية للعرض للمستخدم (ليست مقياسًا أمنيًا دقيقًا). */
export function secretStrength(secret) {
  const chars = String(secret || '').length;
  if (chars === 0) return 0;
  if (chars <= 5) return 1;   // باترن قصير
  if (chars <= 8) return 2;
  return 3;
}
