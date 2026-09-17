/*
 * طبقة التخزين — مكافئ Room + DataStore في نسخة الويب.
 *
 * التخزين الأساسي IndexedDB (يبقى على الجهاز ولا يخرج منه)، مع:
 *  - مخطط ملاحظة مطابق تمامًا لنسخة أندرويد (نفس أسماء الحقول وصيغة HTML)،
 *    ما يجعل ملفات النسخ الاحتياطي متبادلة بين النسختين.
 *  - سقوط آمن إلى الذاكرة عند تعذّر IndexedDB (المعاينة داخل إطار مقيّد،
 *    أو تصفح خاص في بعض المتصفحات) حتى يظل التطبيق قابلًا للتجربة.
 */

const DB_NAME = 'daftar';
const DB_VERSION = 1;
const NOTES = 'notes';
const IMAGES = 'images';
const SETTINGS = 'settings';

export const storage = { persistent: false, mode: 'memory' };

/** ملاحظة جديدة بمخطط مطابق لنظيرتها في أندرويد. */
export function newNote(patch = {}) {
  const now = Date.now();
  return {
    id: null,
    title: '',
    contentHtml: '',
    folderId: null,
    isFavorite: false,
    isDeleted: false,
    isPinned: false,
    colorLabel: null,
    status: 'draft', // draft | done
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

// ---------------------------------------------------------------- IDB helpers

let _db = null;

function openIDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOTES)) {
        const notes = db.createObjectStore(NOTES, { keyPath: 'id', autoIncrement: true });
        notes.createIndex('updatedAt', 'updatedAt');
        notes.createIndex('isDeleted', 'isDeleted');
      }
      if (!db.objectStoreNames.contains(IMAGES)) {
        const images = db.createObjectStore(IMAGES, { keyPath: 'id', autoIncrement: true });
        images.createIndex('noteId', 'noteId');
      }
      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
    req.onblocked = () => reject(new Error('idb blocked'));
  });
}

function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = _db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (e) {
      return reject(e);
    }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------- memory fallback

const mem = { notes: [], images: [], settings: new Map(), nextNoteId: 1, nextImageId: 1 };

// ---------------------------------------------------------------- API

export async function init() {
  try {
    _db = await openIDB();
    // فحص كتابة فعلي (بعض المتصفحات تسمح بالفتح وترفض الكتابة)
    await tx(SETTINGS, 'readwrite', (s) => s.put({ key: '__probe', value: Date.now() }));
    storage.persistent = true;
    storage.mode = 'indexeddb';
  } catch (e) {
    console.warn('[daftar] التخزين الدائم غير متاح، سيُستخدم تخزين مؤقت في الذاكرة:', e);
    storage.persistent = false;
    storage.mode = 'memory';
  }
  return storage;
}

export async function allNotes() {
  if (storage.mode === 'indexeddb') {
    const list = await tx(NOTES, 'readonly', (s) => reqDone(s.getAll()));
    return (list || []).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return [...mem.notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNote(id) {
  if (storage.mode === 'indexeddb') {
    const note = await tx(NOTES, 'readonly', (s) => reqDone(s.get(Number(id))));
    return note || null;
  }
  return mem.notes.find((n) => n.id === Number(id)) || null;
}

/** إدراج أو تحديث. يعيد المعرّف الجديد. */
export async function saveNote(note) {
  const payload = { ...note, updatedAt: note.updatedAt || Date.now() };
  // حاسم: مع مخزن autoIncrement يجب ألا يُرسل المفتاح إطلاقًا عند الإدراج،
  // لأن id = null قيمة غير صالحة وتُفشل العملية (DataError).
  if (payload.id == null) delete payload.id;
  if (storage.mode === 'indexeddb') {
    const id = await tx(NOTES, 'readwrite', (s) => reqDone(s.put(payload)));
    return id;
  }
  if (payload.id == null) {
    payload.id = mem.nextNoteId++;
    mem.notes.push(payload);
  } else {
    const i = mem.notes.findIndex((n) => n.id === payload.id);
    if (i >= 0) mem.notes[i] = payload;
    else mem.notes.push(payload);
  }
  return payload.id;
}

/** تغييرات جزئية (تثبيت/مفضلة/لون/حالة/حذف ناعم). */
export async function patchNote(id, patch) {
  const note = await getNote(id);
  if (!note) return null;
  const next = { ...note, ...patch, updatedAt: patch.updatedAt || Date.now() };
  await saveNote(next);
  return next;
}

/** حذف نهائي: الملاحظة + صورها (ملفاتها). */
export async function deleteNoteForever(id) {
  const imgs = await imagesFor(id);
  if (storage.mode === 'indexeddb') {
    await tx(IMAGES, 'readwrite', (s) => { imgs.forEach((img) => s.delete(img.id)); });
    await tx(NOTES, 'readwrite', (s) => s.delete(Number(id)));
  } else {
    mem.images = mem.images.filter((i) => i.noteId !== Number(id));
    mem.notes = mem.notes.filter((n) => n.id !== Number(id));
  }
  return imgs.length;
}

/** إفراغ سلة المحذوفات بالكامل (مع صورها). */
export async function emptyTrash() {
  const notes = (await allNotes()).filter((n) => n.isDeleted);
  let removedImages = 0;
  for (const n of notes) removedImages += await deleteNoteForever(n.id);
  return { notes: notes.length, images: removedImages };
}

// ---------------------------------------------------------------- الصور

export async function addImage(noteId, blob, name) {
  const record = { noteId: Number(noteId), blob, name: name || `img_${Date.now()}.jpg`, order: 0, createdAt: Date.now() };
  if (storage.mode === 'indexeddb') {
    const id = await tx(IMAGES, 'readwrite', (s) => reqDone(s.add(record)));
    return { ...record, id };
  }
  const existing = mem.images.filter((i) => i.noteId === Number(noteId));
  record.order = existing.length;
  record.id = mem.nextImageId++;
  mem.images.push(record);
  return record;
}

export async function imagesFor(noteId) {
  if (storage.mode === 'indexeddb') {
    const idx = _db.transaction(IMAGES, 'readonly').objectStore(IMAGES).index('noteId');
    const list = await reqDone(idx.getAll(Number(noteId)));
    return (list || []).sort((a, b) => a.order - b.order || a.id - b.id);
  }
  return mem.images.filter((i) => i.noteId === Number(noteId)).sort((a, b) => a.order - b.order);
}

export async function deleteImage(imageId) {
  if (storage.mode === 'indexeddb') await tx(IMAGES, 'readwrite', (s) => s.delete(imageId));
  else mem.images = mem.images.filter((i) => i.id !== imageId);
}

export async function allImages() {
  if (storage.mode === 'indexeddb') {
    const list = await tx(IMAGES, 'readonly', (s) => reqDone(s.getAll()));
    return list || [];
  }
  return [...mem.images];
}

// ---------------------------------------------------------------- الإعدادات

const SETTINGS_DEFAULTS = {
  theme: 'system',           // system | light | dark
  fontKey: 'cairo',          // cairo | amiri | tajawal | notoNaskh | notoSans
  fontSize: 18,
  sortMode: 'newest',        // newest | oldest | alpha | alphaAr
  lastUnlockTime: 0,
};

export async function getSettings() {
  const stored = {};
  if (storage.mode === 'indexeddb') {
    const rows = await tx(SETTINGS, 'readonly', (s) => reqDone(s.getAll()));
    (rows || []).forEach((row) => { stored[row.key] = row.value; });
  } else {
    mem.settings.forEach((value, key) => { stored[key] = value; });
  }
  return { ...SETTINGS_DEFAULTS, ...stored };
}

export async function setSetting(key, value) {
  if (storage.mode === 'indexeddb') {
    await tx(SETTINGS, 'readwrite', (s) => s.put({ key, value }));
  } else {
    mem.settings.set(key, value);
  }
}

// ---------------------------------------------------------------- أدوات النسخ الاحتياطي

/** كل البيانات (بلا الصور) لملف JSON مطابق للنسخة الأصلية (v3). */
export async function exportPayload() {
  const notes = (await allNotes()).map((n) => ({
    title: n.title || '',
    contentHtml: n.contentHtml || '',
    isFavorite: !!n.isFavorite,
    isPinned: !!n.isPinned,
    colorLabel: n.colorLabel ?? null,
    status: n.status || 'draft',
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    images: [],
  }));
  return { version: 3, exportedAt: Date.now(), notes };
}

/** استيراد ملاحظات (تُضاف ولا تستبدل) ويعيد عددها. */
export async function importNotes(notes) {
  let count = 0;
  for (const n of notes || []) {
    try {
      await saveNote(newNote({
        title: n.title || '',
        contentHtml: n.contentHtml || '',
        isFavorite: !!n.isFavorite,
        isPinned: !!n.isPinned,
        colorLabel: n.colorLabel ?? null,
        status: n.status || 'draft',
        createdAt: Number(n.createdAt) || Date.now(),
        updatedAt: Number(n.updatedAt) || Date.now(),
      }));
      count += 1;
    } catch (e) {
      console.warn('[daftar] فشل استيراد ملاحظة', e);
    }
  }
  return count;
}

/** للحذف النهائي: جمع كل ما سيُحذف (لملفات الصور على القرص عند التصدير). */
export async function deletedNotes() {
  return (await allNotes()).filter((n) => n.isDeleted);
}
