/*
 * اختبار المرحلة الثانية في Chromium: القفل (باترن/رمز/بصمة)، عدّاد الكلمات
 * والأحرف، تكبير أيقونات التحكم، وزر ✕ الذي يلغي كل التأثيرات.
 *
 * التشغيل: BASE_URL=http://localhost:8000/ node e2e2.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8000/';
const OUT = process.env.OUT_DIR
  || new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (n, d = '') => results.push(['✅', n, d]);
const bad = (n, d = '') => results.push(['❌', n, d]);
const check = (cond, n, d = '') => (cond ? ok(n, d) : bad(n, d));

function report() {
  console.log('\n=========== نتائج اختبار المرحلة الثانية ===========');
  results.forEach(([m, n, d]) => console.log(`${m} ${n}${d ? ' — ' + d : ''}`));
  const failed = results.filter((r) => r[0] === '❌').length;
  console.log(`\nالمجموع: ${results.length} • نجح: ${results.length - failed} • فشل: ${failed}`);
  if (consoleErrors.length) {
    console.log('\n--- أخطاء الكونسول ---');
    [...new Set(consoleErrors)].slice(0, 12).forEach((e) => console.log('•', e.slice(0, 220)));
  }
  return failed;
}

process.on('uncaughtException', (e) => {
  bad('استثناء غير متوقع', String(e && e.message).slice(0, 160));
  report();
  process.exit(1);
});

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 414, height: 900 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ar',
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

const PIN = '482913';

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => indexedDB.deleteDatabase('daftar'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#notes-list');
await page.waitForTimeout(500);

/** يقرأ القيم الخام من IndexedDB مباشرة (بلا فك تشفير). */
async function rawNotes() {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('daftar');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('notes', 'readonly');
      const all = tx.objectStore('notes').getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
  }));
}

const wait = (ms) => page.waitForTimeout(ms);

async function settingsOpen() {
  return page.$eval('#sheet-settings', (el) => el.classList.contains('open')).catch(() => false);
}

async function openSettings() {
  if (!(await settingsOpen())) {
    await tap('#btn-settings');
    for (let i = 0; i < 10 && !(await settingsOpen()); i++) await wait(200);
  }
}

/** نقر داخل الأوراق عبر DOM مباشرة (تفاديًا لمشاكل التمرير الداخلي). */
async function tap(sel) {
  await page.$eval(sel, (el) => {
    el.scrollIntoView({ block: 'center' });
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  });
  await wait(350);
}

/** إن ظهرت بوابة تحقق (قبل تغيير القفل) فنفتحها بالسر المعطى. */
async function resolveVerifyGate({ pin = null, pattern = null } = {}) {
  if (await page.isHidden('#gate')) return false;
  if (pin) {
    await page.fill('#gate-pin', pin);
    await tap('#gate-pin-form button[type="submit"]');
    await wait(1200);
  } else if (pattern) {
    await drawPattern('#gate-pattern-host', pattern);
    await wait(1200);
  }
  return true;
}

async function chooseMethod(method) {
  await openSettings();
  for (let i = 0; i < 2; i++) {
    const visible = await page.$eval(`#lock-methods [data-method="${method}"]`,
      (el) => !el.closest('[hidden]') && getComputedStyle(el.closest('#lock-methods')).display !== 'none');
    if (visible) break;
    await tap('#btn-lock-toggle');
  }
  await tap(`#lock-methods [data-method="${method}"]`);
  await wait(300);
  await resolveVerifyGate({ pin: PIN });
}

async function closeSheetsByEsc() {
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sheet-settings[hidden]', { timeout: 4000 }).catch(() => {});
  await wait(300);
}

// ================================================= 1) عدّاد الكلمات والأحرف
await page.click('#btn-new');
await page.waitForSelector('#screen-editor:not([hidden])');
await page.fill('#note-title', 'عدّاد');
await page.click('#editor');
await page.keyboard.type('مرحبا بكم في دفتر');
await wait(400);

{
  const text = (await page.textContent('#editor-counts')).trim();
  check(/^\d+ كلمة • \d+ حرف$/.test(text), 'صيغة العدّاد مطابقة لنسخة أندرويد', text);
  const counts = await page.evaluate(() => ({
    words: document.querySelector('#editor-counts').textContent.match(/(\d+)\s*كلمة/)?.[1],
    chars: document.querySelector('#editor-counts').textContent.match(/(\d+)\s*حرف/)?.[1],
  }));
  check(counts.words === '4', 'عدّاد الكلمات يعدّ ٤ كلمات', text);
  check(String(counts.chars) === String('مرحبا بكم في دفتر'.length),
    'عدّاد الأحرف يطابق طول النص', `${counts.chars} مقابل ${'مرحبا بكم في دفتر'.length}`);
}

// يظهر أسفل الملاحظة فعليًا (تحت المحرر)
{
  const editor = await page.$eval('#editor', (el) => el.getBoundingClientRect().bottom);
  const counter = await page.$eval('#editor-counts', (el) => el.getBoundingClientRect().top);
  check(counter >= editor - 40, 'العدّاد أسفل الملاحظة', `المحرر ينتهي ${Math.round(editor)} والعدّاد ${Math.round(counter)}`);
}

// نموّ العدّاد مع الكتابة
await page.keyboard.type(' زائد');
await wait(400);
{
  const words = await page.$eval('#editor-counts', (el) => el.textContent.match(/(\d+)\s*كلمة/)?.[1]);
  check(words === '5', 'العدّاد يتحدّث مع الكتابة', `كلمات=${words}`);
}

// ================================================= 2) حجم أيقونات التحكم
{
  const bold = await page.$eval('#toolbar [data-cmd="bold"]', (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check(bold.w >= 40 && bold.h >= 40, 'أزرار التنسيق كبيرة (٤٠px+)', `${Math.round(bold.w)}×${Math.round(bold.h)}`);
  const back = await page.$eval('.editor-bar #btn-back', (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check(back.w >= 42 && back.h >= 42, 'أزرار شريط المحرر كبيرة (٤٢px+)', `${Math.round(back.w)}×${Math.round(back.h)}`);
}

// ================================================= 3) زر ✕ يلغي كل التأثيرات
await page.click('#editor');
await page.keyboard.press('End');
await page.click('#toolbar [data-cmd="bold"]');
await page.keyboard.type(' عريض');
await wait(300);
const boldTyped = await page.$eval('#editor', (el) => /<(b|strong)>[^<]*عريض/.test(el.innerHTML));
check(boldTyped, 'العريض يعمل قبل الإلغاء (تحقق من صحّة الاختبار)');

await page.click('#toolbar [data-cmd="removeFormat"]');
await wait(250);
await page.keyboard.type(' نظيف');
await wait(400);
{
  const html = await page.$eval('#editor', (el) => el.innerHTML);
  const cleanInsideBold = /<(b|strong)>[^<]*نظيف/.test(html);
  check(!cleanInsideBold, '✕ يلغي التأثيرات على النص الذي سيُكتب', html.slice(-120));

  // ومع نص محدّد: يُزال التنسيق عن التحديد
  await page.keyboard.press('Control+A');
  await page.click('#toolbar [data-cmd="removeFormat"]');
  await wait(300);
  const after = await page.$eval('#editor', (el) => el.innerHTML);
  check(!/<(b|strong|i|u|s)>/i.test(after) && !/style="(font-weight|color|background)/i.test(after),
    '✕ على تحديد كامل يزيل كل الوسوم', after.slice(0, 140));
}
await page.screenshot({ path: `${OUT}/06-editor-counter.png` });

// رجوع للقائمة
await page.click('#btn-back');
await page.waitForSelector('#screen-list:not([hidden])', { timeout: 5000 }).catch(() => {});
await wait(500);

// ================================================= 4) قفل التطبيق — رمز سري
await openSettings();
await chooseMethod('pin');
await page.waitForSelector('#dialog-prompt.open');
await page.fill('#prompt-input', PIN);
await tap('#prompt-ok');
await page.waitForTimeout(300);
await page.fill('#prompt-input', PIN);
await tap('#prompt-ok');
await page.waitForTimeout(1200);

{
  const status = (await page.textContent('#lock-status')).trim();
  check(/مفعّل/.test(status) && /مشفّرة/.test(status), 'تفعيل القفل بالرمز يشفّر البيانات', status);
check(await settingsOpen(), 'ورقة الإعدادات تبقى مفتوحة بعد التفعيل');
}
await page.$eval('#lock-status', (el) => el.scrollIntoView({ block: 'center' }));
await wait(600);
await page.screenshot({ path: `${OUT}/08-lock-settings.png` });

{
  const raw = await rawNotes();
  const encrypted = raw.filter((n) => String(n.title || '').startsWith('enc:v1:')).length;
  check(encrypted === raw.length && raw.length > 0,
    'القيم الخام في IndexedDB مشفّرة (enc:v1:)', `${encrypted}/${raw.length}`);
  check(!raw.some((n) => String(n.contentHtml || '').includes('مرحبا')), 'لا يظهر نص الملاحظة في المخزن الخام');
}

// إغلاق الإعدادات + القفل الآن
await closeSheetsByEsc();
await openSettings();
await tap('#btn-lock-now');
await page.waitForSelector('#gate:not([hidden])', { timeout: 5000 });
{
  const gateVisible = await page.isVisible('#gate');
  const listVisible = await page.isVisible('#screen-list');
  check(gateVisible && !listVisible, '«اقفل الآن» يعرض بوابة القفل ويخفي المحتوى');
}
await page.screenshot({ path: `${OUT}/07-lock-gate.png` });

// رمز خاطئ ثم صحيح
await page.fill('#gate-pin', '000000');
await tap('#gate-pin-form button[type="submit"]');
await wait(900);
check(/غير صحيح|المحاولات/.test(await page.textContent('#gate-error')), 'الرمز الخاطئ يُرفض', await page.textContent('#gate-error'));

await page.fill('#gate-pin', PIN);
await tap('#gate-pin-form button[type="submit"]');
await wait(900);
check(await page.isHidden('#gate'), 'الرمز الصحيح يفتح التطبيق');
check((await page.$$('.card')).length >= 1, 'الملاحظات تظهر بعد الفتح');

// إعادة تحميل والتطبيق مقفل: البوابة أولًا ولا يظهر أي محتوى قبل الفتح
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(1500);
check(await page.isVisible('#gate'), 'بعد إعادة التحميل يظهر القفل قبل أي شيء');
{
  const leaked = await page.evaluate(() => ({
    cards: document.querySelectorAll('.card-title').length,
    texts: [...document.querySelectorAll('.card-title')].map((e) => e.textContent).join('|'),
    list: document.querySelector('#notes-list').textContent.trim().length,
  }));
  check(leaked.cards === 0 && leaked.list === 0, 'لا يظهر أي عنوان في القائمة قبل الفتح',
    `${leaked.cards} بطاقة / ${leaked.texts}`);
}
await page.fill('#gate-pin', PIN);
await tap('#gate-pin-form button[type="submit"]');
await wait(1200);
check(await page.isHidden('#gate') && (await page.$$('.card')).length >= 1,
  'الفتح بعد إعادة التحميل يعرض الملاحظات');

// ================================================= 5) القفل التلقائي عند العودة
await openSettings();
await tap('#lock-relock .chip-btn'); // الأول = «فوري»
await wait(400);
await closeSheetsByEsc();
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await wait(800);
check(await page.isVisible('#gate'), 'القفل التلقائي يعمل عند العودة للتطبيق (مهلة فورية)');
await page.fill('#gate-pin', PIN);
await tap('#gate-pin-form button[type="submit"]');
await wait(900);
check(await page.isHidden('#gate'), 'يفتح مجددًا بالرمز بعد القفل التلقائي');

// ================================================= 6) قفل بالباترن
await chooseMethod('pattern');
await page.waitForSelector('#setup-pattern-host .pattern-dot', { timeout: 6000 });
await wait(400);
check((await page.$$('#setup-pattern-host .pattern-dot')).length === 9, 'لوحة الباترن فيها ٩ نقاط');

/** يرسم باترن على اللوحة المعطاة عبر مؤشر حقيقي. */
async function drawPattern(hostSel, indices) {
  const boxes = await page.$$eval(`${hostSel} .pattern-dot`, (els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }));
  const first = boxes[indices[0]];
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const i of indices.slice(1)) {
    const p = boxes[i];
    // نمرّ بنقاط وسيطة ليكون التتبع طبيعيًا
    await page.mouse.move((p.x + first.x) / 2, (p.y + first.y) / 2, { steps: 4 });
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await wait(60);
  }
  await page.mouse.up();
  await wait(450);
}

const PATTERN = [0, 1, 2, 5, 8];
await drawPattern('#setup-pattern-host', PATTERN);
await wait(300);
check(/تأكيد|أعد/.test(await page.textContent('#setup-title')), 'يطلب إعادة رسم الباترن للتأكيد', await page.textContent('#setup-title'));
await drawPattern('#setup-pattern-host', PATTERN);
await wait(1200);
{
  const status = (await page.textContent('#lock-status')).trim();
  check(/باترن/.test(status), 'تفعيل القفل بالباترن', status);
}

// اقفل وافتح بالباترن
await closeSheetsByEsc();
await openSettings();
await tap('#btn-lock-now');
await page.waitForSelector('#gate:not([hidden])', { timeout: 5000 });
await wait(400);
check(await page.isVisible('#gate-pattern-host'), 'بوابة الباترن تظهر لوحة النقاط');
await wait(400);
await page.screenshot({ path: `${OUT}/09-lock-pattern.png` });

await drawPattern('#gate-pattern-host', [0, 3, 6, 7, 8]);
await wait(600);
check(!(await page.isHidden('#gate')) ? /غير صحيح/.test(await page.textContent('#gate-error')) : true, 'باترن خاطئ يُرفض');

await drawPattern('#gate-pattern-host', PATTERN);
await wait(1000);
check(await page.isHidden('#gate'), 'الباترن الصحيح يفتح التطبيق');

// ================================================= 7) إطفاء القفل يعيد النص صريحًا
await openSettings();
await tap('#btn-lock-off');
await wait(700);
check(await page.isVisible('#gate'), 'إطفاء القفل يطلب تحققًا دائمًا');
if (await page.isVisible('#gate')) {
  const gateMethod = await page.$eval('#gate', (el) => (el.querySelector('#gate-pattern-host').hidden ? 'pin' : 'pattern'));
  if (gateMethod === 'pattern') await drawPattern('#gate-pattern-host', PATTERN);
  else { await page.fill('#gate-pin', PIN); await tap('#gate-pin-form button[type="submit"]'); }
  await wait(1200);
}
await page.waitForSelector('#dialog-confirm.open', { timeout: 8000 });
await tap('#confirm-ok');
await wait(1400);
{
  const status = (await page.textContent('#lock-status')).trim();
  check(/غير مفعّل/.test(status), 'إطفاء القفل', status);
  const raw = await rawNotes();
  const stillEncrypted = raw.filter((n) => String(n.title || '').startsWith('enc:v1:')).length;
  check(stillEncrypted === 0, 'إطفاء القفل يفكّ التشفير ويعيد النص صريحًا', `${stillEncrypted} مشفّرة`);
  check(raw.some((n) => String(n.contentHtml || '').includes('مرحبا')), 'النص الأصلي سليم بعد إلغاء التشفير');
}
await closeSheetsByEsc();
check((await page.$$('.card')).length >= 1, 'الملاحظات سليمة بعد إطفاء القفل');

// ---------------------------------------------------------------- التقرير
const failed = report();
await browser.close();
process.exit(failed ? 1 : 0);
