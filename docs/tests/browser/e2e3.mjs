/*
 * اختبار المرحلة الثالثة (Chromium): التمرير في الملاحظات الطويلة،
 * واستيراد Google Keep كاملًا من الواجهة (ملف Takeout.zip حقيقي).
 *
 * التشغيل: BASE_URL=http://localhost:8000/ node e2e3.mjs
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip } from '../../js/backup.js';

const BASE = process.env.BASE_URL || 'http://localhost:8000/';
const OUT = process.env.OUT_DIR || new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (n, d = '') => results.push(['✅', n, d]);
const bad = (n, d = '') => results.push(['❌', n, d]);
const check = (c, n, d = '') => (c ? ok(n, d) : bad(n, d));

function report() {
  console.log('\n=========== نتائج اختبار المرحلة الثالثة ===========');
  results.forEach(([m, n, d]) => console.log(`${m} ${n}${d ? ' — ' + d : ''}`));
  const failed = results.filter((r) => r[0] === '❌').length;
  console.log(`\nالمجموع: ${results.length} • نجح: ${results.length - failed} • فشل: ${failed}`);
  if (consoleErrors.length) {
    console.log('\n--- أخطاء الكونسول ---');
    [...new Set(consoleErrors)].slice(0, 10).forEach((e) => console.log('•', e.slice(0, 200)));
  }
  return failed;
}

const consoleErrors = [];
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 414, height: 900 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ar',
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

process.on('uncaughtException', (e) => {
  bad('استثناء غير متوقع', String(e?.message).slice(0, 160));
  report();
  process.exit(1);
});

const wait = (ms) => page.waitForTimeout(ms);
const tap = async (sel) => {
  await page.$eval(sel, (el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
  await wait(350);
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => indexedDB.deleteDatabase('daftar'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#notes-list');
await wait(600);

// ================================================= 1) التمرير في ملاحظة طويلة
await page.click('#btn-new');
await wait(600);
await page.fill('#note-title', 'ملاحظة طويلة');
await page.click('#editor');
await page.keyboard.type(('سطر لاختبار التمرير في الملاحظات الطويلة. ').repeat(80));
await wait(1000);

{
  const m = await page.evaluate(() => {
    const se = document.scrollingElement;
    return {
      scrollable: se.scrollHeight > innerHeight + 50,
      bodyOverflow: getComputedStyle(document.body).overflow,
      appbarH: Math.round(document.querySelector('.editor-bar').getBoundingClientRect().height),
      toolbarTop: Math.round(document.querySelector('#toolbar').getBoundingClientRect().top),
    };
  });
  check(m.scrollable && m.bodyOverflow !== 'hidden', 'الصفحة قابلة للتمرير في الملاحظة الطويلة', `overflow=${m.bodyOverflow}`);
  check(m.appbarH * 0.9 < m.toolbarTop + 1, 'شريط الأدوات ملتصق أسفل الشريط العلوي تمامًا',
    `appbar=${m.appbarH} toolbar=${m.toolbarTop}`);
}

await page.mouse.wheel(0, 5000);
await wait(700);
{
  const m = await page.evaluate(() => {
    const se = document.scrollingElement;
    const caret = document.querySelector('#editor').getBoundingClientRect();
    const foot = document.querySelector('.editor-foot').getBoundingClientRect();
    return {
      y: Math.round(se.scrollTop),
      max: Math.round(se.scrollHeight - innerHeight),
      footTop: Math.round(foot.top),
      editorBottom: Math.round(caret.bottom),
    };
  });
  check(m.y > 200, 'التمرير بالعجلة يعمل', `scrollTop=${m.y}/${m.max}`);
  check(Math.abs(m.y - m.max) < 5, 'يمكن الوصول إلى نهاية الملاحظة الطويلة', `${m.y} من ${m.max}`);
}
{
  const counts = await page.textContent('#editor-counts');
  check(/\d+ كلمة • \d+ حرف/.test(counts.trim()), 'العدّاد يعمل في الملاحظة الطويلة', counts.trim());
  // شريط العدّاد لا يحجب اللمس
  const blocked = await page.evaluate(() => {
    const foot = document.querySelector('.editor-foot');
    return getComputedStyle(foot).pointerEvents;
  });
  check(blocked === 'none', 'شريط العدّاد لا يحجب اللمس عن النص', blocked);
}
await page.screenshot({ path: `${OUT}/11-long-note-bottom.png` });
await tap('#btn-back');
await wait(600);

// ================================================= 2) استيراد Google Keep
const USEC = 1_000_000;
const keepJson = (patch) => JSON.stringify({
  color: 'DEFAULT', isTrashed: false, isPinned: false, isArchived: false,
  textContent: '', title: '', labels: [], attachments: [], listContent: [],
  createdTimestampUsec: 1_699_000_000 * USEC, userEditedTimestampUsec: 1_700_000_000 * USEC,
  ...patch,
});
const enc = (s) => new TextEncoder().encode(s);

const takeout = buildZip([
  {
    name: 'Takeout/Keep/قائمة تسوق.json',
    data: enc(keepJson({
      title: 'قائمة تسوّق', color: 'GREEN', isPinned: true,
      textContent: 'الخضروات والفواكه',
      listContent: [{ text: 'خبز', isChecked: false }, { text: 'حليب', isChecked: true }, { text: 'تمر', isChecked: false }],
      labels: [{ name: 'بيت' }],
    })),
  },
  {
    name: 'Takeout/Keep/قائمة تسوق.html',
    data: enc('<html lang="ar"><body>نسخة HTML نتجاهلها</body></html>'),
  },
  { name: 'Takeout/Keep/قائمة تسوق.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]) },
  {
    name: 'Takeout/Keep/فكرة.json',
    data: enc(keepJson({ title: 'فكرة مشروع', textContent: 'سطر أول\nسطر ثانٍ\nسطر ثالث', color: 'BLUE' })),
  },
  {
    name: 'Takeout/Keep/قديمة.json',
    data: enc(keepJson({ title: 'ملاحظة محذوفة', textContent: 'كانت في السلة', isTrashed: true })),
  },
  { name: 'Takeout/Keep/keep_list.json', data: enc('ليس JSON صحيحًا') },
]);

const zipPath = join(tmpdir(), 'takeout-keep-test.zip');
writeFileSync(zipPath, Buffer.from(await takeout.arrayBuffer()));

await tap('#btn-settings');
await tap('#btn-backup');
await page.waitForSelector('#sheet-backup.open', { timeout: 5000 }).catch(() => {});
await page.setInputFiles('#file-keep', zipPath);
await page.waitForSelector('#dialog-confirm.open', { timeout: 8000 });

{
  const title = await page.textContent('#confirm-title');
  const body = await page.textContent('#confirm-body');
  check(/Google Keep/.test(title), 'يظهر تأكيد الاستيراد من Keep', title.trim());
  check(/3 ملاحظة/.test(body), 'التأكيد يذكر عدد الملاحظات', body.trim().slice(0, 90));
  check(/سلة دفتر/.test(body), 'التأكيد ينبّه إلى الملاحظات المحذوفة في Keep');
}
await page.screenshot({ path: `${OUT}/12-keep-import-confirm.png` });

await tap('#confirm-ok');
await page.waitForTimeout(3000);
{
  const toastText = await page.textContent('#toast');
  check(/استيراد 3 ملاحظة/.test(toastText), 'تقرير الاستيراد يظهر للمستخدم', toastText.trim());
  check(/السلة/.test(toastText), 'التقرير يذكر ما دخل السلة');
}

// الملاحظات المستوردة في القائمة
await page.keyboard.press('Escape');
await wait(900);
{
  const titles = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent.trim()));
  check(titles.includes('قائمة تسوّق'), 'المذكرة المستوردة تظهر في القائمة', titles.join(' | '));
  check(titles.includes('فكرة مشروع'), 'الملاحظة النصية مستوردة');
  check(!titles.includes('ملاحظة محذوفة'), 'المحذوف في Keep لا يظهر في القائمة');

  const pinnedSection = await page.$$eval('.section-head', (els) => els.map((e) => e.textContent));
  check(pinnedSection.some((t) => /المثبّتة/.test(t)), 'الملاحظة المثبّتة في Keep وصلت مثبّتة', pinnedSection.join(' | '));
}

// محتوى الملاحظات: النص والقائمة واللون
{
  const data = await page.evaluate(async () => {
    const notes = await new Promise((resolve) => {
      const req = indexedDB.open('daftar');
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction('notes', 'readonly').objectStore('notes').getAll();
        all.onsuccess = () => resolve(all.result);
        all.onerror = () => resolve([]);
      };
    });
    const list = notes.find((n) => n.title === 'قائمة تسوّق') || {};
    const idea = notes.find((n) => n.title === 'فكرة مشروع') || {};
    const trashed = notes.find((n) => n.title === 'ملاحظة محذوفة') || {};
    return {
      listHtml: list.contentHtml || '', listColor: list.colorLabel || null, listPinned: !!list.isPinned,
      ideaHtml: idea.contentHtml || '', ideaCreated: idea.createdAt || 0,
      trashedDeleted: !!trashed.isDeleted,
    };
  });
  check(/<li>☐ خبز<\/li>/.test(data.listHtml) && /<li>☑ حليب<\/li>/.test(data.listHtml),
    'قائمة المهام نُقلت بمربّعات الحالة', data.listHtml.slice(0, 90));
  check(/<p>الخضروات والفواكه<\/p>/.test(data.listHtml), 'نص الملاحظة قبل القائمة محفوظ');
  check(data.listColor === '#A5D6A7', 'لون Keep الأخصر انتقل إلى لون دفتر', String(data.listColor));
  check(data.listPinned === true, 'التثبيت انتقل');
  check((data.ideaHtml.match(/<p>/g) || []).length === 3, 'كل سطر صار فقرة', data.ideaHtml.slice(0, 90));
  check(data.ideaCreated === 1_699_000_000 * 1000, 'التاريخ انتقل من مايكرو ثانية', String(data.ideaCreated));
  check(data.trashedDeleted === true, 'المحذوف في Keep دخل سلة دفتر');
}

// السلة تعرضه فعلًا
await tap('#btn-trash');
await wait(800);
{
  const items = await page.$$eval('#trash-list .trash-info strong', (els) => els.map((e) => e.textContent.trim()));
  check(items.some((t) => /ملاحظة محذوفة/.test(t)), 'الملاحظة المحذوفة ظاهرة في شاشة السلة', items.join(' | '));
}
await page.keyboard.press('Escape');
await wait(600);

// ملف ليس من Keep ⇒ رسالة واضحة بلا تعديل على البيانات
const beforeCount = await page.$$eval('.card', (els) => els.length);
const daftarBackup = buildZip([{ name: 'daftar.json', data: enc('{"version":3,"notes":[]}') }]);
const wrongPath = join(tmpdir(), 'wrong-file.zip');
writeFileSync(wrongPath, Buffer.from(await daftarBackup.arrayBuffer()));
await tap('#btn-settings');
await tap('#btn-backup');
await page.setInputFiles('#file-keep', wrongPath);
await page.waitForSelector('#dialog-confirm.open', { timeout: 8000 });
{
  const title = await page.textContent('#confirm-title');
  const body = await page.textContent('#confirm-body');
  check(/لم أجد ملاحظات Keep/.test(title), 'ملف غير تابع لـKeep يُرفض بلطف');
  check(/Keep/.test(body), 'الرسالة تشرح المطلوب', body.trim().slice(0, 80));
}
await tap('#confirm-ok');
await wait(700);
{
  const after = await page.$$eval('.card', (els) => els.length);
  check(after === beforeCount, 'لا تتغيّر الملاحظات عند ملف غير صالح', `${beforeCount} → ${after}`);
}

// نسخة احتياطية متوافقة بعد الاستيراد: التصدير يعمل
await tap('#btn-settings');
await tap('#btn-backup');
const download = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  tap('#btn-export-zip'),
]).then(([d]) => d).catch(() => null);
check(!!download, 'تصدير ZIP يعمل بعد الاستيراد من Keep', download ? download.suggestedFilename() : 'لا تنزيل');

const failed = report();
await browser.close();
process.exit(failed ? 1 : 0);
