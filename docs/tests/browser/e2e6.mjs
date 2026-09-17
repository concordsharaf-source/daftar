/*
 * اختبار المرحلة السادسة (Chromium): السحب لأسفل لتحديث التطبيق.
 *
 * يُحاكي لمسة حقيقية عبر CDP (Input.dispatchTouchEvent) ويتحقق أن:
 *  - السحب من أعلى القائمة يُظهر المؤشّر («أفلت للتحديث») ثم يعيد تحميل الصفحة فعلًا.
 *  - السحب القصير لا يحدّث ويعيد المؤشّر مكانه.
 *  - لا يعمل داخل المحرر (حتى لا يُفقد أي كتابة).
 *  - Ctrl+R يعمل كتحديث للتطبيق أيضًا.
 *
 * التشغيل: BASE_URL=http://localhost:8000/ node e2e6.mjs
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
  console.log('\n=========== نتائج اختبار المرحلة السادسة ===========');
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

const cdp = await context.newCDPSession(page);
const wait = (ms) => page.waitForTimeout(ms);

/** لمسة واحدة عبر CDP: تبدأ عند y ثم تتحرك لأسفل على خطوات. */
async function swipeDown({ from = 220, to = 620, steps = 12, pauseAt = 0 } = {}) {
  const x = 200;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const y = from + ((to - from) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
    if (pauseAt && i === steps) await wait(pauseAt);
    await wait(20);
  }
  return { x, y: to };
}

async function endSwipe() {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => indexedDB.deleteDatabase('daftar'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#notes-list');
await wait(900);

// ملاحظة واحدة حتى لا تكون القائمة فارغة
await page.$eval('#btn-new', (el) => el.click());
await wait(600);
await page.fill('#note-title', 'ملاحظة للتحديث');
await page.$eval('#btn-back', (el) => el.click());
await wait(900);

// ================================================= 1) السحب القصير لا يحدّث
{
  await page.evaluate(() => { window.__marker = 'before-short'; });
  await swipeDown({ from: 220, to: 300, steps: 6 });
  const armed = await page.$eval('#pull', (el) => el.classList.contains('armed')).catch(() => false);
  check(!armed, 'السحب القصير لا يُجهّز التحديث');
  await endSwipe();
  await wait(700);
  const stillHere = await page.evaluate(() => window.__marker === 'before-short');
  check(stillHere, 'السحب القصير لا يعيد تحميل الصفحة');
  check(await page.isHidden('#pull'), 'يختفي المؤشّر بعد السحب القصير');
}

// ================================================= 2) السحب الكافي يعيد التحميل فعليًا
{
  await page.evaluate(() => { window.__marker = 'before-pull'; });
  const navigated = page.waitForEvent('framenavigated', { timeout: 15000 }).catch(() => null);
  await swipeDown({ from: 200, to: 620, steps: 14, pauseAt: 120 });
  const visibleText = await page.textContent('#pull-text').catch(() => '');
  const armed = await page.$eval('#pull', (el) => el.classList.contains('armed')).catch(() => false);
  check(armed || /تحديث/.test(visibleText), 'يظهر المؤشّر أثناء السحب', visibleText.trim());
  await page.screenshot({ path: `${OUT}/17-pull-to-refresh.png` });
  await endSwipe();
  await navigated;
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await wait(1500);
  const markerGone = await page.evaluate(() => typeof window.__marker === 'undefined');
  check(markerGone, 'السحب لأسفل أعاد تحميل التطبيق فعلًا');
  check(await page.isHidden('#pull'), 'يعود المؤشّر مخفيًا بعد التحديث');
  const notes = await page.$$eval('.card', (els) => els.length);
  check(notes >= 1, 'الملاحظات موجودة بعد التحديث', `${notes} ملاحظة`);
}

// ================================================= 3) لا تحديث داخل المحرر
{
  const noteIndex = 0;
  await page.evaluate((i) => document.querySelectorAll('.card')[i].click(), noteIndex);
  await page.waitForSelector('#screen-editor:not([hidden])');
  await wait(500);
  await page.evaluate(() => { window.__marker = 'in-editor'; });
  await swipeDown({ from: 300, to: 640, steps: 12 });
  const pullHidden = await page.isHidden('#pull');
  await endSwipe();
  await wait(900);
  const stillEditing = await page.evaluate(() => window.__marker === 'in-editor');
  check(pullHidden, 'لا يظهر مؤشّر التحديث داخل المحرر');
  check(stillEditing, 'لا يُعاد تحميل الصفحة أثناء الكتابة (لا فقدان نص)');
  check(!(await page.isHidden('#screen-editor')), 'نبقى داخل المحرر');
  await page.$eval('#btn-back', (el) => el.click());
  await wait(800);
}

// ================================================= 4) Ctrl+R يعمل كتحديث
{
  await page.evaluate(() => { window.__marker = 'before-ctrl-r'; });
  await page.keyboard.press('Control+r');
  await wait(2500);
  const markerGone = await page.evaluate(() => typeof window.__marker === 'undefined');
  check(markerGone, 'Ctrl+R يحدّث التطبيق داخل الواجهة');
}

const failed = report();
await browser.close();
process.exit(failed ? 1 : 0);
