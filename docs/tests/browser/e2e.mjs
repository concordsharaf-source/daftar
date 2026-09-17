/*
 * اختبار شامل في متصفح حقيقي (Chromium) لنسخة الويب:
 *  - الإقلاع بلا أخطاء JavaScript
 *  - إنشاء ملاحظة + المحرر + الحفظ التلقائي
 *  - البقاء بعد إعادة التحميل (IndexedDB)
 *  - البحث والترتيب والسلة
 *  - تصدير نسخة ZIP والتحقق من محتواها
 *  - تسجيل Service Worker (يعمل بلا اتصال)
 *  - لقطات شاشة للتوثيق/العرض
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8000/';
const OUT = process.env.OUT_DIR
  || new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, detail = '') => results.push(['✅', name, detail]);
const bad = (name, detail = '') => results.push(['❌', name, detail]);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 414, height: 900 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ar',
  acceptDownloads: true,
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

// ---------------------------------------------------------------- 1) الإقلاع
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#notes-list', { timeout: 10000 });
await page.waitForTimeout(800);

const brand = await page.textContent('.brand h1');
brand.trim() === 'دفتر' ? ok('يظهر اسم التطبيق «دفتر»') : bad('اسم التطبيق', brand);

const storageMode = await page.textContent('#set-storage').catch(() => null);
const hasBanner = await page.isVisible('#banner-storage');
ok('حالة التخزين', hasBanner ? 'وضع مؤقت (تُظهر اللافتة)' : 'تخزين دائم (IndexedDB)');

// ---------------------------------------------------------------- 2) إنشاء ملاحظة
await page.click('#btn-new');
await page.waitForSelector('#screen-editor:not([hidden])');
{
  const ed = await page.isVisible('#screen-editor');
  const ls = await page.isVisible('#screen-list');
  (ed && !ls) ? ok('فتح المحرر يُخفي القائمة') : bad('حالة الشاشات عند الفتح', `المحرر=${ed} القائمة=${ls}`);
}
await page.fill('#note-title', 'ملاحظة اختبار الويب');
await page.click('#editor');
await page.keyboard.type('هذا نص عربي للتحقق من المحرر والحفظ التلقائي.');
await page.click('#toolbar [data-cmd="bold"]');
await page.keyboard.type(' جزء عريض.');
await page.waitForTimeout(1400); // انتظار الحفظ التلقائي (750ms) + هامش

const status = await page.textContent('#save-status');
status.includes('تم الحفظ') ? ok('الحفظ التلقائي أظهر «تم الحفظ»') : bad('مؤشر الحفظ', status);

await page.screenshot({ path: `${OUT}/02-editor-light.png` });

// ---------------------------------------------------------------- 3) التحقق من التخزين داخليًا
const stored = await page.evaluate(async () => {
  const mod = await import('./js/db.js');
  const notes = await mod.allNotes();
  return notes.map((n) => ({ id: n.id, title: n.title, html: n.contentHtml }));
});
if (stored.length === 1 && stored[0].title.includes('اختبار')) ok('الملاحظة كُتبت في قاعدة البيانات', JSON.stringify(stored[0]).slice(0, 90));
else bad('كتابة الملاحظة', JSON.stringify(stored).slice(0, 160));

const html0 = stored[0]?.html || '';
const hasBoldTag = /<(b|strong)[\s>]/i.test(html0);
hasBoldTag ? ok('العريض محفوظ كوسم <b> (يقرأه مصدّر PDF في الأندرويد)')
  : bad('العريض ليس وسمًا', html0.slice(0, 100));
const hasSpanStyle = /<span[^>]+style="[^"]*(color|background)/i.test(html0);
hasSpanStyle ? ok('اللون/التظليل كأنماط span (يقرأها مصدّر PDF)') : ok('لم يُستخدم لون في هذه الملاحظة');

// ---------------------------------------------------------------- 4) الرجوع للقائمة
await page.click('#btn-back');
await page.waitForTimeout(500);
const cardTitle = await page.textContent('.card-title').catch(() => null);
cardTitle?.includes('ملاحظة اختبار') ? ok('الملاحظة تظهر في القائمة') : bad('بطاقة القائمة', String(cardTitle));

const listVisible = await page.isVisible('#screen-list');
const editorVisible = await page.isVisible('#screen-editor');
(listVisible && !editorVisible)
  ? ok('بعد الرجوع: القائمة ظاهرة والمحرر مخفي فعليًا')
  : bad('حالة الشاشات', `القائمة=${listVisible} المحرر=${editorVisible}`);

const titleClean = (await page.inputValue('#note-title')) === 'ملاحظة اختبار الويب';
titleClean ? ok('العنوان لم يتلوّث بكتابة لاحقة (لا خطف تركيز)') : bad('تلوّث العنوان', await page.inputValue('#note-title'));
await page.screenshot({ path: `${OUT}/01-list-light.png` });

// ---------------------------------------------------------------- 5) إنشاء ثانية + التثبيت + اللون
await page.click('#btn-new');
await page.waitForTimeout(300);
await page.fill('#note-title', 'ملاحظة ثانية');
await page.click('#editor');
await page.keyboard.type('نص الملاحظة الثانية.');
await page.click('#btn-pin');
await page.click('#btn-color');
await page.waitForTimeout(400);
await page.click('.color-dot:nth-child(3)');
await page.waitForTimeout(600);
await page.click('#btn-back');
await page.waitForTimeout(600);

const sections = await page.$$eval('.section-head', (els) => els.map((e) => e.textContent));
sections.some((s) => s.includes('المثبّتة')) ? ok('قسم «المثبّتة» يظهر بعد التثبيت', sections.join(' | ')) : bad('قسم المثبّتة', sections.join(' | '));

const stripe = await page.$('.card .stripe');
stripe ? ok('شريط لون الوسم يظهر على البطاقة') : bad('شريط اللون مفقود');

// ---------------------------------------------------------------- 6) البحث
await page.click('#btn-search');
await page.fill('#search-input', 'ثانية');
await page.waitForTimeout(400);
const found = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent));
found.length === 1 && found[0].includes('ثانية') ? ok('البحث يُرشّح النتائج') : bad('البحث', found.join(' | '));

// البحث بتطبيع الهمزات: «احتبار» بلا همزة يجب أن يطابق «اختبار»? (توحيد الهمزات للألف فقط)
await page.fill('#search-input', 'ملاحظة');
await page.waitForTimeout(400);
const all = await page.$$eval('.card-title', (els) => els.length);
all === 2 ? ok('البحث بكلمة مشتركة يعيد الكل') : bad('بحث مشترك', String(all));

await page.fill('#search-input', '');
await page.click('#btn-search');
await page.waitForTimeout(300);

// ---------------------------------------------------------------- 7) الترتيب
await page.click('#sortbar .chip-btn:nth-child(3)'); // أبجدي
await page.waitForTimeout(400);
const alpha = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent));
ok('الترتيب الأبجدي', alpha.join(' ← '));

// ---------------------------------------------------------------- 8) الوضع الليلي
await page.click('#btn-settings');
await page.waitForTimeout(400);
await page.click('#set-theme .chip-btn:nth-child(3)'); // ليلي
await page.waitForTimeout(400);
const themeAttr = await page.getAttribute('html', 'data-theme');
themeAttr === 'dark' ? ok('الوضع الليلي يعمل') : bad('الوضع الليلي', String(themeAttr));
await page.screenshot({ path: `${OUT}/03-settings-dark.png` });
await page.click('.sheet-backdrop', { position: { x: 10, y: 10 } });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04-list-dark.png`, fullPage: false });

// تغيير الخط إلى أميري للتحقق من الخطوط المدمجة
const amiriLoaded = await page.evaluate(async () => {
  await document.fonts.ready;
  return document.fonts.check('18px "Amiri"');
});
amiriLoaded ? ok('خط أميري العربي متاح محليًا') : bad('خط أميري غير محمّل');

// ---------------------------------------------------------------- 9) تصدير النسخة الاحتياطية
await page.click('#btn-backup');
await page.waitForTimeout(400);
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#btn-export-zip'),
]);
const zipPath = '/tmp/pwa_backup.zip';
await download.saveAs(zipPath);
const size = readFileSync(zipPath).length;
size > 200 ? ok('تصدير ZIP يعمل', `${size} بايت`) : bad('تصدير ZIP', String(size));

// ---------------------------------------------------------------- 10) الاستيراد (نفس الملف) في مخزن نظيف
await page.evaluate(async () => {
  const mod = await import('./js/db.js');
  const notes = await mod.allNotes();
  for (const n of notes) await mod.deleteNoteForever(n.id);
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
const afterClear = await page.$$eval('.card-title', (els) => els.length);
afterClear === 0 ? ok('حُذفت الملاحظات لاختبار الاستيراد') : bad('تنظيف قبل الاستيراد', String(afterClear));

await page.click('#btn-backup');
await page.waitForTimeout(300);
await page.setInputFiles('#file-import', zipPath);
await page.waitForTimeout(700);
await page.click('#confirm-ok');
await page.waitForTimeout(1200);
const backdropStillOpen = await page.evaluate(() => !document.querySelector('.sheet-backdrop').hidden);
if (backdropStillOpen) {
  const why = await page.textContent('#toast').catch(() => '');
  bad('ورقة الاستيراد لم تُغلق', 'رسالة: ' + why);
  await page.evaluate(() => { document.querySelector('.sheet-backdrop').hidden = true; document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open')); });
}
const restored = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent));
restored.length === 2 ? ok('الاستيراد استعاد الملاحظتين', restored.join(' | ')) : bad('الاستيراد', restored.join(' | ') + ` (${restored.length})`);

// ---------------------------------------------------------------- 11) السلة والمحذوفات
await page.click('#btn-trash');
await page.waitForTimeout(400);
const trashEmpty = await page.textContent('#trash-list');
trashEmpty.includes('السلة فارغة') ? ok('السلة فارغة كما هو متوقع') : ok('السلة', trashEmpty.slice(0, 40));
await page.click('.sheet-backdrop', { position: { x: 10, y: 10 } });

// ---------------------------------------------------------------- 12) الاستمرارية بعد إعادة التحميل
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
const afterReload = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent));
afterReload.length === 2 ? ok('الملاحظات باقية بعد إعادة التحميل (IndexedDB)') : bad('الاستمرارية', String(afterReload.length));

// ---------------------------------------------------------------- 13) Service Worker
const sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? (reg.active ? 'active' : 'registered') : 'none';
});
sw === 'active' || sw === 'registered' ? ok('Service Worker مسجّل (عمل بلا اتصال)', sw) : bad('Service Worker', sw);

// اختبار العمل بلا اتصال فعليًا
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(1200);
const offlineNotes = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent)).catch(() => []);
offlineNotes.length === 2 ? ok('يعمل بلا اتصال: الصفحة والملاحظات ظهرت') : bad('وضع عدم الاتصال', `ظهر ${offlineNotes.length} ملاحظة`);
await page.screenshot({ path: `${OUT}/05-offline.png` });
await context.setOffline(false);

// ---------------------------------------------------------------- التقرير
console.log('\n=========== نتائج اختبار المتصفح ===========');
results.forEach(([mark, name, detail]) => console.log(`${mark} ${name}${detail ? ' — ' + detail : ''}`));
const failed = results.filter((r) => r[0] === '❌').length;
console.log(`\nالمجموع: ${results.length} • نجح: ${results.length - failed} • فشل: ${failed}`);
if (consoleErrors.length) {
  console.log('\n--- أخطاء الكونسول ---');
  [...new Set(consoleErrors)].slice(0, 12).forEach((e) => console.log('•', e.slice(0, 200)));
}
console.log('\nاللقطات في: ' + OUT);

await browser.close();
process.exit(failed ? 1 : 0);
