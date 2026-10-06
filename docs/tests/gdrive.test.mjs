/*
 * اختبارات وحدة مزامنة Google Drive (بلا شبكة: fetch مُقلَّد).
 * تُشغَّل مع البقية عبر: node --test docs/tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let existingFile = null;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ u, opts });
  if (u.includes('spaces=appDataFolder')) {
    return { ok: true, status: 200, json: async () => ({ files: existingFile ? [existingFile] : [] }) };
  }
  if (u.includes('/upload/drive/v3/files/') && opts.method === 'PATCH') {
    return { ok: true, status: 200, json: async () => ({}) };
  }
  if (u.includes('uploadType=multipart')) {
    return { ok: true, status: 200, json: async () => ({ id: 'new-id' }) };
  }
  if (u.includes('alt=media')) {
    return { ok: true, status: 200, blob: async () => new Blob(['ZIPDATA']) };
  }
  return { ok: false, status: 500 };
};

const gdrive = await import('../js/gdrive.js');

test('غير متصل قبل منح الرمز', () => {
  assert.equal(gdrive.isConnected(), false);
});

test('الرفع يجد ملفًا موجودًا فيحدّثه PATCH', async () => {
  gdrive._setToken('tok');
  assert.equal(gdrive.isConnected(), true);
  existingFile = { id: 'abc' };
  calls.length = 0;
  const id = await gdrive.uploadBackup(new Blob(['X'], { type: 'application/zip' }));
  assert.equal(id, 'abc');
  const patch = calls.find((c) => c.opts.method === 'PATCH');
  assert.ok(patch, 'طلب PATCH');
  assert.ok(patch.u.includes('/upload/drive/v3/files/abc'));
  assert.match(patch.opts.headers['Content-Type'], /zip/);
});

test('الرفع بلا ملف موجود ينشئ داخل appDataFolder', async () => {
  existingFile = null;
  calls.length = 0;
  const id = await gdrive.uploadBackup(new Blob(['X']));
  assert.equal(id, 'new-id');
  const post = calls.find((c) => c.opts.method === 'POST');
  assert.ok(post, 'طلب POST multipart');
  assert.ok(post.u.includes('uploadType=multipart'));
  assert.match(post.opts.headers['Content-Type'], /multipart\/related; boundary=/);
  const body = await post.opts.body.text();
  assert.match(body, /appDataFolder/);
  assert.match(body, /daftar-sync\.zip/);
});

test('التنزيل يعيد blob النسخة أو null عند غيابها', async () => {
  existingFile = { id: 'abc' };
  const blob = await gdrive.downloadBackup();
  assert.equal(await blob.text(), 'ZIPDATA');
  existingFile = null;
  assert.equal(await gdrive.downloadBackup(), null);
});
