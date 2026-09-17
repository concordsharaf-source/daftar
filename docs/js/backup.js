/*
 * النسخ الاحتياطي والاستعادة — متوافق تمامًا مع تطبيق أندرويد.
 *
 * صيغة الملف نفسه الذي ينتجه BackupManager.kt في النسخة الأصلية:
 *   ZIP  ←  daftar.json  (version 3: قائمة الملاحظات)
 *           images/<noteId>/<file>
 * فيمكن:
 *   - استيراد نسخة صُنعت على الأندرويد إلى الويب، والعكس.
 *
 * كاتب ZIP/قارئه مكتوبان هنا بلا أي مكتبة خارجية:
 *   - الكتابة بطريقة STORE (بلا ضغط) — يقرأها Kotlin ومضغوطة؟ لا يهم: STORE مقروء.
 *   - القراءة تدعم STORE و DEFLATE (عبر DecompressionStream في المتصفحات الحديثة).
 */

import { allImages, allNotes, newNote, saveNote, addImage, imagesFor } from './db.js';
import { stripHtml } from './util.js';

// ---------------------------------------------------------------- CRC32

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- كاتب ZIP

const enc = new TextEncoder();

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

/** يبني ملف ZIP من قائمة {name, data: Uint8Array}. */
export function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);      // نسخة الاستخراج
    lv.setUint16(6, 0x0800, true);  // أسماء UTF-8
    lv.setUint16(8, 0, true);       // STORE
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, data);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralEntry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

// ---------------------------------------------------------------- قارئ ZIP

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('متصفحك لا يدعم فك ضغط DEFLATE. استخدم نسخة JSON أو متصفحًا أحدث.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** يفك ZIP ويعيد [{name, data}] + نصوص جاهزة. */
export async function readZip(fileOrBlob) {
  const buffer = new Uint8Array(await fileOrBlob.arrayBuffer());
  const view = new DataView(buffer.buffer);

  // ابحث عن سجل نهاية الدليل المركزي من النهاية
  let eocd = -1;
  const minPos = Math.max(0, buffer.length - 66000);
  for (let i = buffer.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('الملف ليس أرشيف ZIP صالحًا');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder('utf-8').decode(buffer.subarray(ptr + 46, ptr + 46 + nameLen));

    // اقرأ البيانات من الرأس المحلي
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    out.push({
      name,
      method,
      compressed: raw,
      get data() { return this._data; },
      _load: async function load() {
        if (this._data) return this._data;
        this._data = method === 0 ? raw.slice() : await inflateRaw(raw);
        return this._data;
      },
    });

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------- التصدير

function imageName(noteId, name, index) {
  const safe = String(name || `img_${index + 1}.jpg`).replace(/[^\w.\-]+/g, '_');
  return `images/${noteId}/${safe}`;
}

/** يبني ZIP كاملًا (daftar.json + الصور) مطابقًا لصيغة النسخة الأصلية. */
export async function buildBackupZip() {
  const notes = await allNotes();
  const entries = [];
  const manifestNotes = [];

  for (const note of notes) {
    const imgs = await imagesFor(note.id);
    const paths = [];
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const path = imageName(note.id, img.name, i);
      paths.push(path);
      entries.push({ name: path, data: new Uint8Array(await img.blob.arrayBuffer()) });
    }
    manifestNotes.push({
      title: note.title || '',
      contentHtml: note.contentHtml || '',
      isFavorite: !!note.isFavorite,
      isPinned: !!note.isPinned,
      colorLabel: note.colorLabel ?? null,
      status: note.status || 'draft',
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      images: paths,
    });
  }

  const manifest = { version: 3, exportedAt: Date.now(), notes: manifestNotes };
  entries.unshift({ name: 'daftar.json', data: enc.encode(JSON.stringify(manifest, null, 2)) });
  return buildZip(entries);
}

export function backupFileName(ext = 'daftar.zip') {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `daftar_backup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.${ext}`;
}

// ---------------------------------------------------------------- القراءة والاستيراد

/**
 * يقرأ ملف نسخة (ZIP أو JSON قديم) ويعيد:
 * { version, exportedAt, notes, images: [{noteIndex, path, blob}] }
 */
export async function parseBackupFile(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;

  if (!isZip) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.notes)) throw new Error('صيغة الملف غير معروفة');
    return { version: parsed.version || 2, exportedAt: parsed.exportedAt || Date.now(), notes: parsed.notes, images: [] };
  }

  const entries = await readZip(file);
  const manifestEntry = entries.find((e) => e.name === 'daftar.json');
  if (!manifestEntry) throw new Error('الملف لا يحتوي daftar.json');

  const manifest = JSON.parse(new TextDecoder('utf-8').decode(await manifestEntry._load()));

  // اربط ملفات الصور بالملاحظات عبر المسارات المذكورة في daftar.json
  const images = [];
  const byPath = new Map(entries.map((e) => [e.name, e]));
  (manifest.notes || []).forEach((note, noteIndex) => {
    (note.images || []).forEach((path) => {
      const entry = byPath.get(path);
      if (entry) images.push({ noteIndex, path, entry });
    });
  });

  return {
    version: manifest.version || 3,
    exportedAt: manifest.exportedAt || Date.now(),
    notes: manifest.notes || [],
    images,
  };
}

/** ينفّذ الاستيراد فعليًا: يُضيف الملاحظات ثم يربط صورها. */
export async function applyImport(parsed) {
  let importedNotes = 0;
  let importedImages = 0;
  const idByIndex = new Map();

  for (let i = 0; i < parsed.notes.length; i++) {
    const n = parsed.notes[i];
    const id = await saveNote(newNote({
      title: n.title || '',
      contentHtml: n.contentHtml || '',
      isFavorite: !!n.isFavorite,
      isPinned: !!n.isPinned,
      colorLabel: n.colorLabel ?? null,
      status: n.status || 'draft',
      createdAt: Number(n.createdAt) || Date.now(),
      updatedAt: Number(n.updatedAt) || Date.now(),
    }));
    idByIndex.set(i, id);
    importedNotes += 1;

    // الصور: من الأرشيف أو من ملف JSON
    const related = parsed.images.filter((img) => img.noteIndex === i);
    for (const img of related) {
      try {
        const bytes = img.entry ? await img.entry._load() : null;
        if (!bytes) continue;
        const name = String(img.path).split('/').pop() || 'image.jpg';
        await addImage(id, new Blob([bytes]), name);
        importedImages += 1;
      } catch (e) {
        console.warn('[daftar] تعذّر استيراد صورة', img.path, e);
      }
    }
  }
  return { notes: importedNotes, images: importedImages };
}

/** عدد الصور الكلي (للعرض في شاشة الإعدادات). */
export async function stats() {
  const notes = await allNotes();
  const images = await allImages();
  const chars = notes.reduce((sum, n) => sum + stripHtml(n.contentHtml).length, 0);
  return {
    notes: notes.length,
    trashed: notes.filter((n) => n.isDeleted).length,
    images: images.length,
    chars,
  };
}
