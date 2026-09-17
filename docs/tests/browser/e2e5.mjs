/*
 * اختبار المرحلة الخامسة (Chromium): قفل الملاحظة بالبصمة مباشرة.
 *
 * يستخدم «مُوثِّقًا افتراضيًا» (Virtual Authenticator) عبر CDP حتى يكون للجهاز
 * بصمة حقيقية في الاختبار، فنتأكد أن:
 *  - قفل الملاحظة يعمل بلا أي قفل للتطبيق.
 *  - فتح الملاحظة المقفلة يُظهر حوار الجهاز **مباشرة** بلا أي صفحة داخل التطبيق.
 *  - التطبيق يبقى مفتوحًا (لا بوابة، لا قفل للتطبيق).
 *
 * التشغيل: BASE_URL=http://localhost:8000/ node e2e5.mjs
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
  console.log('\n=========== نتائج اختبار المرحلة الخامسة ===========');
  results.forEach(([m, n, d]) => console.log(`${m} ${n}${d ? ' — ' + d : ''}`));
  const failed = results.filter((r) => r[0] === '❌').length;
  console.log(`\nالمجموع: ${results.length} • نجح: ${results.length - failed} • فشل: ${failed}`);
  if (consoleErrors.length) {
    console.log('\n--- أخطاء الكونسول ---');
    [...new Set(consoleErrors)].slice(0, 10).forEach((e) => console.log('•', e.slice(0, 220)));
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

// جهاز له بصمة: موثّق افتراضي داخلي مع تحقق مستخدم تلقائي
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
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
await wait(700);

// ================================================= 1) الجهاز يوفّر بصمة فعلًا
{
  const available = await page.evaluate(() =>
    window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.());
  check(available === true, 'الجهاز يوفّر بصمة (موثّق افتراضي داخلي)', String(available));
}

// ================================================= 2) قفل ملاحظة بلا قفل تطبيق
async function newNote(title, body) {
  await tap('#btn-new');
  await page.waitForSelector('#screen-editor:not([hidden])');
  await page.fill('#note-title', title);
  await page.click('#editor');
  await page.keyboard.type(body);
  await wait(700);
  await tap('#btn-back');
  await wait(600);
}
await newNote('سرية جدًا', 'هذا نص لا أريد أن يراه أحد');
await newNote('ملاحظة عادية', 'نص عادي');

{
  const lockState = await page.evaluate(async () => {
    const mod = await import('./js/lock.js');
    return mod.getState();
  }).catch(() => null);
  if (lockState) check(lockState.enabled === false, 'قفل التطبيق غير مفعّل (بداية نظيفة)');
}

// اقفل الملاحظة «سرية جدًا» من خياراتها
const SECRET = 'سرية جدًا';

async function cardIndexByTitle(title) {
  return page.evaluate((t) => [...document.querySelectorAll('.card')]
    .findIndex((c) => c.querySelector('.card-title').textContent.trim() === t), title);
}
async function openMenuOf(title) {
  const index = await cardIndexByTitle(title);
  if (index < 0) throw new Error(`لم أجد بطاقة بعنوان: ${title}`);
  await page.evaluate((i) => document.querySelectorAll('.card')[i].querySelector('.card-more').click(), index);
  await wait(500);
}
async function menuAction(label) {
  await page.evaluate((l) => {
    [...document.querySelectorAll('#menu-note .sheet-row')].find((b) => b.textContent.includes(l)).click();
  }, label);
  await wait(1400);
}

await openMenuOf(SECRET);
await menuAction('قفل الملاحظة');

check(await page.isHidden('#gate'), 'قفل الملاحظة لا يطلب تحققًا ولا يعرض بوابة');
check(await page.isVisible('#screen-list'), 'التطبيق يبقى مفتوحًا بعد قفل الملاحظة');
{
  const titles = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent.trim()));
  check(!titles.includes(SECRET), 'العنوان الحقيقي اختفى من القائمة', titles.join(' | '));
  const snippets = await page.$$eval('.card-snippet', (els) => els.map((e) => e.textContent.trim()));
  check(!snippets.some((t) => t.includes('لا أريد')), 'النص لا يظهر في القائمة');
}

// البحث لا يكشفها
await tap('#btn-search');
await page.fill('#search-input', 'سرية');
await wait(600);
check((await page.$$eval('.card', (els) => els.length)) === 0, 'البحث لا يكشف الملاحظة المقفلة');
await page.fill('#search-input', '');
await wait(300);
await tap('#btn-search');
await wait(500);

// ================================================= 3) الفتح: البصمة تظهر مباشرة
{
  // نراقب ظهور أي بوابة داخلية أثناء الفتح
  let gateAppeared = false;
  const watcher = setInterval(async () => {
    const visible = await page.isVisible('#gate').catch(() => false);
    if (visible) gateAppeared = true;
  }, 60);

  const index = await cardIndexByTitle('ملاحظة مقفلة 🔒');
  await page.evaluate((i) => document.querySelectorAll('.card')[i].click(), index);
  await wait(2200);
  clearInterval(watcher);

  check(!gateAppeared, 'لم تظهر أي صفحة تحقق داخلية — حوار النظام مباشرة');
  check(!(await page.isHidden('#screen-editor')), 'الملاحظة فُتحت بعد التحقق بالبصمة');
  check((await page.inputValue('#note-title')) === SECRET, 'المحتوى الحقيقي ظاهر', await page.inputValue('#note-title'));
}
{
  const creds = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  check(creds.credentials.length >= 1,
    'سُجِّل اعتماد بصمة للجهاز (يُعاد استخدامه لاحقًا)', `${creds.credentials.length} اعتماد`);
}
// البصمة سُجّلت مرة واحدة فقط (لا تسجيل متكرر عند كل فتح)
{
  const before = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length;
  await tap('#btn-back');
  await wait(900);
  const idx2 = await cardIndexByTitle('ملاحظة مقفلة 🔒');
  await page.evaluate((i) => document.querySelectorAll('.card')[i].click(), idx2);
  await wait(2000);
  const after = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length;
  check(after === before, 'لا يُسجَّل اعتماد جديد عند كل فتح', `${before} → ${after}`);
  check(!(await page.isHidden('#screen-editor')), 'يفتح مرة أخرى بالبصمة مباشرة');
  await tap('#btn-back');
  await wait(800);
}

// ================================================= 4) إلغاء القفل بالمصادقة على الجهاز
await openMenuOf('ملاحظة مقفلة 🔒');
await menuAction('إلغاء قفل');
await wait(1200);
check(await page.isHidden('#gate'), 'إلغاء القفل يتحقق بالبصمة بلا بوابة داخلية');
{
  const titles = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent.trim()));
  check(titles.includes(SECRET), 'الملاحظة عادت ظاهرة بالعنوان الكامل', titles.join(' | '));
}

// ================================================= 5) قفل جماعي مع بصمة
await page.evaluate(() => document.querySelectorAll('.card')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 300 })));
await wait(700);
check(await page.isVisible('#select-bar'), 'الضغط المطوّل يفتح وضع التحديد');
await page.evaluate(() => document.getElementById('select-all').click());
await wait(400);
await page.evaluate(() => {
  [...document.querySelectorAll('#select-actions button')].find((b) => b.textContent.includes('🔒')).click();
});
await wait(1800);
{
  const locked = await page.$$eval('.card.locked-note', (els) => els.length);
  const all = await page.$$eval('.card', (els) => els.length);
  check(locked === all && all >= 2, 'القفل الجماعي بالبصمة يعمل', `${locked}/${all}`);
  check(await page.isHidden('#gate'), 'ولا يظهر أي تحقق عند القفل');
}
await page.screenshot({ path: `${OUT}/16-note-lock-device.png` });

// ================================================= 6) رجوع التطبيق لحالته الطبيعية
const failed = report();
await browser.close();
process.exit(failed ? 1 : 0);
