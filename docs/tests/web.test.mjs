/*
 * اختبارات نسخة الويب (تعمل بـ: node --test docs/tests/)
 *
 * تركّز على ما لا يعوّض خطؤه:
 *  1) صيغة ZIP: أن نكتب أرشيفًا يقرأه تطبيق أندرويد (java.util.zip) والعكس.
 *  2) توافق ملف النسخة الاحتياطية (daftar.json v3 + مسارات الصور).
 *  3) دوال النص العربية المطابقة لسلوك النسخة الأصلية.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { buildZip, readZip, backupFileName } from '../js/backup.js';
import { normalizeArabic, stripHtml, snippet, formatDateTime, escapeHtml, looksLikeHtml } from '../js/util.js';

const enc = new TextEncoder();

// ---------------------------------------------------------------- ZIP

test('ZIP: الكتابة ثم القراءة تعيد نفس البايتات (STORE)', async () => {
  const text = enc.encode('مرحبًا بك في دفتر — داftar 2.6');
  const binary = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const blob = buildZip([
    { name: 'daftar.json', data: text },
    { name: 'images/7/img_1.jpg', data: binary },
  ]);

  const entries = await readZip(blob);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.name), ['daftar.json', 'images/7/img_1.jpg']);

  const jsonBack = await entries[0]._load();
  assert.equal(new TextDecoder().decode(jsonBack), 'مرحبًا بك في دفتر — داftar 2.6');

  const binBack = await entries[1]._load();
  assert.deepEqual([...binBack], [...binary], 'البايتات الثنائية يجب أن تعود كما هي');
});

test('ZIP: نقرأ أرشيفًا مضغوطًا (DEFLATE) كما ينتجه تطبيق أندرويد', async () => {
  const original = enc.encode('<p>ملاحظة مضغوطة</p>'.repeat(50));
  const compressed = new Uint8Array(deflateRawSync(Buffer.from(original)));

  // ابنِ أرشيف DEFLATE يدويًا (كما يفعله ZipOutputStream في Kotlin)
  const name = enc.encode('daftar.json');
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0x0800, true);
  lv.setUint16(8, 8, true); // DEFLATE
  lv.setUint32(18, compressed.length, true);
  lv.setUint32(22, original.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);

  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x0800, true);
  cv.setUint16(10, 8, true); // DEFLATE
  cv.setUint32(20, compressed.length, true);
  cv.setUint32(24, original.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true);
  central.set(name, 46);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + compressed.length, true);

  const zip = new Blob([local, compressed, central, end]);
  const entries = await readZip(zip);
  assert.equal(entries.length, 1);
  const data = await entries[0]._load();
  assert.equal(new TextDecoder().decode(data), new TextDecoder().decode(original));
});

test('ZIP: ملف غير صالح يُرفض برسالة واضحة', async () => {
  await assert.rejects(() => readZip(new Blob([enc.encode('ليس أرشيفًا')])), /ZIP/);
});

test('اسم ملف النسخة يحمل التاريخ والامتداد الصحيح', () => {
  const name = backupFileName();
  assert.match(name, /^daftar_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.daftar\.zip$/);
});

// ---------------------------------------------------------------- النصوص العربية

test('تطبيع العربية يوحّد الهمزات ويحذف التشكيل (مطابق للنسخة الأصلية)', () => {
  assert.equal(normalizeArabic('ألأ'), 'الا');
  assert.equal(normalizeArabic('مَدْرَسَة'), 'مدرسة');
  assert.equal(normalizeArabic('يُوسُف'), 'يوسف');
  assert.ok(normalizeArabic('إبراهيم').startsWith('ابراه'));
  assert.equal(normalizeArabic('سلام'), normalizeArabic('سَلَام'));
});

test('تجريد HTML يزيل الوسوم ويدمج المسافات ويحوّل الفواصل', () => {
  assert.equal(stripHtml('<p>مرحبًا <b>بك</b></p><p>سطر ثانٍ</p>'), 'مرحبًا بك\nسطر ثانٍ');
  assert.equal(stripHtml('سطر<br>آخر'), 'سطر\nآخر');
  assert.equal(stripHtml('<p>أ &amp; ب &lt;ج&gt;</p>'), 'أ & ب <ج>');
  assert.equal(stripHtml('<p>أ</p><p></p><p>ب</p>'), 'أ\nب');
  assert.equal(stripHtml(''), '');
});

test('المقطع المختصر يقتطع بثلاث نقاط', () => {
  const long = '<p>' + 'ك'.repeat(200) + '</p>';
  assert.ok(snippet(long, 50).endsWith('…'));
  assert.equal(snippet('<p>قصير</p>', 50), 'قصير');
});

test('تنسيق التاريخ بالعربية', () => {
  const d = new Date(2026, 7, 21, 9, 45);
  assert.equal(formatDateTime(d.getTime()), '21 أغسطس 2026، 09:45');
});

test('تهريب HTML يحمي من إدخال الوسوم', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('كشف HTML يميّز النص العربي عن الوسوم الفعلية', () => {
  assert.equal(looksLikeHtml('<p>نص</p>'), true);
  assert.equal(looksLikeHtml('الجملة العربية <ليست وسم>'), false);
  assert.equal(looksLikeHtml('نص عادي'), false);
});
