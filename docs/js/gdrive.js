/*
 * مزامنة Google Drive — ترفع نسخة احتياطية (نفس صيغة daftar.zip) إلى مجلّد
 * مخفي خاص بالتطبيق (appDataFolder) داخل حساب المستخدم، وتنزّلها على أي جهاز.
 *
 * - المصادقة عبر Google Identity Services (token client) بلا خادم وسيط.
 * - النطاق المطلوب drive.appdata فقط: لا يرى التطبيق شيئًا من ملفات المستخدم.
 * - الرمز المميّز يُبقيان في ذاكرة الجلسة ولا يُخزَّنان على القرص.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'daftar-sync.zip';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let clientId = '';
let accessToken = null;
let expiresAt = 0;

export function setClientId(id) { clientId = (id || '').trim(); }
export function getClientId() { return clientId; }
export function isConnected() { return !!(accessToken && Date.now() < expiresAt - 60_000); }

/** خطّاف اختبارات: يضبط الرمز مباشرة بلا تدفق GIS. */
export function _setToken(token, ttlMs = 3_600_000) { accessToken = token; expiresAt = Date.now() + ttlMs; }

export function loadGis() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.google?.accounts?.oauth2) return resolve();
    if (typeof document === 'undefined') return reject(new Error('no document'));
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('تعذّر تحميل خدمات جوجل — تحقق من الاتصال'));
    document.head.appendChild(s);
  });
}

/** يفتح نافذة تسجيل جوجل ويعيد true عند نجاح منح الرمز. */
export async function connect() {
  if (!clientId) throw new Error('أدخل معرّف عميل OAuth أولًا');
  await loadGis();
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (settled) return;
        if (resp && resp.access_token) {
          settled = true;
          accessToken = resp.access_token;
          expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          resolve(true);
        } else {
          settled = true;
          reject(new Error('رفض جوجل منح الإذن'));
        }
      },
      error_callback: (err) => {
        if (settled) return;
        settled = true;
        reject(new Error(err?.type === 'popup_closed' ? 'أُغلقت نافذة جوجل قبل الإكمال' : 'تعذّر تسجيل الدخول بجوجل'));
      },
    });
    try {
      client.requestAccessToken({ prompt: '' });
    } catch (e) {
      if (!settled) { settled = true; reject(e); }
    }
  });
}

export function disconnect() {
  const t = accessToken;
  accessToken = null;
  expiresAt = 0;
  try { if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* تجاهل */ }
}

async function api(path, opts = {}) {
  if (!isConnected()) throw new Error('غير متصل بجوجل');
  const res = await fetch(`${API}/${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) { accessToken = null; expiresAt = 0; throw new Error('انتهت صلاحية الاتصال — أعد الاتصال'); }
  if (!res.ok) throw new Error(`خطأ Drive (${res.status})`);
  return res;
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await api(`files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`);
  const data = await res.json();
  return (data.files && data.files[0]) || null;
}

/** يرفع النسخة: تحدّيث إن وُجدت، إنشاء داخل appDataFolder وإلا. */
export async function uploadBackup(blob) {
  if (!isConnected()) await connect();
  const existing = await findFile();
  if (existing) {
    const res = await fetch(`${UPLOAD}/files/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/zip' },
      body: blob,
    });
    if (!res.ok) throw new Error(`خطأ Drive (${res.status})`);
    return existing.id;
  }
  const boundary = 'daftar' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`, blob, `\r\n--${boundary}--`,
  ]);
  const res = await fetch(`${UPLOAD}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`خطأ Drive (${res.status})`);
  const data = await res.json();
  return data.id;
}

/** ينزّل أحدث نسخة، أو null إن لا نسخة بعد. */
export async function downloadBackup() {
  if (!isConnected()) await connect();
  const f = await findFile();
  if (!f) return null;
  const res = await fetch(`${API}/files/${f.id}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`خطأ Drive (${res.status})`);
  return res.blob();
}

/** وقت آخر تعديل للنسخة على درايف (لعرضها للمستخدم)، أو null. */
export async function remoteModifiedTime() {
  if (!isConnected()) return null;
  const f = await findFile();
  return f ? f.modifiedTime : null;
}
