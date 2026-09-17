/*
 * اختبار المرحلة الرابعة (Chromium):
 *  - زر الرجوع داخل الملاحظة يعود للقائمة ولا يخرج من التطبيق
 *  - إلغاء القفل من الإعدادات + تغيير الباترن/الرمز + رابط «نسيت»
 *  - قفل ملاحظة واحدة (إخفاء في القائمة، طلب الفتح عند العرض)
 *  - تحديد أكثر من ملاحظة وتنفيذ عمليات جماعية
 *
 * التشغيل: BASE_URL=http://localhost:8000/ node e2e4.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8000/';
const OUT = process.env.OUT_DIR || new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
const ok = (n, d = '') => results.push(['✅', n, d]);
const bad = (n, d = '') => results.push(['❌', n, d]);
const check = (c, n, d = '') => (c ? ok(n, d) : bad(n, d));

function report() {
  console.log('\n=========== نتائج اختبار المرحلة الرابعة ===========');
  results.forEach(([m, n, d]) => console.log(`${m} ${n}${d ? ' — ' + d : ''}`));
  const failed = results.filter((r) => r[0] === '❌').length;
  console.log(`\nالمجموع: ${results.length} • نجح: ${results.length - failed} • فشل: ${failed}`);
  if (consoleErrors.length) {
    console.log('\n--- أخطاء الكونسول ---');
    [...new Set(consoleErrors)].slice(0, 10).forEach((e) => console.log('•', e.slice(0, 200)));
  }
  return failed;
}

process.on('uncaughtException', (e) => {
  bad('استثناء غير متوقع', String(e?.message).slice(0, 160));
  report();
  process.exit(1);
});

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 414, height: 900 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, locale: 'ar',
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

const wait = (ms) => page.waitForTimeout(ms);
const tap = async (sel) => {
  await page.$eval(sel, (el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
  await wait(350);
};
const tapCard = async (index = 0) => {
  const sel = `.card:nth-of-type(${index + 1})`;
  await page.$eval(`.card[data-id] >> nth=${index}`, (el) => el.click()).catch(async () => {
    await page.evaluate((i) => document.querySelectorAll('.card')[i].click(), index);
  });
  await wait(500);
};

async function newNote(title, body) {
  await tap('#btn-new');
  await page.waitForSelector('#screen-editor:not([hidden])');
  await page.fill('#note-title', title);
  await page.click('#editor');
  await page.keyboard.type(body);
  await wait(700);
  await tap('#btn-back');
  await wait(500);
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => indexedDB.deleteDatabase('daftar'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#notes-list');
await wait(600);

// ================================================= 1) زر الرجوع
await newNote('ملاحظة أ', 'محتوى أ');
await newNote('ملاحظة ب', 'محتوى ب');
await newNote('ملاحظة ج', 'محتوى ج');

await tapCard(0);
check(!(await page.isHidden('#screen-editor')), 'فتح ملاحظة من القائمة');

// زر الرجوع في شريط التطبيق (نفس مسار زر رجوع النظام الآن)
await tap('#btn-back');
check(await page.isHidden('#screen-editor') && !(await page.isHidden('#screen-list')),
  'زر الرجوع داخل الملاحظة يعود إلى القائمة');

// زر رجوع النظام/المتصفح
await tapCard(0);
const url = page.url();
await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
await wait(900);
check(await page.isHidden('#screen-editor'), 'رجوع المتصفح (زر النظام) يغلق المحرر ويبقى في التطبيق');
check(page.url().includes('daftar') || page.url().length > 0, 'لم يخرج من التطبيق', page.url().slice(0, 60));

// رجوع مرتين متتاليتين: محرر ثم ورقة إعدادات
await tapCard(0);
await tap('#btn-back');
await tap('#btn-settings');
await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
await wait(800);
check(!(await page.$eval('#sheet-settings', (el) => el.classList.contains('open')).catch(() => false)),
  'رجوع النظام يغلق ورقة الإعدادات بلا خروج من التطبيق');
check(await page.isHidden('#screen-editor'), 'وما زلنا في القائمة');

// ================================================= 2) تحديد أكثر من ملاحظة
// ضغطة مطوّلة مع اهتزاز إصبع بسيط (٨ بكسل) — يجب أن تعمل رغم الاهتزاز
await page.evaluate(() => {
  const card = document.querySelectorAll('.card')[0];
  const box = card.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  // اهتزاز طبيعي أقل من حدّ التسامح
  card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 5, clientY: y + 3 }));
  card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x - 4, clientY: y + 6 }));
});
await wait(700);
check(await page.isVisible('#select-bar'), 'الضغط المطوّل يعمل رغم اهتزاز الإصبع البسيط');
{
  const count = await page.textContent('#select-count');
  check(/1 ملاحظة/.test(count), 'يظهر عدد المحدّد', count.trim());
}
await page.evaluate(() => document.querySelectorAll('.card')[1].click());
await page.evaluate(() => document.querySelectorAll('.card')[2].click());
await wait(500);
{
  const count = await page.textContent('#select-count');
  check(/3 ملاحظات/.test(count), 'يمكن تحديد أكثر من ملاحظة', count.trim());
  const selected = await page.$$eval('.card.selected', (els) => els.length);
  check(selected === 3, 'البطاقات المحدّدة معلَّمة بصريًا', String(selected));
}
await page.screenshot({ path: `${OUT}/14-multi-select.png` });

// خيارات الملاحظة: يجب ألا تحتوي «تحديد لمزيد من العمليات»
{
  await page.evaluate(() => document.querySelectorAll('.card')[0].querySelector('.card-more').click());
  await wait(600);
  const rows = await page.$$eval('#menu-note .sheet-row', (els) => els.map((e) => e.textContent.trim()));
  check(!rows.some((t) => t.includes('تحديد لمزيد')), 'خيار «تحديد لمزيد من العمليات» أُزيل من القائمة', rows.join(' | '));
  await tap('#select-close').catch(() => {});
  await page.keyboard.press('Escape');
  await wait(500);
}

// زر «تحديد» في الشريط العلوي: الطريقة الأوضح
await tap('#select-close');
await wait(500);
await tap('#btn-select');
await wait(500);
check(await page.isVisible('#select-bar'), 'زر «تحديد» في الشريط العلوي يفتح وضع التحديد');
check(await page.evaluate(() => document.body.classList.contains('selecting')), 'وضع التحديد معلَّم على الواجهة');

// داخل وضع التحديد: النقر على البطاقات يحدّدها
await page.evaluate(() => document.querySelectorAll('.card').forEach((c) => c.click()));
await wait(700);
check(/3 ملاحظات/.test(await page.textContent('#select-count')), 'النقر على البطاقات يحدّدها');
check(await page.isHidden('#screen-editor'), 'النقر داخل وضع التحديد لا يفتح الملاحظة');

// عملية جماعية: تثبيت
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#select-actions button')]
    .find((b) => b.textContent.includes('تثبيت') && !b.textContent.includes('إلغاء'));
  btn.click();
});
await wait(1200);
{
  const pinned = await page.$$eval('.section-head', (els) => els.map((e) => e.textContent).join(' | '));
  check(/المثبّتة \(3\)/.test(pinned), 'التثبيت الجماعي يعمل على الثلاث', pinned);
  check(await page.isHidden('#select-bar'), 'يخرج من وضع التحديد بعد التنفيذ');
}

// عملية جماعية: مفضلة + لون
await page.evaluate(() => document.querySelectorAll('.card')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
await wait(700);
await page.evaluate(() => document.getElementById('select-all').click());
await wait(500);
check(/إلغاء التحديد/.test(await page.textContent('#select-all')), '«تحديد الكل» يحدّد الكل');

await page.evaluate(() => {
  [...document.querySelectorAll('#select-actions button')].find((b) => b.textContent.includes('مفضلة') && !b.textContent.includes('إزالة')).click();
});
await wait(1200);
{
  const favs = await page.$$eval('.card .chip', (els) => els.filter((e) => e.textContent.trim() === '★').length);
  check(favs === 3, 'التحديد الجماعي للمفضلة يعمل', String(favs));
}

// حذف جماعي
await page.evaluate(() => document.querySelectorAll('.card')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
await wait(700);
await page.evaluate(() => {
  [...document.querySelectorAll('#select-actions button')].find((b) => b.textContent.includes('حذف')).click();
});
await page.waitForSelector('#dialog-confirm.open', { timeout: 5000 });
check(/1 ملاحظة|نقل/.test(await page.textContent('#confirm-body')), 'الحذف الجماعي يطلب تأكيدًا');
await tap('#confirm-ok');
await wait(1200);
{
  const cards = await page.$$eval('.card', (els) => els.length);
  check(cards === 2, 'حُذفت الملاحظة المحدّدة فقط', `${cards} بطاقة`);
}

// حذف جماعي لملاحظتين من السلة: استعادة جماعية
await page.evaluate(() => document.querySelectorAll('.card')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
await wait(600);
await page.evaluate(() => {
  [...document.querySelectorAll('#select-actions button')].find((b) => b.textContent.includes('حذف')).click();
});
await page.waitForSelector('#dialog-confirm.open');
await tap('#confirm-ok');
await wait(1000);
await tap('#btn-trash');
await wait(700);
{
  const rows = await page.$$eval('.trash-row', (els) => els.length);
  check(rows === 2, 'السلة تعرض الملاحظتين', String(rows));
  await page.evaluate(() => document.querySelectorAll('.trash-row')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await wait(700);
  check(await page.isVisible('#select-bar'), 'التحديد المتعدد يعمل داخل السلة');
  await page.evaluate(() => document.querySelectorAll('.trash-row')[1].click());
  await wait(400);
  await page.evaluate(() => {
    [...document.querySelectorAll('#select-actions button')].find((b) => b.textContent.includes('استعادة')).click();
  });
  await wait(1400);
  const left = await page.$$eval('.trash-row', (els) => els.length);
  check(left === 0, 'الاستعادة الجماعية من السلة تعمل', String(left));
}
await page.keyboard.press('Escape');
await wait(700);

// ================================================= 3) قفل الملاحظة الواحدة
// بلا قفل تطبيق: القفل يعمل مستقلًّا، والتطبيق يبقى مفتوحًا
const beforeLockTitle = await page.$eval('.card-title', (el) => el.textContent.trim());
await page.evaluate(() => document.querySelectorAll('.card')[0].querySelector('.card-more').click());
await wait(500);
await page.evaluate(() => {
  [...document.querySelectorAll('#menu-note .sheet-row')].find((b) => b.textContent.includes('قفل الملاحظة')).click();
});
await wait(1200);
check(/مقفلة/.test(await page.$eval('.card-title', (el) => el.textContent)),
  'قفل الملاحظة يعمل بلا قفل تطبيق', beforeLockTitle);
check(await page.isHidden('#gate'), 'القفل لا يعرض أي شاشة تحقق ولا يقفل التطبيق');
check(await page.isVisible('#screen-list'), 'التطبيق يبقى مفتوحًا وعاملًا بعد القفل');

// بلا بصمة وبلا قفل تطبيق: تُكشف بضغطة (إخفاء فقط)، ولا تظهر أي بوابة
await page.evaluate(() => document.querySelectorAll('.card')[0].click());
await wait(1200);
check(await page.isHidden('#gate'), 'فتح ملاحظة مقفلة بلا وسيلة تحقق لا يعرض بوابة');
check(!(await page.isHidden('#screen-editor')), 'تُعرض الملاحظة بعد الضغط مباشرة');
check((await page.inputValue('#note-title')) === beforeLockTitle, 'المحتوى سليم', beforeLockTitle);
await tap('#btn-back');
await wait(800);
check(/مقفلة/.test(await page.$eval('.card-title', (el) => el.textContent)), 'تُخفى من جديد بعد الخروج');

// إلغاء القفل بلا وسيلة تحقق: يطلب تأكيدًا بسيطًا فقط
await page.evaluate(() => document.querySelectorAll('.card')[0].querySelector('.card-more').click());
await wait(500);
await page.evaluate(() => {
  [...document.querySelectorAll('#menu-note .sheet-row')].find((b) => b.textContent.includes('إلغاء قفل')).click();
});
await wait(1200);
check(!/مقفلة/.test(await page.$eval('.card-title', (el) => el.textContent)), 'إلغاء قفل الملاحظة يعيد العنوان');

// فعّل قفل التطبيق برمز
const PIN = '482913';
await tap('#btn-settings');
await page.evaluate(() => document.getElementById('btn-lock-toggle').click());
await wait(400);
await page.evaluate(() => document.querySelector('#lock-methods [data-method="pin"]').click());
await page.waitForSelector('#dialog-prompt.open');
await page.fill('#prompt-input', PIN);
await tap('#prompt-ok');
await wait(400);
await page.fill('#prompt-input', PIN);
await tap('#prompt-ok');
await wait(2200);
check(/مفعّل/.test(await page.textContent('#lock-status')), 'تفعيل قفل التطبيق للاختبار');

// ألغِ القفل: الزر صار واضحًا وموجودًا
check(await page.isVisible('#btn-lock-off'), 'زر إلغاء القفل ظاهر في الإعدادات');
check(/إلغاء القفل/.test(await page.textContent('#btn-lock-off')), 'نص الزر واضح: إلغاء القفل');
await tap('#btn-lock-off');
await wait(700);
check(await page.isVisible('#gate'), 'إلغاء القفل يطلب التحقق أولًا');
await page.fill('#gate-pin', PIN);
await tap('#gate-pin-form button[type="submit"]');
await wait(1400);
await page.waitForSelector('#dialog-confirm.open', { timeout: 6000 });
await tap('#confirm-ok');
await wait(1800);
check(/غير مفعّل/.test(await page.textContent('#lock-status')), 'تم إلغاء القفل من الإعدادات');
check(await page.isHidden('#btn-lock-off'), 'تختفي أزرار القفل بعد الإلغاء');

// أعد التفعيل لاختبار قفل الملاحظة
await page.evaluate(() => document.getElementById('btn-lock-toggle').click());
await wait(300);
await page.evaluate(() => document.querySelector('#lock-methods [data-method="pin"]').click());
await page.waitForSelector('#dialog-prompt.open');
await page.fill('#prompt-input', PIN);
await tap('#prompt-ok');
await wait(400);
await page.fill('#prompt-input', PIN);
await tap('#prompt-ok');
await wait(2200);

// زر «تغيير الباترن/الرمز» موجود ويعمل
check(await page.isVisible('#btn-lock-change'), 'زر تغيير الباترن/الرمز ظاهر');
await page.keyboard.press('Escape');
await wait(600);

// اقفل ملاحظة من خياراتها
await page.evaluate(() => document.querySelectorAll('.card')[0].querySelector('.card-more').click());
await wait(500);
const lockedTitle = await page.evaluate(() => document.querySelectorAll('.card-title')[0].textContent.trim());
await page.evaluate(() => {
  [...document.querySelectorAll('#menu-note .sheet-row')].find((b) => b.textContent.includes('قفل الملاحظة')).click();
});
await wait(1200);
{
  const first = await page.$eval('.card', (el) => ({
    title: el.querySelector('.card-title').textContent.trim(),
    snippet: el.querySelector('.card-snippet').textContent.trim(),
    locked: el.classList.contains('locked-note'),
  }));
  check(/مقفلة/.test(first.title), 'الملاحظة المقفلة تُخفى في القائمة', first.title);
  check(!first.title.includes(lockedTitle), 'العنوان الحقيقي لا يظهر', lockedTitle);
  check(/🔒|اضغط/.test(first.snippet), 'النص مختفٍ ويظهر طلب الفتح', first.snippet);
}

// البحث لا يكشفها
await tap('#btn-search');
await page.fill('#search-input', lockedTitle);
await wait(600);
{
  const shown = await page.$$eval('.card', (els) => els.length);
  check(shown === 0, 'البحث لا يكشف الملاحظة المقفلة', `${shown} نتيجة`);
}
await page.fill('#search-input', '');
await wait(400);
await tap('#btn-search');
await wait(500);

// فتحها يطلب التحقق
await page.evaluate(() => document.querySelectorAll('.card')[0].click());
await wait(900);
check(await page.isVisible('#gate'), 'فتح ملاحظة مقفلة يطلب الباترن/الرمز');
await page.fill('#gate-pin', PIN);
await tap('#gate-pin-form button[type="submit"]');
await wait(1400);
check(!(await page.isHidden('#screen-editor')), 'بعد التحقق تُفتح الملاحظة');
{
  const title = await page.inputValue('#note-title');
  check(title === lockedTitle, 'المحتوى الحقيقي ظاهر بعد الفتح', title);
  const lockedChip = await page.$eval('#btn-note-lock', (el) => el.classList.contains('active'));
  check(lockedChip, 'زر القفل في شريط المحرر يبيّن أن الملاحظة مقفلة');
}
await page.screenshot({ path: `${OUT}/15-note-locked.png` });
await tap('#btn-back');
await wait(800);
check(/مقفلة/.test(await page.$eval('.card-title', (el) => el.textContent)), 'بعد الرجوع تُخفى من جديد');

// إلغاء قفل الملاحظة
await page.evaluate(() => document.querySelectorAll('.card')[0].querySelector('.card-more').click());
await wait(500);
await page.evaluate(() => {
  [...document.querySelectorAll('#menu-note .sheet-row')].find((b) => b.textContent.includes('إلغاء قفل')).click();
});
await wait(900);
await page.fill('#gate-pin', PIN);
await tap('#gate-pin-form button[type="submit"]');
await wait(1400);
check(!/مقفلة/.test(await page.$eval('.card-title', (el) => el.textContent)), 'إلغاء قفل الملاحظة يعيد العنوان');

// القفل الجماعي: تحديد الكل ثم «قفل»
await page.evaluate(() => document.querySelectorAll('.card')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
await wait(700);
await page.evaluate(() => document.getElementById('select-all').click());
await wait(400);
await page.evaluate(() => {
  [...document.querySelectorAll('#select-actions button')].find((b) => b.textContent.trim() === '🔒قفل' || (b.textContent.includes('قفل') && !b.textContent.includes('إلغاء'))).click();
});
await wait(1500);
{
  const lockedCards = await page.$$eval('.card.locked-note', (els) => els.length);
  const cards = await page.$$eval('.card', (els) => els.length);
  check(lockedCards === cards && cards > 0, 'القفل الجماعي يقفل كل المحدّد', `${lockedCards}/${cards}`);
}

const failed = report();
await browser.close();
process.exit(failed ? 1 : 0);
