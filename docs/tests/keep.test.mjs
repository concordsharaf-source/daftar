/*
 * اختبارات استيراد Google Keep:
 *  - تحويل ملاحظة Keep كاملة (عنوان، نص، ألوان، تثبيت، تواريخ، سلة)
 *  - قوائم المهام (listContent + isChecked) → قائمة HTML بمربّعات
 *  - أسطر النص → فقرات، مع تهريب HTML فلا يُنفَّذ أي وسم من ملف خارجي
 *  - قراءة أرشيف ZIP كما ينتجه Takeout (بمجلد Keep) + المرفقات
 *  - رفض الملفات غير التابعة لـKeep برسالة واضحة
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  looksLikeKeepNote, textToHtml, listToHtml, keepNoteToDaftar,
  parseKeepZip, parseKeepFile, importKeep, keepReportText,
} from '../js/keep.js';
import { buildZip } from '../js/backup.js';
import * as db from '../js/db.js';
import * as crypto from '../js/crypto.js';

const USEC = 1_000_000; // ثانية → مايكرو ثانية

function keepNote(patch = {}) {
  return {
    color: 'DEFAULT',
    isTrashed: false,
    isPinned: false,
    isArchived: false,
    textContent: '',
    title: '',
    userEditedTimestampUsec: 1_700_000_000 * USEC,
    createdTimestampUsec: 1_699_000_000 * USEC,
    labels: [],
    attachments: [],
    listContent: [],
    ...patch,
  };
}

/** ملف JSON كما يختاره المستخدم من الجهاز (File متاح في Node 20+). */
function jsonFileFrom(obj, name) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return new File([text], name, { type: 'application/json' });
}

function bytesFileFrom(bytes, name, type = 'application/zip') {
  return new File([bytes], name, { type });
}

test('التعرّف على صيغة Keep ورفض ما ليس منها', () => {
  assert.equal(looksLikeKeepNote(keepNote()), true);
  assert.equal(looksLikeKeepNote({ notes: [{ title: 'x' }] }), false, 'نسخة دفتر ليست ملاحظة Keep');
  assert.equal(looksLikeKeepNote({ title: 'ملاحظة', contentHtml: '<p>x</p>' }), false);
  assert.equal(looksLikeKeepNote(null), false);
  assert.equal(looksLikeKeepNote({ listContent: [{ text: 'مهمة', isChecked: false }], title: 'قائمة', isTrashed: false }), true);
  assert.equal(looksLikeKeepNote({ listContent: [{ text: 'مهمة' }] }), false, 'بلا حقول Keep المعروفة لا يُعدّ ملاحظة Keep');
});

test('نص Keep → فقرات مع تهريب الوسوم', () => {
  const html = textToHtml('سطر أول\nسطر <b>ثانٍ</b>\n\nسطر ثالث');
  assert.equal(html, '<p>سطر أول</p><p>سطر &lt;b&gt;ثانٍ&lt;/b&gt;</p><p>سطر ثالث</p>');
  assert.equal(textToHtml('   '), '', 'النص الفارغ لا يُنتج فقرات');
  assert.equal(textToHtml('سطر واحد'), '<p>سطر واحد</p>');
});

test('قائمة مهام Keep → قائمة HTML بمربّعات ☑/☐', () => {
  const html = listToHtml([
    { text: 'مهمة منجزة', isChecked: true },
    { text: 'مهمة متبقية', isChecked: false },
    { text: '   ', isChecked: false },
  ], 'ملاحظة قبل القائمة');
  assert.equal(html, '<p>ملاحظة قبل القائمة</p>'
    + '<ul><li>☑ مهمة منجزة</li><li>☐ مهمة متبقية</li></ul>');
});

test('ملاحظة Keep كاملة → ملاحظة دفتر بكل الحقول', () => {
  const note = keepNoteToDaftar(keepNote({
    title: 'قائمة تسوّق',
    textContent: 'ملاحظة عن التسوّق\nمع سطر ثانٍ',
    isPinned: true,
    color: 'GREEN',
    labels: [{ name: 'شخصي' }, { name: 'بيت' }],
    listContent: [{ text: 'خبز', isChecked: false }, { text: 'حليب', isChecked: true }],
    createdTimestampUsec: 1_699_000_000 * USEC,
    userEditedTimestampUsec: 1_700_000_000 * USEC,
  }));

  assert.equal(note.title, 'قائمة تسوّق');
  assert.equal(note.isPinned, true);
  assert.equal(note.isDeleted, false);
  assert.equal(note.colorLabel, '#A5D6A7', 'الأخضر في Keep → الأخضر في دفتر');
  assert.equal(note.createdAt, 1_699_000_000 * 1000, 'التاريخ من مايكرو ثانية إلى ميلي ثانية');
  assert.equal(note.updatedAt, 1_700_000_000 * 1000);
  assert.match(note.contentHtml, /<p>ملاحظة عن التسوّق<\/p><p>مع سطر ثانٍ<\/p>/);
  assert.match(note.contentHtml, /<li>☐ خبز<\/li><li>☑ حليب<\/li>/);
  assert.deepEqual(note.__meta.labels, ['شخصي', 'بيت']);
  assert.equal(note.__meta.isList, true);
});

test('لون غير معروف وتاريخ ناقص لا يكسران الاستيراد', () => {
  const note = keepNoteToDaftar({ title: 'بلا تواريخ', textContent: 'x', color: 'MAGENTA' });
  assert.equal(note.colorLabel, null);
  assert.ok(note.createdAt > 1_600_000_000_000, 'يُستخدم وقت الآن عند غياب التاريخ');
  assert.equal(note.updatedAt, note.createdAt);

  const trashed = keepNoteToDaftar(keepNote({ textContent: 'قديمة', isTrashed: true }));
  assert.equal(trashed.isDeleted, true, 'المحذوف في Keep يذهب إلى السلة');
});

test('قراءة أرشيف Takeout (ZIP) بمجلد Keep مع مرفق', async () => {
  const zip = buildZip([
    { name: 'Takeout/Keep/ملاحظة.json', data: new TextEncoder().encode(JSON.stringify(keepNote({ title: 'أولى', textContent: 'نص أول' }))) },
    { name: 'Takeout/Keep/ملاحظة.html', data: new TextEncoder().encode('<html>نتجاهلها</html>') },
    { name: 'Takeout/Keep/قائمة.json', data: new TextEncoder().encode(JSON.stringify(keepNote({ title: 'قائمة', listContent: [{ text: 'بند', isChecked: true }] }))) },
    { name: 'Takeout/Keep/ملاحظة.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
    { name: 'Takeout/Keep/README.txt', data: new TextEncoder().encode('ملف لا علاقة له') },
    { name: 'daftar.json', data: new TextEncoder().encode('{"version":3,"notes":[]}') },
  ]);

  const parsed = await parseKeepZip(zip);
  assert.equal(parsed.notes.length, 2, 'تُقرأ الملاحظتان فقط ويُتجاهل daftar.json');
  assert.deepEqual(parsed.notes.map((n) => n.title).sort(), ['أولى', 'قائمة'].sort());
  assert.equal(parsed.images.length, 1, 'الصورة تُربط بملاحظة بنفس الاسم');
  assert.equal(parsed.images[0].noteIndex, 0);
  assert.match(parsed.images[0].path, /ملاحظة\.png$/);
});

test('ملف واحد بصيغة JSON (تصدير ملاحظة) يُقرأ ويستورد', async () => {
  const parsed = await parseKeepFile(jsonFileFrom(keepNote({ title: 'مفردة', textContent: 'سطر' }), 'note.json'));
  assert.equal(parsed.notes.length, 1);
  assert.equal(parsed.notes[0].title, 'مفردة');
});

test('ملف ليس من Keep يُرفض برسالة عربية واضحة', async () => {
  await assert.rejects(
    () => parseKeepZip(buildZip([{ name: 'daftar.json', data: new TextEncoder().encode('{"notes":[]}') }])),
    /Keep/,
    'رسالة الرفض تذكر Keep',
  );
  await assert.rejects(
    () => parseKeepFile(jsonFileFrom({ version: 3, notes: [] }, 'daftar.json')),
    /Keep/,
  );
  await assert.rejects(
    () => parseKeepZip(bytesFileFrom(new Uint8Array([1, 2, 3, 4]), 'x.zip')),
    /ZIP/,
  );
});

test('الاستيراد الفعلي يضيف الملاحظات إلى المخزن ولا يحذف شيئًا', async () => {
  await db.init();
  crypto.setFieldEncryption(false);
  crypto.clearSessionKey();

  const existing = await db.saveNote(db.newNote({ title: 'ملاحظة موجودة' }));
  const before = (await db.allNotes()).length;

  const zip = buildZip([
    { name: 'Takeout/Keep/a.json', data: new TextEncoder().encode(JSON.stringify(keepNote({
      title: 'من Keep ١', textContent: 'نص', isPinned: true, color: 'BLUE',
    }))) },
    { name: 'Takeout/Keep/b.json', data: new TextEncoder().encode(JSON.stringify(keepNote({
      title: 'من Keep ٢', listContent: [{ text: 'بند', isChecked: false }], isTrashed: true,
    }))) },
    { name: 'Takeout/Keep/c.json', data: new TextEncoder().encode('ملف تالف غير JSON') },
  ]);

  const report = await importKeep([new File([zip], 'takeout.zip', { type: 'application/zip' })]);
  assert.equal(report.notes, 2);
  assert.equal(report.pinned, 1);
  assert.equal(report.lists, 1);
  assert.equal(report.trashed, 1);

  const after = await db.allNotes();
  assert.equal(after.length - before, 2, 'ملاحظتان جديدتان فقط');
  assert.ok(after.some((n) => n.id === existing), 'الملاحظات القديمة لم تُمسّ');

  const pinned = after.find((n) => n.title === 'من Keep ١');
  assert.equal(pinned.isPinned, true);
  assert.equal(pinned.colorLabel, '#90CAF9');

  const trashed = after.find((n) => n.title === 'من Keep ٢');
  assert.equal(trashed.isDeleted, true, 'المحذوف في Keep يظهر في سلة دفتر');
  assert.match(trashed.contentHtml, /☐ بند/);

  const text = keepReportText(report);
  assert.match(text, /2 ملاحظة/);
  assert.match(text, /السلة/);

  // لا نُسرّب حقل __meta المساعد إلى المخزن
  assert.equal('__meta' in pinned, false);

  await db.deleteNoteForever(pinned.id);
  await db.deleteNoteForever(trashed.id);
});
