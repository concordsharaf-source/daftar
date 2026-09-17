/*
 * اختبارات طبقة التشفير والقفل — تعمل في Node (بلا متصفح).
 * تُغطّي: دورة تشفير/فك، اشتقاق المفاتيح، البصمة الرقمية للنص المُشفَّر،
 * منع الفتح بكلمة خاطئة، الحاجز المؤقت بعد المحاولات الفاشلة،
 * وترحيل الملاحظات بين «مشفَّر» و«صريح».
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as crypto from '../js/crypto.js';
import * as db from '../js/db.js';
import * as lock from '../js/lock.js';

const PIN = '482913';

/** يعيد الحالة إلى: قفل مُطفأ، مفتاح صريح، مخزن مهيأ. */
async function baseline() {
  await db.init();
  await lock.init();
  await lock.clearLockout();
  if (lock.isEnabled()) {
    if (!lock.isUnlocked()) await lock.unlockWithSecret(PIN);
    await lock.disableLock();
  }
  crypto.setFieldEncryption(false);
  crypto.clearSessionKey();
}

test('تشفير/فك تشفير نصّي كامل', async () => {
  const key = await crypto.keyFromSecretBytes(crypto.randomBytes(32));
  const plain = 'ملاحظة سرّية 🔐 with latin text and <b>html</b>';
  const cipher = await crypto.encryptString(key, plain);
  assert.notEqual(cipher, plain, 'النص المشفّر يجب أن يختلف عن الأصل');
  assert.ok(crypto.isEncryptedValue(cipher));
  assert.equal(await crypto.decryptString(key, cipher), plain);
});

test('المفتاح المشتق من الباترن ثابت لنفس الباترن ويتغيّر مع الملح', async () => {
  const salt = crypto.randomBytes(16);
  const a = await crypto.keyFromPattern('0-1-2-5-8', salt);
  const b = await crypto.keyFromPattern('0-1-2-5-8', salt);
  const c = await crypto.keyFromPattern('0-1-2-5-7', salt);
  const d = await crypto.keyFromPattern('0-1-2-5-8', crypto.randomBytes(16));

  const text = 'نص تجريبي';
  const cipher = await crypto.encryptString(a, text);
  assert.equal(await crypto.decryptString(b, cipher), text, 'نفس الباترن ⇒ نفس المفتاح');
  assert.equal(await crypto.decryptString(c, cipher), null, 'باترن مختلف ⇒ فشل الفك');
  assert.equal(await crypto.decryptString(d, cipher), null, 'ملح مختلف ⇒ فشل الفك');
});

test('النص المُشفَّر يبدأ بالبادئة المتفق عليها ولا يساوي الأصل', async () => {
  const key = await crypto.keyFromSecretBytes(crypto.randomBytes(32));
  const cipher = await crypto.encryptString(key, 'سري');
  assert.ok(cipher.startsWith(crypto.FIELD_PREFIX), cipher.slice(0, 12));
  assert.ok(!cipher.includes('سري'));
  assert.equal(crypto.isEncryptedValue('نص عادي'), false);
});

test('شاهد القفل (canary) يكشف المفتاح الصحيح فقط', async () => {
  const good = await crypto.keyFromSecretBytes(crypto.randomBytes(32));
  const bad = await crypto.keyFromSecretBytes(crypto.randomBytes(32));
  const canary = await crypto.createCanary(good);
  assert.equal(await crypto.verifyCanary(good, canary), true);
  assert.equal(await crypto.verifyCanary(bad, canary), false);
  assert.equal(await crypto.verifyCanary(good, 'بلا قيمة'), false);
});

test('قياس قوة السر يتزايد مع الطول ويرفض الفارغ', () => {
  assert.equal(crypto.secretStrength(''), 0);
  assert.equal(crypto.secretStrength('1234'), 1);
  assert.equal(crypto.secretStrength('123456'), 2);
  assert.equal(crypto.secretStrength('123456789'), 3);
});

test('دورة كاملة: تفعيل القفل يشفّر الملاحظات وإطفاؤه يعيدها صريحة', async () => {
  await db.init();
  const id = await db.saveNote(db.newNote({ title: 'عنوان عادي', contentHtml: '<p>محتوى</p>' }));

  const result = await lock.setupSecret('pin', '482913');
  assert.equal(result, true, 'setupSecret يعيد true عند النجاح');
  assert.equal(lock.getState().enabled, true);
  assert.equal(lock.getState().method, 'pin');
  assert.equal(lock.getState().encrypted, true);
  assert.equal(lock.isUnlocked(), true);

  // القراءة عبر الواجهة تفكّ التشفير
  const note = await db.getNote(id);
  assert.equal(note.title, 'عنوان عادي');
  assert.equal(note.contentHtml, '<p>محتوى</p>');

  // القراءة الخام من التخزين تُظهر النص مشفّرًا
  const raw = db.storage.mode === 'indexeddb'
    ? null
    : db.__rawNotes().find((n) => n.id === id);
  if (raw) {
    assert.ok(crypto.isEncryptedValue(raw.title), 'يجب أن يكون العنوان مشفّرًا في المخزن');
    assert.ok(!String(raw.title).includes('عنوان'));
    assert.ok(crypto.isEncryptedValue(raw.contentHtml));
  }

  // بلا مفتاح في الجلسة لا يظهر أي نص (ولا يُسرَّب المشفَّر)
  crypto.clearSessionKey();
  assert.equal((await db.getNote(id)).title, '', 'بلا مفتاح في الجلسة لا يظهر أي نص');
  crypto.setSessionKey(await crypto.keyFromSecretBytes(crypto.randomBytes(32)));
  const lost = await db.getNote(id);
  assert.equal(lost.title, '', 'بمفتاح خاطئ يجب ألا يظهر أي نص');
  assert.ok(!String(lost.contentHtml).includes('enc:v1:'), 'لا يُسرَّب النص المشفّر للمستخدم');

  // إطفاء القفل يفكّ التشفير ويعيد النص صريحًا
  const back = await lock.unlockWithSecret('482913');
  assert.equal(back.ok, true);
  await lock.disableLock();
  assert.equal(lock.getState().enabled, false);
  const after = await db.getNote(id);
  assert.equal(after.title, 'عنوان عادي');
  assert.equal(after.contentHtml, '<p>محتوى</p>');
  const rawAfter = db.storage.mode === 'indexeddb'
    ? null
    : db.__rawNotes().find((n) => n.id === id);
  if (rawAfter) assert.equal(crypto.isEncryptedValue(rawAfter.title), false);
});

test('الرمز الخاطئ يفشل، وبعد ٥ محاولات يُقفل الإدخال مؤقتًا', async () => {
  await baseline();
  await db.saveNote(db.newNote({ title: 'ملاحظة', contentHtml: '<p>x</p>' }));
  const res = await lock.setupSecret('pin', '482913');
  assert.equal(res, true);
  await lock.lockNow();
  assert.equal(lock.isUnlocked(), false);

  for (let i = 1; i <= 4; i++) {
    const bad = await lock.unlockWithSecret('000000');
    assert.equal(bad.ok, false);
    assert.equal(bad.remaining, 5 - i);
  }
  const fifth = await lock.unlockWithSecret('000000');
  assert.equal(fifth.ok, false);
  assert.ok(lock.lockRemainingMs() > 0, 'يجب أن يبدأ الحاجز الزمني');

  const blocked = await lock.unlockWithSecret('482913');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'locked-out', 'لا يُقبل الرمز الصحيح أثناء الحاجز');

  // تصفير الحاجز (كما لو انقضى الوقت) ثم الفتح الصحيح
  await lock.clearLockout();
  const ok = await lock.unlockWithSecret(PIN);
  assert.equal(ok.ok, true);
  assert.equal(lock.isUnlocked(), true);
});

test('القفل التلقائي يحترم مهلة المغادرة', async () => {
  await lock.init();
  if (lock.isEnabled() && !lock.isUnlocked()) await lock.unlockWithSecret(PIN);
  lock.setRelockMs(30_000);
  const now = Date.now();
  assert.equal(lock.shouldRelock(0), false, 'لا قفل بلا وقت مغادرة');
  assert.equal(lock.shouldRelock(now - 5_000), false, 'خلال المهلة لا يُقفل');
  assert.equal(lock.shouldRelock(now - 45_000), true, 'بعد المهلة يُقفل');

  lock.setRelockMs(0);
  assert.equal(lock.shouldRelock(now - 1), true, 'مهلة صفر ⇒ قفل فوري');
  assert.equal(lock.shouldRelock(now), false, 'نفس اللحظة لا تُعد مغادرة');
});

test('ترحيل الملاحظات يحافظ على العدد والتواريخ وترتيب العرض', async () => {
  await baseline();
  const firstId = await db.saveNote(db.newNote({ title: 'أولى', contentHtml: '<p>1</p>', updatedAt: 1_000, createdAt: 1_000 }));
  const secondId = await db.saveNote(db.newNote({ title: 'ثانية', contentHtml: '<p>2</p>', updatedAt: 2_000, createdAt: 2_000 }));

  const key = await crypto.keyFromSecretBytes(crypto.randomBytes(32));
  const count = await db.migrateNotes(key, true);
  assert.ok(count >= 2, `يُرحَّل كل ما في المخزن (${count})`);

  const notes = await db.allNotes();
  const mine = notes.filter((n) => n.id === firstId || n.id === secondId);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map((n) => n.title).sort(), ['أولى', 'ثانية'], 'النصوص سليمة بعد الترحيل');
  assert.equal(mine.find((n) => n.id === secondId).updatedAt, 2_000, 'تاريخ التحديث لا يتغيّر بالترحيل');

  const rawEncrypted = db.storage.mode === 'indexeddb'
    ? 2
    : db.__rawNotes().filter((n) => [firstId, secondId].includes(n.id) && crypto.isEncryptedValue(n.title)).length;
  assert.equal(rawEncrypted, 2, 'كلا العنوانين مشفّر في المخزن');
  await baseline();
});

test('لا تُسرَّب قيمة مشفّرة كنص عادي عند غياب المفتاح', async () => {
  await baseline();
  await db.migrateNotes(await crypto.keyFromSecretBytes(crypto.randomBytes(32)), true);
  crypto.clearSessionKey();
  assert.equal(await crypto.decryptField('enc:v1:anything'), '');
  assert.equal(await crypto.decryptField('نص صريح'), 'نص صريح', 'النص غير المشفّر يمرّ كما هو');
  await baseline();
});

test('حماية: الكتابة والترحيل بلا مفتاح لا تسرّب ولا تفقد النص', async () => {
  await baseline();
  await lock.setupSecret('pin', PIN);
  const id = await db.saveNote(db.newNote({ title: 'محمي', contentHtml: '<p>سري جدًا</p>' }));

  crypto.clearSessionKey(); // كما لو أن التطبيق أُقفل
  const visible = await db.getNote(id);
  assert.equal(visible.title, '', 'لا يظهر النص والتطبيق مقفل');

  // الكتابة (تثبيت/مفضلة) تُبقي الحقول المشفّرة كما هي ولا تكتب نصًا صريحًا
  await db.saveNote({ ...visible, isFavorite: true, updatedAt: 10_000 });
  const raw = db.storage.mode === 'indexeddb'
    ? null
    : db.__rawNotes().find((n) => n.id === id);
  if (raw) {
    assert.equal(raw.isFavorite, true, 'الحقل غير النصي يُحفظ');
    assert.ok(crypto.isEncryptedValue(raw.title), 'العنوان يبقى مشفّرًا');
    assert.ok(!String(raw.contentHtml).includes('سري جدًا'), 'لا يُكتب النص صريحًا');
  }

  // الترحيل بلا مفتاح مرفوض (يمنع فقدان البيانات)
  await assert.rejects(() => db.migrateNotes(null, false), /locked/);

  // ملاحظة جديدة والتطبيق مقفل: مرفوضة أيضًا
  await assert.rejects(() => db.saveNote(db.newNote({ title: 'جديدة' })), /locked/);

  const back = await lock.unlockWithSecret(PIN);
  assert.equal(back.ok, true);
  const after = await db.getNote(id);
  assert.equal(after.title, 'محمي', 'النص سليم بعد الفتح');
  assert.equal(after.contentHtml, '<p>سري جدًا</p>');
  await baseline();
});
