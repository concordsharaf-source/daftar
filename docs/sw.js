/*
 * Service Worker — يجعل «دفتر» يعمل بلا اتصال ويُثبَّت كتطبيق.
 *
 * الاستراتيجية:
 *  - تنقّل الصفحات: الشبكة أولًا ثم النسخة المخزّنة (حتى تصل التحديثات فورًا)،
 *    وعند انقطاع الاتصال تُعرض النسخة المحفوظة كاملة.
 *  - ملفات التطبيق الثابتة: من الذاكرة المؤقتة فورًا مع تحديث في الخلفية.
 *  - الخطوط: تُخزَّن عند أول استخدام (لا نُثقّل التحميل الأول بالخطوط الخمسة).
 */

const VERSION = 'daftar-v2.7.1';
const CORE_CACHE = `${VERSION}-core`;
const FONT_CACHE = `${VERSION}-fonts`;

const CORE_ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/db.js',
  './js/editor.js',
  './js/backup.js',
  './js/crypto.js',
  './js/lock.js',
  './js/pattern.js',
  './js/keep.js',
  './js/util.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fonts/cairo_regular.ttf',
  './fonts/cairo_bold.ttf',
  './fonts/amiri_regular.ttf',
  './fonts/tajawal_regular.ttf',
  './fonts/tajawal_bold.ttf',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    // أضف كل ملف على حدة حتى لا يُفشل ملف واحد التثبيت كله
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (e) {
        console.warn('[sw] تعذّر تخزين', url, e);
      }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1) تنقّل الصفحات
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CORE_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || new Response('لا يوجد اتصال ولا نسخة محفوظة.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  // 2) الخطوط: من الذاكرة المؤقتة، وتُخزَّن عند أول طلب
  if (/\/fonts\/.+\.ttf$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })());
    return;
  }

  // 3) بقية ملفات التطبيق: cache-first مع تحديث خلفي
  event.respondWith((async () => {
    const cache = await caches.open(CORE_CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);

    return cached || (await network) || new Response('', { status: 504 });
  })());
});
