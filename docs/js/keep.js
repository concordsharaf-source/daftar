/*
 * استيراد ملاحظات Google Keep (تصدير Takeout).
 *
 * تصدير Keep يأتي كأرشيف ZIP فيه مجلد `Takeout/Keep/` يحتوي لكل ملاحظة:
 *   - `<الاسم>.json` : بيانات الملاحظة (عنوان، نص، قوائم، تواريخ، لون، تثبيت، سلة)
 *   - `<الاسم>.html` : نسخة مهيّأة للطباعة (نتجاهلها ونعتمد JSON لأنه أدقّ)
 *   - صور/مرفقات بنفس اسم الملاحظة
 *
 * هذا الملف يحوّل صيغة Keep إلى صيغة «دفتر» مباشرة، بلا أي تعديل على ملفك:
 *   Keep                    →  دفتر
 *   title                   →  title
 *   textContent (أسطر)      →  contentHtml (فقرات <p>)
 *   listContent + isChecked →  قائمة <ul> بمربّعات ☑/☐
 *   isPinned / isTrashed    →  isPinned / isDeleted (تُوضع في السلة)
 *   color (RED/…)           →  colorLabel بأقرب لون في دفتر
 *   created/edited Usec     →  createdAt/updatedAt بالميلي ثانية
 *   labels                  →  لا مثيل لها في دفتر (تُبلَّغ في التقرير)
 */

import { readZip } from './backup.js';
import { saveNote, newNote, addImage } from './db.js';
import { escapeHtml } from './util.js';

/** ألوان Keep → أقرب لون في «دفتر» (نفس ألوان تطبيق أندرويد). */
const COLOR_MAP = {
  DEFAULT: null,
  GRAY: null,
  RED: '#EF9A9A',
  PINK: '#EF9A9A',
  ORANGE: '#FFCC80',
  BROWN: '#FFCC80',
  YELLOW: '#FFE082',
  GREEN: '#A5D6A7',
  TEAL: '#80DEEA',
  BLUE: '#90CAF9',
  DARKBLUE: '#90CAF9',
  PURPLE: '#CE93D8',
};

const USEC = 1000; // مايكرو ثانية → ميلي ثانية

/** هل هذا الكائن ملاحظة Keep؟ (نتسامح مع الحقول الناقصة) */
export function looksLikeKeepNote(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.textContent === 'string' || Array.isArray(obj.listContent)) {
    return 'title' in obj || 'isTrashed' in obj || 'userEditedTimestampUsec' in obj
      || 'createdTimestampUsec' in obj || 'color' in obj;
  }
  return false;
}

/** نص Keep (بأسطره) → فقرات HTML آمنة. */
export function textToHtml(text) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return '';
  return raw.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

/** قائمة مهام Keep → قائمة HTML مع مربّع لكل عنصر. */
export function listToHtml(listContent, textContent = '') {
  const items = (listContent || [])
    .filter((item) => item && String(item.text || '').trim())
    .map((item) => `<li>${item.isChecked ? '☑' : '☐'} ${escapeHtml(String(item.text).trim())}</li>`)
    .join('');
  const list = items ? `<ul>${items}</ul>` : '';
  return textToHtml(textContent) + list;
}

/** ملاحظة Keep → ملاحظة «دفتر». */
export function keepNoteToDaftar(json) {
  const created = Number(json.createdTimestampUsec) || Number(json.userEditedTimestampUsec) || 0;
  const edited = Number(json.userEditedTimestampUsec) || created;
  const now = Date.now();

  return {
    title: String(json.title ?? '').trim(),
    contentHtml: listToHtml(json.listContent, json.textContent),
    isFavorite: false,
    isPinned: !!json.isPinned,
    colorLabel: Object.prototype.hasOwnProperty.call(COLOR_MAP, json.color)
      ? COLOR_MAP[json.color]
      : null,
    status: 'draft',
    createdAt: created ? Math.round(created / USEC) : now,
    updatedAt: edited ? Math.round(edited / USEC) : now,
    isDeleted: !!json.isTrashed,
    // بيانات مساعدة للتقرير فقط (لا تُحفظ)
    __meta: {
      labels: (json.labels || []).map((l) => l?.name).filter(Boolean),
      archived: !!json.isArchived,
      attachments: Array.isArray(json.attachments) ? json.attachments.length : 0,
      isList: Array.isArray(json.listContent) && json.listContent.length > 0,
    },
  };
}

/** يستخرج ملاحظات Keep من أرشيف ZIP (خذ الملف كما هو من Takeout). */
export async function parseKeepZip(fileOrBlob) {
  const entries = await readZip(fileOrBlob);
  const jsonEntries = entries.filter((e) => /\.json$/i.test(e.name));
  if (!jsonEntries.length) {
    throw new Error('لم أجد أي ملف JSON في الأرشيف — تأكد أنك اخترت ملف Takeout الذي يحتوي مجلد Keep.');
  }

  const notes = [];
  const images = [];
  const byBase = new Map(entries.map((e) => [baseName(e.name), e]));

  for (const entry of jsonEntries) {
    let json = null;
    try {
      json = JSON.parse(new TextDecoder('utf-8').decode(await entry._load()));
    } catch {
      continue; // ملف JSON لا يخصّ Keep أو تالف
    }
    if (!looksLikeKeepNote(json)) continue;

    const note = keepNoteToDaftar(json);
    const index = notes.length;
    notes.push(note);

    // مرفقات بنفس اسم ملف الملاحظة (Keep: note.png بجانب note.json)
    const base = baseName(entry.name);
    for (const candidate of entries) {
      const candidateBase = baseName(candidate.name);
      if (candidate === entry || candidateBase !== base) continue;
      if (!/\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(candidate.name)) continue;
      images.push({ noteIndex: index, path: candidate.name, entry: candidate });
    }
  }

  if (!notes.length) {
    throw new Error('الملف لا يبدو تصديرًا من Google Keep (لم أجد حقول Keep المعروفة).');
  }
  return { notes, images };
}

/** يقرأ ملفًا واحدًا (ZIP من Takeout أو JSON مفردًا) ويعيد {notes, images}. */
export async function parseKeepFile(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // PK

  if (isZip) return parseKeepZip(file);

  const json = JSON.parse(await file.text());
  const list = Array.isArray(json) ? json : [json];
  const keepNotes = list.filter(looksLikeKeepNote);
  if (!keepNotes.length) {
    throw new Error(`الملف «${file.name}» ليس تصديرًا من Google Keep.`);
  }
  return { notes: keepNotes.map(keepNoteToDaftar), images: [] };
}

/**
 * الاستيراد الفعلي: يُضيف الملاحظات (والصور إن وُجدت) ويعيد تقريرًا.
 * الملاحظات المحذوفة في Keep تدخل سلة «دفتر» ولا تُفقد.
 */
export async function importKeep(files, { onProgress } = {}) {
  const list = Array.from(files || []);
  const report = {
    notes: 0, images: 0, pinned: 0, lists: 0, trashed: 0,
    archived: 0, labels: new Set(), files: list.length, skipped: [],
  };

  for (const file of list) {
    let parsed;
    try {
      parsed = await parseKeepFile(file);
    } catch (e) {
      report.skipped.push(`${file.name}: ${e.message}`);
      continue;
    }

    for (let i = 0; i < parsed.notes.length; i++) {
      const note = parsed.notes[i];
      const meta = note.__meta || {};
      delete note.__meta;

      try {
        const id = await saveNote(newNote(note));
        report.notes += 1;
        if (note.isPinned) report.pinned += 1;
        if (meta.isList) report.lists += 1;
        if (note.isDeleted) report.trashed += 1;
        if (meta.archived) report.archived += 1;
        (meta.labels || []).forEach((l) => report.labels.add(l));

        const related = parsed.images.filter((img) => img.noteIndex === i);
        for (const img of related) {
          try {
            const bytes = await img.entry._load();
            const name = String(img.path).split('/').pop() || 'image.png';
            await addImage(id, new Blob([bytes]), name);
            report.images += 1;
          } catch (e) {
            console.warn('[daftar] تعذّر استيراد مرفق Keep', img.path, e);
          }
        }
      } catch (e) {
        report.skipped.push(`${note.title || 'بلا عنوان'}: ${e.message}`);
      }
      onProgress?.({ done: report.notes, total: parsed.notes.length });
    }
  }

  report.labels = [...report.labels];
  return report;
}

/** ملخّص عربي جاهز للعرض للمستخدم. */
export function keepReportText(report) {
  const parts = [`تم استيراد ${report.notes} ملاحظة`];
  if (report.pinned) parts.push(`${report.pinned} مثبّتة`);
  if (report.lists) parts.push(`${report.lists} قائمة مهام`);
  if (report.images) parts.push(`${report.images} صورة`);
  if (report.trashed) parts.push(`${report.trashed} في السلة (كانت محذوفة في Keep)`);
  if (report.labels.length) parts.push(`أُهملت وسوم: ${report.labels.join('، ')}`);
  if (report.skipped.length) parts.push(`${report.skipped.length} ملفًا لم يُقرأ`);
  return parts.join(' • ');
}

function baseName(path) {
  return String(path).split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
}
