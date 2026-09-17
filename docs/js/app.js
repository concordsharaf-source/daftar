/*
 * منطق التطبيق — مكافئ HomeScreen/HomeViewModel/EditorScreen/SettingsScreen.
 *
 * يعمل بلا أي مكتبة خارجية: عرض القائمة، البحث والترتيب (بتطبيع عربي مطابق
 * للنسخة الأصلية)، المحرر، السلة، النسخ الاحتياطي، الإعدادات، والتثبيت كتطبيق.
 */

import {
  init, storage, allNotes, getNote, saveNote, patchNote, deleteNoteForever, emptyTrash,
  getSettings, setSetting, importNotes,
} from './db.js';
import { RichEditor } from './editor.js';
import * as lock from './lock.js';
import { createPatternPad } from './pattern.js';
import { importKeep, keepReportText } from './keep.js';
import {
  buildBackupZip, backupFileName, parseBackupFile, applyImport, stats,
} from './backup.js';
import {
  normalizeArabic, snippet, formatRelative, formatDateTime, escapeHtml, debounce, sanitizeHtml,
} from './util.js';

const COLORS = [
  ['#FFCC80', 'برتقالي'], ['#FFE082', 'أصفر'], ['#A5D6A7', 'أخضر'], ['#80DEEA', 'سماوي'],
  ['#90CAF9', 'أزرق'], ['#CE93D8', 'بنفسجي'], ['#EF9A9A', 'أحمر'],
];

const FONTS = [
  ['cairo', 'القاهرة (Cairo)'], ['amiri', 'أميري (Amiri)'], ['tajawal', 'طجوال (Tajawal)'],
  ['notoNaskh', 'نسخ (Noto Naskh)'], ['notoSans', 'نسخ مبسّط (Noto Sans Arabic)'],
];

const SORTS = [
  ['newest', 'الأحدث'], ['oldest', 'الأقدم'], ['alpha', 'أبجدي'], ['alphaAr', 'أبجدي عربي'],
];

const state = {
  notes: [],
  settings: { theme: 'system', fontKey: 'cairo', fontSize: 18, sortMode: 'newest' },
  query: '',
  sortMode: 'newest',
  filter: 'all',
  currentId: null,
  editor: null,
  installEvent: null,
  backgroundedAt: 0,
  gateResolve: null,
  gateMode: 'unlock',
  lockChoosing: false,
  setupPattern: null,
  setupFirst: null,
  setupStage: 0,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------- أدوات واجهة

let toastSeq = 0;

/** يعرض رسالة سريعة ويعيد مُعرّفًا يمكن إلغاؤه بـclearToast. */
function toast(message, ms = 2200) {
  const el = $('#toast');
  const id = ++toastSeq;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { if (id === toastSeq) el.classList.remove('show'); }, ms);
  return id;
}

/** يُخفي الرسالة إن كانت لا تزال هي المعروضة. */
function clearToast(id) {
  if (id && id !== toastSeq) return;
  toastSeq += 1;
  clearTimeout(toast._t);
  $('#toast').classList.remove('show');
}

/** حوار تأكيد بسيط يعيد Promise<boolean>. */
function confirmDialog({ title, body, confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false }) {
  return new Promise((resolve) => {
    const dlg = $('#dialog-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    ok.textContent = confirmText;
    cancel.textContent = cancelText;
    ok.classList.toggle('danger', danger);
    dlg.classList.add('open');

    const done = (value) => {
      dlg.classList.remove('open');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(value);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

/** حوار إدخال نصّي عام يعيد Promise<string|null>. */
function promptDialog({ title, body, placeholder = '', type = 'text', validate = null, confirmText = 'تأكيد' }) {
  return new Promise((resolve) => {
    const dlg = $('#dialog-prompt');
    $('#prompt-title').textContent = title;
    $('#prompt-body').textContent = body || '';
    const input = $('#prompt-input');
    input.value = '';
    input.type = type;
    input.placeholder = placeholder;
    input.inputMode = type === 'password' ? 'numeric' : 'text';
    $('#prompt-error').textContent = '';
    $('#prompt-ok').textContent = confirmText;
    dlg.classList.add('open');
    setTimeout(() => input.focus(), 80);

    const cleanup = () => {
      dlg.classList.remove('open');
      $('#prompt-ok').removeEventListener('click', onOk);
      $('#prompt-cancel').removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    };
    const finish = (value) => { cleanup(); resolve(value); };
    const onOk = () => {
      const value = input.value.trim();
      const error = validate ? validate(value) : null;
      if (error) { $('#prompt-error').textContent = error; return; }
      finish(value);
    };
    const onCancel = () => finish(null);
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk(); } };
    $('#prompt-ok').addEventListener('click', onOk);
    $('#prompt-cancel').addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function openSheet(id) {
  $$('.sheet').forEach((s) => s.classList.remove('open'));
  $(id).classList.add('open');
  const backdrop = $('.sheet-backdrop');
  if (backdrop) backdrop.hidden = false;
}

function closeSheets() {
  $$('.sheet').forEach((s) => s.classList.remove('open'));
  const backdrop = $('.sheet-backdrop');
  if (backdrop) backdrop.hidden = true;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------- الثيم والخط

function applyAppearance() {
  const { theme, fontKey, fontSize } = state.settings;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.font = fontKey || 'cairo';
  document.documentElement.style.setProperty('--note-font-size', `${fontSize || 18}px`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#121212' : '#0F4C75');
}

// ---------------------------------------------------------------- القائمة

function sortedFilteredNotes() {
  const q = state.query.trim();
  let list = state.notes.filter((n) => !n.isDeleted);
  if (state.filter === 'fav') list = list.filter((n) => n.isFavorite);

  if (q) {
    const needle = q.toLowerCase();
    const normalized = normalizeArabic(q);
    list = list.filter((n) => {
      const title = (n.title || '').toLowerCase();
      const body = normalizeArabic(n.title + ' ' + stripForSearch(n.contentHtml));
      return title.includes(needle) || body.includes(normalized);
    });
  }

  const collator = new Intl.Collator('ar');
  const byTitle = (a, b) => collator.compare(a.title || 'بدون عنوان', b.title || 'بدون عنوان');
  switch (state.sortMode) {
    case 'oldest': list.sort((a, b) => a.updatedAt - b.updatedAt); break;
    case 'alpha': list.sort(byTitle); break;
    case 'alphaAr':
      list.sort((a, b) => collator.compare(
        normalizeArabic(a.title || 'بدون عنوان'), normalizeArabic(b.title || 'بدون عنوان')));
      break;
    default: list.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return list;
}

const stripCache = new Map();
function stripForSearch(html) {
  if (stripCache.has(html)) return stripCache.get(html);
  const value = snippet(html, 4000);
  if (stripCache.size > 500) stripCache.clear();
  stripCache.set(html, value);
  return value;
}

function noteCard(note, { pinned = false } = {}) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = String(note.id);
  if (note.colorLabel) card.style.setProperty('--label', note.colorLabel);

  if (note.colorLabel) {
    const stripe = document.createElement('span');
    stripe.className = 'stripe';
    card.appendChild(stripe);
  }

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = note.title?.trim() || 'بدون عنوان';
  card.appendChild(title);

  const body = document.createElement('p');
  body.className = 'card-snippet';
  body.textContent = snippet(note.contentHtml) || 'لا يوجد نص بعد…';
  card.appendChild(body);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const date = document.createElement('span');
  date.textContent = formatRelative(note.updatedAt);
  meta.appendChild(date);

  if (note.status === 'done') meta.insertAdjacentHTML('beforeend', '<span class="chip done">منجزة</span>');
  if (note.isFavorite) meta.insertAdjacentHTML('beforeend', '<span class="chip" title="مفضلة">★</span>');
  if (pinned || note.isPinned) meta.insertAdjacentHTML('beforeend', '<span class="chip" title="مثبّتة">📌</span>');
  card.appendChild(meta);

  const more = document.createElement('button');
  more.className = 'card-more';
  more.setAttribute('aria-label', 'خيارات الملاحظة');
  more.textContent = '⋯';
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    openNoteMenu(note);
  });
  card.appendChild(more);

  const open = () => openEditor(note.id);
  card.addEventListener('click', open);
  return card;
}

function renderList() {
  const host = $('#notes-list');
  host.innerHTML = '';
  const list = sortedFilteredNotes();
  const pinned = list.filter((n) => n.isPinned);
  const others = list.filter((n) => !n.isPinned);

  if (!list.length) {
    host.appendChild(emptyState());
    return;
  }

  if (pinned.length) {
    host.appendChild(sectionHeader('المثبّتة', pinned.length));
    pinned.forEach((n) => host.appendChild(noteCard(n, { pinned: true })));
    if (others.length) host.appendChild(sectionHeader('الكل', others.length));
  }
  others.forEach((n) => host.appendChild(noteCard(n)));

  const counter = document.createElement('p');
  counter.className = 'list-foot';
  counter.textContent = `${list.length} ملاحظة${state.query ? ` • نتائج «${state.query}»` : ''}`;
  host.appendChild(counter);
}

function sectionHeader(text, count) {
  const el = document.createElement('h2');
  el.className = 'section-head';
  el.textContent = `${text} (${count})`;
  return el;
}

function emptyState() {
  const box = document.createElement('div');
  box.className = 'empty';
  box.innerHTML = state.query
    ? '<div class="empty-icon">🔍</div><h3>لا نتائج</h3><p>جرّب كلمات أخرى أو امسح البحث.</p>'
    : '<div class="empty-icon">📝</div><h3>دفترك فارغ</h3><p>ابدأ بملاحظة جديدة بالزر أدناه.</p>';
  return box;
}

function renderSortChips() {
  const host = $('#sortbar');
  host.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'chips';
  SORTS.forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'chip-btn' + (state.sortMode === key ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', async () => {
      state.sortMode = key;
      await setSetting('sortMode', key);
      state.settings.sortMode = key;
      renderSortChips();
      renderList();
    });
    wrap.appendChild(b);
  });

  const fav = document.createElement('button');
  fav.className = 'chip-btn fav' + (state.filter === 'fav' ? ' active' : '');
  fav.textContent = '★ المفضلة';
  fav.addEventListener('click', () => {
    state.filter = state.filter === 'fav' ? 'all' : 'fav';
    renderSortChips();
    renderList();
  });
  wrap.appendChild(fav);
  host.appendChild(wrap);
}

async function refreshNotes() {
  state.notes = await allNotes();
  renderList();
}

// ---------------------------------------------------------------- المحرر

/**
 * يزامن ارتفاع الشريط العلوي مع متغيّر CSS (--appbar-h) حتى تلتصق الأدوات
 * (شريط التنسيق وشرائح الترتيب) أسفله تمامًا، ولا تختفي تحته عندما يلتفّ
 * الشريط إلى سطرين على الهواتف.
 */
function syncAppbarHeight() {
  const bars = [$('.appbar'), $('.editor-bar')].filter(Boolean);
  let height = 0;
  bars.forEach((bar) => {
    if (bar.offsetParent === null) return;          // غير ظاهر
    height = Math.max(height, bar.getBoundingClientRect().height);
  });
  if (height > 0) {
    document.documentElement.style.setProperty('--appbar-h', `${Math.round(height)}px`);
  }
}

function watchAppbarHeight() {
  syncAppbarHeight();
  const observer = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => syncAppbarHeight())
    : null;
  [$('.appbar'), $('.editor-bar')].filter(Boolean).forEach((bar) => observer?.observe(bar));
  window.addEventListener('resize', syncAppbarHeight);
  window.addEventListener('orientationchange', syncAppbarHeight);
}

/** عدّاد الكلمات والأحرف أسفل الملاحظة (بنفس صيغة نسخة أندرويد). */
function renderCounts({ words, chars }) {
  $('#editor-counts').textContent = `${words} كلمة • ${chars} حرف`;
  $('#editor-counts').title = `${chars} حرف بلا مسافات`;
}

function setSaveStatus(kind) {
  const el = $('#save-status');
  el.className = 'status-chip ' + kind;
  el.textContent = kind === 'saving' ? 'يُحفظ…' : kind === 'saved' ? 'تم الحفظ ✓' : '';
}

async function openEditor(id) {
  const note = await getNote(id);
  if (!note) return;
  state.currentId = id;

  $('#note-title').value = note.title || '';
  $('#editor').innerHTML = sanitizeHtml(note.contentHtml || '');
  $('#editor-foot').textContent = `${note.title ? 'تاريخ الإنشاء: ' + formatDateTime(note.createdAt) : ''}`;

  state.editor.setDocument({ title: note.title || '', html: $('#editor').innerHTML });
  syncEditorButtons(note);

  $('#screen-editor').hidden = false;
  $('#screen-list').hidden = true;
  document.body.classList.add('editing');
  syncAppbarHeight();
  history.replaceState({ screen: 'editor', id }, '', `#note-${id}`);
  // لا نُركّز العنوان تلقائيًا: مؤقّت التركيز يخطف الكتابة من المستخدم السريع
  $('#screen-editor').scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0 });
}

function currentEditorNote() {
  return state.notes.find((n) => n.id === state.currentId) || null;
}

function syncEditorButtons(note) {
  $('#btn-pin').classList.toggle('active', !!note.isPinned);
  $('#btn-fav').classList.toggle('active', !!note.isFavorite);
  $('#btn-status').classList.toggle('active', note.status === 'done');
  $('#btn-color').style.setProperty('--dot', note.colorLabel || 'transparent');
  $('#btn-color').classList.toggle('has-color', !!note.colorLabel);
  $('#btn-undo').disabled = !state.editor.canUndo;
  $('#btn-redo').disabled = !state.editor.canRedo;
}

async function saveCurrentNote() {
  if (state.currentId == null) return;
  const note = await getNote(state.currentId);
  if (!note) return;
  await patchNote(state.currentId, { title: $('#note-title').value || '', contentHtml: state.editor.html });
}

async function closeEditor({ skipSave = false } = {}) {
  if (!skipSave) await state.editor.save();
  if (state.currentId != null) {
    const note = await getNote(state.currentId);
    if (note && !note.title.trim() && !(note.contentHtml || '').trim()) {
      // ملاحظة فارغة تمامًا: لا تُترك في القائمة (نفس سلوك النسخة الأصلية عمليًا)
      await deleteNoteForever(note.id);
    }
  }
  state.currentId = null;
  $('#screen-editor').hidden = true;
  $('#screen-list').hidden = false;
  document.body.classList.remove('editing');
  syncAppbarHeight();
  history.replaceState({ screen: 'list' }, '', '#list');
  await refreshNotes();
}

// ---------------------------------------------------------------- خيارات الملاحظة

function openNoteMenu(note) {
  const host = $('#menu-note');
  host.innerHTML = '';
  const rows = [
    ['📌', note.isPinned ? 'إلغاء التثبيت' : 'تثبيت', async () => {
      await patchNote(note.id, { isPinned: !note.isPinned });
      toast(note.isPinned ? 'أُلغي التثبيت' : 'تم التثبيت');
    }],
    ['★', note.isFavorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة', async () => {
      await patchNote(note.id, { isFavorite: !note.isFavorite });
      toast(note.isFavorite ? 'أُزيلت من المفضلة' : 'أُضيفت للمفضلة');
    }],
    ['🎨', 'تغيير اللون', () => { setTimeout(() => openColorSheet(note), 150); }],
    ['✓', note.status === 'done' ? 'إعادة إلى المسودة' : 'تحديد كمنجزة', async () => {
      await patchNote(note.id, { status: note.status === 'done' ? 'draft' : 'done' });
      toast('تم التحديث');
    }],
    ['↗', 'مشاركة', () => shareNote(note)],
    ['🗑️', 'حذف', async () => {
      const ok = await confirmDialog({
        title: 'حذف الملاحظة',
        body: `نقل «${note.title || 'بدون عنوان'}» إلى سلة المحذوفات؟ يمكن استعادتها لاحقًا.`,
        confirmText: 'حذف',
        danger: true,
      });
      if (!ok) return;
      // "حذف" هنا ناعم: تُنقل للسلة
      await patchNote(note.id, { isDeleted: true });
      toast('نُقلت إلى السلة');
    }],
  ];

  rows.forEach(([icon, label, action]) => {
    const b = document.createElement('button');
    b.className = 'sheet-row';
    b.innerHTML = `<span class="ico"></span><span class="lbl"></span>`;
    b.querySelector('.ico').textContent = icon;
    b.querySelector('.lbl').textContent = label;
    if (label === 'حذف') b.classList.add('danger');
    b.addEventListener('click', async () => {
      closeSheets();
      await action();
      await refreshNotes();
    });
    host.appendChild(b);
  });
  openSheet('#sheet-note');
}

function openColorSheet(note) {
  const host = $('#colors-grid');
  host.innerHTML = '';
  COLORS.forEach(([hex, name]) => {
    const b = document.createElement('button');
    b.className = 'color-dot';
    b.style.background = hex;
    b.title = name;
    b.addEventListener('click', async () => {
      await patchNote(note.id, { colorLabel: hex });
      closeSheets();
      await refreshNotes();
      if (state.currentId === note.id) syncEditorButtons(await getNote(note.id));
    });
    host.appendChild(b);
  });
  const clear = document.createElement('button');
  clear.className = 'sheet-row danger';
  clear.innerHTML = '<span class="ico">✕</span><span class="lbl">إزالة اللون</span>';
  clear.addEventListener('click', async () => {
    await patchNote(note.id, { colorLabel: null });
    closeSheets();
    await refreshNotes();
  });
  host.appendChild(clear);
  openSheet('#sheet-colors');
}

async function shareNote(note) {
  const text = `${note.title || ''}\n\n${snippet(note.contentHtml, 5000)}`.trim();
  if (navigator.share) {
    try {
      await navigator.share({ title: note.title || 'ملاحظة من دفتر', text });
      return;
    } catch { /* أُلغيت المشاركة */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('نُسخت الملاحظة إلى الحافظة');
  } catch {
    toast('تعذّرت المشاركة على هذا المتصفح');
  }
}

// ---------------------------------------------------------------- السلة

async function openTrash() {
  const host = $('#trash-list');
  host.innerHTML = '';
  const trashed = (await allNotes()).filter((n) => n.isDeleted);

  if (!trashed.length) {
    host.innerHTML = '<p class="muted center">السلة فارغة — الملاحظات المحذوفة تظهر هنا.</p>';
  } else {
    trashed.forEach((note) => {
      const row = document.createElement('div');
      row.className = 'trash-row';
      const info = document.createElement('div');
      info.className = 'trash-info';
      info.innerHTML = `<strong>${escapeHtml(note.title || 'بدون عنوان')}</strong><span>${formatRelative(note.updatedAt)}</span>`;
      row.appendChild(info);

      const restore = document.createElement('button');
      restore.className = 'btn ghost';
      restore.textContent = 'استعادة';
      restore.addEventListener('click', async () => {
        await patchNote(note.id, { isDeleted: false });
        toast('تمت الاستعادة');
        await refreshNotes();
        await openTrash();
      });
      row.appendChild(restore);

      const kill = document.createElement('button');
      kill.className = 'btn ghost danger';
      kill.textContent = 'حذف نهائي';
      kill.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'حذف نهائي',
          body: 'لا يمكن التراجع عن هذا الإجراء. حذف الملاحظة وصورها؟',
          confirmText: 'حذف نهائي',
          danger: true,
        });
        if (!ok) return;
        await deleteNoteForever(note.id);
        toast('حُذفت نهائيًا');
        await refreshNotes();
        await openTrash();
      });
      row.appendChild(kill);
      host.appendChild(row);
    });

    const emptyBtn = document.createElement('button');
    emptyBtn.className = 'btn danger wide';
    emptyBtn.textContent = 'إفراغ السلة';
    emptyBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'إفراغ السلة',
        body: `سيُحذف نهائيًا ${trashed.length} ملاحظة مع صورها. متابعة؟`,
        confirmText: 'إفراغ',
        danger: true,
      });
      if (!ok) return;
      const res = await emptyTrash();
      toast(`حُذفت ${res.notes} ملاحظة و${res.images} صورة`);
      await refreshNotes();
      await openTrash();
    });
    host.appendChild(emptyBtn);
  }
  openSheet('#sheet-trash');
}

// ---------------------------------------------------------------- النسخ الاحتياطي

async function exportZip() {
  toast('يُجمع الملف…', 1500);
  const blob = await buildBackupZip();
  download(blob, backupFileName('daftar.zip'));
  toast('تم إنشاء النسخة الاحتياطية');
}

async function exportJson() {
  const { exportPayload } = await import('./db.js');
  const payload = await exportPayload();
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), backupFileName('json'));
  toast('صُدِّرت الملاحظات كـJSON');
}

async function importFile(file) {
  try {
    const parsed = await parseBackupFile(file);
    if (!parsed.notes.length) {
      toast('الملف لا يحتوي ملاحظات');
      return;
    }
    const ok = await confirmDialog({
      title: 'استعادة نسخة',
      body: `سيتم إضافة ${parsed.notes.length} ملاحظة` +
        (parsed.images.length ? ` مع ${parsed.images.length} صورة` : '') +
        ' إلى دفترك الحالي (لن تُحذف ملاحظاتك). متابعة؟',
      confirmText: 'استعادة',
    });
    if (!ok) return;
    const res = await applyImport(parsed);
    toast(`تمت استعادة ${res.notes} ملاحظة${res.images ? ` و${res.images} صورة` : ''}`);
    await refreshNotes();
    closeSheets();
  } catch (e) {
    console.error(e);
    toast('تعذّرت قراءة الملف: ' + e.message, 3500);
  }
}

/**
 * استيراد من Google Keep: يعرض ملخّصًا أولًا ثم يستورد.
 * يدعم ملف Takeout.zip كاملًا أو ملفات .json المفردة (اختيار متعدد).
 */
async function importFromKeep(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const toastId = toast('جارٍ قراءة ملفات Keep…', 20_000);
  try {
    // قراءة أولية للتقرير قبل التعديل على البيانات
    const { parseKeepFile } = await import('./keep.js');
    let preview = { notes: 0, pinned: 0, lists: 0, trashed: 0, images: 0, skipped: [] };
    for (const file of list) {
      try {
        const parsed = await parseKeepFile(file);
        preview.notes += parsed.notes.length;
        preview.pinned += parsed.notes.filter((n) => n.isPinned).length;
        preview.lists += parsed.notes.filter((n) => n.__meta?.isList).length;
        preview.trashed += parsed.notes.filter((n) => n.isDeleted).length;
        preview.images += parsed.images.length;
      } catch (e) {
        preview.skipped.push(`${file.name}: ${e.message}`);
      }
    }

    if (!preview.notes) {
      clearToast(toastId);
      const why = preview.skipped[0] || 'لم أجد ملاحظات Keep في الملف.';
      await confirmDialog({
        title: 'لم أجد ملاحظات Keep',
        body: why + ' — تأكد أنك اخترت ملف Takeout الذي يحتوي مجلد Keep، أو ملف .json لمعلاحظة واحدة.',
        confirmText: 'حسنًا',
        cancelText: 'إغلاق',
      });
      return;
    }

    clearToast(toastId);
    const ok = await confirmDialog({
      title: 'استيراد من Google Keep',
      body: `سيُضاف ${preview.notes} ملاحظة`
        + (preview.pinned ? ` (منها ${preview.pinned} مثبّتة)` : '')
        + (preview.lists ? ` و${preview.lists} قائمة مهام` : '')
        + (preview.images ? ` و${preview.images} صورة` : '')
        + (preview.trashed ? `، و${preview.trashed} ملاحظة محذوفة في Keep ستُوضع في سلة دفتر` : '')
        + '. لا شيء من ملاحظاتك الحالية يُحذف أو يُستبدل. متابعة؟',
      confirmText: 'استيراد',
    });
    if (!ok) return;

    toast('جارٍ الاستيراد… احتفظ بالصفحة مفتوحة', 60_000);
    const report = await importKeep(list);
    toast(keepReportText(report), 6000);
    await refreshNotes();
    closeSheets();
  } catch (e) {
    console.error(e);
    toast('تعذّر الاستيراد: ' + e.message, 4000);
  }
}

// ---------------------------------------------------------------- الإعدادات

function renderSettings() {
  const { theme, fontKey, fontSize } = state.settings;

  const themeHost = $('#set-theme');
  themeHost.innerHTML = '';
  [['system', 'النظام'], ['light', 'نهاري'], ['dark', 'ليلي']].forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'chip-btn' + (theme === key ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', async () => {
      state.settings.theme = key;
      await setSetting('theme', key);
      applyAppearance();
      renderSettings();
    });
    themeHost.appendChild(b);
  });

  const fontHost = $('#set-font');
  fontHost.innerHTML = '';
  FONTS.forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'chip-btn' + (fontKey === key ? ' active' : '');
    b.textContent = label;
    b.style.fontFamily = `var(--font-${key})`;
    b.addEventListener('click', async () => {
      state.settings.fontKey = key;
      await setSetting('fontKey', key);
      applyAppearance();
      renderSettings();
    });
    fontHost.appendChild(b);
  });

  $('#set-font-size').value = String(fontSize || 18);
  $('#set-font-size-value').textContent = `${fontSize || 18}px`;
  $('#set-storage').textContent = storage.persistent ? 'تخزين دائم على هذا الجهاز' : 'تخزين مؤقت (لا يُحفظ بعد الإغلاق)';
  $('#set-storage').classList.toggle('warn', !storage.persistent);
}

async function openSettings() {
  renderLockUI();
  const s = await stats();
  $('#set-stats').textContent = `${s.notes} ملاحظة (${s.trashed} في السلة) • ${s.images} صورة • ${s.chars} حرف`;
  $('#btn-install').hidden = !state.installEvent;
  renderSettings();
  openSheet('#sheet-settings');
}

// ---------------------------------------------------------------- الأحداث

function bindEvents() {
  $('#btn-new').addEventListener('click', async () => {
    const note = { title: '', contentHtml: '', createdAt: Date.now(), updatedAt: Date.now(), isDeleted: false, isPinned: false, isFavorite: false, colorLabel: null, status: 'draft' };
    const { saveNote: save } = await import('./db.js');
    const id = await save(note);
    await refreshNotes();
    await openEditor(id);
  });

  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-trash').addEventListener('click', openTrash);
  $('#btn-backup').addEventListener('click', () => openSheet('#sheet-backup'));

  $('#btn-search').addEventListener('click', () => {
    const bar = $('#searchbar');
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $('#search-input').focus();
    else {
      state.query = '';
      $('#search-input').value = '';
      renderList();
    }
  });

  const onQuery = debounce((value) => {
    state.query = value;
    renderList();
  }, 120);
  $('#search-input').addEventListener('input', (e) => onQuery(e.target.value));

  $('#btn-back').addEventListener('click', () => closeEditor());
  $('#btn-pin').addEventListener('click', async () => {
    const note = currentEditorNote();
    if (!note) return;
    const next = await patchNote(note.id, { isPinned: !note.isPinned });
    syncEditorButtons(next);
    toast(next.isPinned ? 'تم التثبيت' : 'أُلغي التثبيت');
  });
  $('#btn-fav').addEventListener('click', async () => {
    const note = currentEditorNote();
    if (!note) return;
    const next = await patchNote(note.id, { isFavorite: !note.isFavorite });
    syncEditorButtons(next);
    toast(next.isFavorite ? 'أُضيفت للمفضلة' : 'أُزيلت من المفضلة');
  });
  $('#btn-status').addEventListener('click', async () => {
    const note = currentEditorNote();
    if (!note) return;
    const next = await patchNote(note.id, { status: note.status === 'done' ? 'draft' : 'done' });
    syncEditorButtons(next);
    toast(next.status === 'done' ? 'حُدّدت كمنجزة' : 'أُعيدت إلى المسودة');
  });
  $('#btn-color').addEventListener('click', () => {
    const note = currentEditorNote();
    if (note) openColorSheet(note);
  });
  $('#btn-more').addEventListener('click', () => {
    const note = currentEditorNote();
    if (note) openNoteMenu(note);
  });
  $('#btn-undo').addEventListener('click', () => { state.editor.undo(); syncEditorButtons(currentEditorNote() || {}); });
  $('#btn-redo').addEventListener('click', () => { state.editor.redo(); syncEditorButtons(currentEditorNote() || {}); });

  // أزرار التنسيق
  $$('#toolbar [data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      const value = btn.dataset.value || null;
      if (cmd === 'removeFormat') {
        // ✕ يلغي كل التأثيرات — بما فيها ما سيجري كتابته بعد المؤشر
        state.editor.resetTypingFormat();
        toast('أُلغيت كل التأثيرات — النص القادم بلا تنسيق');
        return;
      }
      state.editor.exec(cmd, value);
      if (cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') refreshToolbarState();
    });
  });

  $$('#toolbar [data-block]').forEach((btn) => {
    btn.addEventListener('click', () => state.editor.formatBlock(btn.dataset.block));
  });

  $$('#toolbar [data-color]').forEach((btn) => {
    btn.addEventListener('click', () => state.editor.setTextColor(btn.dataset.color));
  });

  $$('#toolbar [data-highlight]').forEach((btn) => {
    btn.addEventListener('click', () => state.editor.setHighlight(btn.dataset.highlight));
  });

  // الأوراق
  $$('.sheet-backdrop, [data-close]').forEach((el) => el.addEventListener('click', closeSheets));

  // النسخ الاحتياطي
  $('#btn-export-zip').addEventListener('click', exportZip);
  $('#btn-export-json').addEventListener('click', exportJson);
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  });

  $('#file-keep').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) await importFromKeep(files);
  });

  // حجم خط الملاحظة
  $('#set-font-size').addEventListener('input', debounce(async (e) => {
    const size = Number(e.target.value);
    state.settings.fontSize = size;
    $('#set-font-size-value').textContent = `${size}px`;
    applyAppearance();
    await setSetting('fontSize', size);
  }, 120));

  // التثبيت
  $('#btn-install').addEventListener('click', async () => {
    if (!state.installEvent) return;
    state.installEvent.prompt();
    const choice = await state.installEvent.userChoice;
    if (choice.outcome === 'accepted') toast('تم التثبيت — افتحه من شاشة التطبيقات');
    state.installEvent = null;
    $('#btn-install').hidden = true;
  });

  // لوحة المفاتيح
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#dialog-confirm').classList.contains('open')) return;
      if ($$('.sheet.open').length) closeSheets();
      else if (!$('#screen-editor').hidden) closeEditor();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      state.editor?.save({ silent: false });
    }
  });

  // العودة من زر المتصفح داخل المحرر
  window.addEventListener('popstate', () => {
    if (!$('#screen-editor').hidden) closeEditor();
  });

  // العودة للقائمة عند تغيير المظهر من النظام
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

  // الحفظ عند مغادرة الصفحة + القفل التلقائي عند العودة بعد المهلة
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      state.backgroundedAt = Date.now();
      if (state.editor?.hasUnsaved) await state.editor.save();
      return;
    }
    if (lock.isEnabled() && lock.isUnlocked() && lock.shouldRelock(state.backgroundedAt)) {
      // ارجع للقائمة قبل القفل حتى لا يبقى محتوى الملاحظة معروضًا
      if (!$('#screen-editor').hidden) await closeEditor({ skipSave: true });
      lock.lockNow();
      appStarted = false;
      $('#notes-list').innerHTML = '';
      showGate({ mode: 'unlock', reason: 'resume' }).then((ok) => { if (ok) enterApp(); });
    }
  });
}

function refreshToolbarState() {
  ['insertUnorderedList', 'insertOrderedList'].forEach((cmd) => {
    const btn = document.querySelector(`#toolbar [data-cmd="${cmd}"]`);
    if (!btn) return;
    try { btn.classList.toggle('active', document.queryCommandState(cmd)); } catch { /* غير مدعوم */ }
  });
}


// ---------------------------------------------------------------- بوابة القفل

let gatePad = null;
let gateVerifyTimer = null;

/** يعرض بوابة القفل ويعيد Promise<boolean> (true عند نجاح الفتح). */
function showGate({ mode = 'unlock', reason = '', allowCancel = false } = {}) {
  // بوابة سابقة معلّقة؟ نغلقها (بلا فتح) حتى لا يبقى وعدٌ منتظر للأبد
  if (state.gateResolve) {
    const previous = state.gateResolve;
    state.gateResolve = null;
    previous(false);
  }
  const gate = $('#gate');
  gate.hidden = false;
  state.gateMode = mode;
  document.body.classList.add('gated');

  const lockState = lock.getState();
  const method = lockState.method;
  $('#gate-title').textContent = mode === 'verify'
    ? 'أكّد هويتك للمتابعة'
    : (method === 'biometric' ? 'افتح ببصمة الجهاز' : 'أدخل ما يفتح دفترك');
  $('#gate-error').textContent = '';
  $('#gate-cancel').hidden = !allowCancel;
  $('#gate-bio').hidden = !(method === 'biometric' || lockState.hasBiometric);

  // لوحة الباترن
  const patternHost = $('#gate-pattern-host');
  const showPattern = method === 'pattern';
  patternHost.hidden = !showPattern;
  if (showPattern) {
    if (gatePad) gatePad.destroy();
    gatePad = createPatternPad(patternHost, { minDots: 4, onComplete: (r) => handleGateSecret(r.pattern) });
  }

  // حقل الرمز السري
  const pinForm = $('#gate-pin-form');
  pinForm.hidden = method !== 'pin';
  if (method === 'pin') {
    $('#gate-pin').value = '';
    setTimeout(() => $('#gate-pin').focus(), 120);
  }

  updateGateHint();

  // فتح تلقائي بالبصمة عند الإقلاع إن كانت هي الطريقة
  if (mode === 'unlock' && method === 'biometric') {
    setTimeout(() => handleGateBiometric(), 350);
  }

  return new Promise((resolve) => { state.gateResolve = resolve; });
}

function hideGate() {
  $('#gate').hidden = true;
  document.body.classList.remove('gated');
  if (gatePad) { gatePad.destroy(); gatePad = null; }
}

function updateGateHint(busy = false) {
  const remaining = lock.lockRemainingMs();
  const hint = $('#gate-hint');
  if (busy) {
    hint.textContent = 'جارٍ التحقق…';
    return;
  }
  if (remaining > 0) {
    clearInterval(gateVerifyTimer);
    const tick = () => {
      const left = lock.lockRemainingMs();
      hint.textContent = left > 0
        ? `محاولات كثيرة خاطئة — حاول بعد ${Math.ceil(left / 1000)} ثانية`
        : '';
      if (left <= 0) clearInterval(gateVerifyTimer);
    };
    tick();
    gateVerifyTimer = setInterval(tick, 500);
    return;
  }
  hint.textContent = state.gateMode === 'verify'
    ? 'مطلوب للتحقق قبل تغيير إعدادات القفل'
    : '';
}

function gateSuccess() {
  const resolve = state.gateResolve;
  state.gateResolve = null;
  clearInterval(gateVerifyTimer);
  hideGate();
  resolve?.(true);
}

async function handleGateSecret(secret) {
  if (!secret) return;
  updateGateHint(true);
  const result = await lock.unlockWithSecret(secret);
  if (result.ok) {
    $('#gate-error').textContent = '';
    gateSuccess();
    return;
  }
  if (result.reason === 'locked-out') {
    $('#gate-error').textContent = 'الإدخال مقفل مؤقتًا';
  } else {
    $('#gate-error').textContent = `غير صحيح — المحاولات المتبقية: ${result.remaining ?? 0}`;
  }
  $('#gate-pin').value = '';
  updateGateHint();
}

async function handleGateBiometric() {
  updateGateHint(true);
  const result = await lock.unlockWithBiometric();
  if (result.ok) {
    $('#gate-error').textContent = '';
    gateSuccess();
    return;
  }
  updateGateHint();
  if (result.reason === 'cancelled') {
    $('#gate-error').textContent = '';
  } else if (result.reason === 'no-credential') {
    $('#gate-error').textContent = 'لم تُسجَّل بصمة على هذا الجهاز';
  } else {
    $('#gate-error').textContent = 'تعذّر الفتح بالبصمة';
  }
}

// طلب تحقق سريع من المستخدم (قبل تغيير القفل أو إطفائه).
const VERIFY_GRACE_MS = 20_000;

/**
 * طلب تحقق سريع من المستخدم قبل تغيير القفل.
 * - تغيير الطريقة: يُتجاوز الطلب إن كان قد فتح التطبيق بنفسه قبل أقل من ٢٠ ثانية.
 * - إطفاء القفل (strict): يُطلب التحقق دائمًا لأنه يزيل التشفير نهائيًا.
 */
async function requestUnlockVerification({ strict = false } = {}) {
  if (!lock.isEnabled()) return true;
  if (!strict && lock.isUnlocked() && Date.now() - lock.lastUnlockAt() < VERIFY_GRACE_MS) return true;
  const ok = await showGate({ mode: 'verify', allowCancel: true });
  return ok === true;
}

// ---------------------------------------------------------------- إعدادات الأمان

function relockLabel(ms) {
  if (ms <= 0) return 'فوري';
  if (ms < 60_000) return `${Math.round(ms / 1000)} ثانية`;
  return `${Math.round(ms / 60_000)} دقيقة`;
}

function renderLockUI() {
  const s = lock.getState();
  $('#lock-status').textContent = s.enabled
    ? `مفعّل — ${lock.methodLabel()}${s.encrypted ? ' • البيانات مشفّرة' : ' • بلا تشفير'}`
    : 'غير مفعّل';
  $('#btn-lock-toggle').textContent = s.enabled ? 'إدارة' : 'تفعيل';
  $('#lock-methods').hidden = !state.lockChoosing;
  $$('#lock-methods .chip-btn').forEach((btn) => {
    btn.classList.toggle('active', s.enabled && btn.dataset.method === s.method);
  });
  $('#chip-biometric').textContent = s.hasBiometric ? 'بصمة الجهاز (مسجّلة)' : 'بصمة الجهاز';

  const relockWrap = $('#lock-relock-wrap');
  relockWrap.hidden = !s.enabled;
  const host = $('#lock-relock');
  host.innerHTML = '';
  [[0, 'فوري'], [30_000, '٣٠ ثانية'], [60_000, 'دقيقة'], [300_000, '٥ دقائق']].forEach(([ms, label]) => {
    const b = document.createElement('button');
    b.className = 'chip-btn' + (s.relockMs === ms ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', async () => {
      await lock.setRelockMs(ms);
      renderLockUI();
    });
    host.appendChild(b);
  });

  $('#btn-lock-now').hidden = !s.enabled;
  $('#btn-lock-off').hidden = !s.enabled;

  const hint = $('#lock-hint');
  if (!s.enabled) {
    hint.textContent = 'القفل يمنع فتح التطبيق على هذا الجهاز. الباترن/الرمز يُستخدم أيضًا '
      + 'لتشفير نص ملاحظاتك (AES-GCM) فلا تُقرأ من ملفات المتصفح بلا مفتاح.';
  } else if (!s.encrypted) {
    hint.textContent = 'تنبيه: جهازك لا يدعم استخراج مفتاح من البصمة (WebAuthn PRF)، لذا القفل '
      + 'حاجز ضد الفتح العابر فقط دون تشفير. للحماية الكاملة استخدم رمزًا سريًا أو باترن.';
  } else {
    hint.textContent = `احفظ ${lock.methodLabel()} في مكان آمن: لا يمكن استرجاع الملاحظات إن نسيته، `
      + 'ولن يستطيع أحد (ولا نحن) فتحها بدونه.';
  }
}

/** إعداد الباترن: رسم ثم تأكيد. */
async function startPatternSetup() {
  if (lock.isEnabled() && !(await requestUnlockVerification())) return;
  state.setupStage = 0;
  state.setupFirst = null;
  state.setupPattern = null;
  openSheet('#sheet-lock-setup');
  $('#setup-title').textContent = 'ارسم باترن جديد';
  $('#setup-sub').textContent = 'اربط ٤ نقاط على الأقل';
  $('#setup-error').textContent = '';

  const host = $('#setup-pattern-host');
  if (state.setupPattern) state.setupPattern.destroy();
  state.setupPattern = createPatternPad(host, {
    minDots: 4,
    onComplete: async (result) => {
      if (!result.ok) {
        $('#setup-error').textContent = 'اربط ٤ نقاط على الأقل';
        return;
      }
      $('#setup-error').textContent = '';
      if (state.setupStage === 0) {
        state.setupFirst = result.pattern;
        state.setupStage = 1;
        $('#setup-title').textContent = 'أعد رسم الباترن للتأكيد';
        $('#setup-sub').textContent = 'يجب أن يتطابق الرسمان';
        return;
      }
      if (result.pattern !== state.setupFirst) {
        state.setupStage = 0;
        state.setupFirst = null;
        $('#setup-title').textContent = 'ارسم باترن جديد';
        $('#setup-error').textContent = 'الرسمان غير متطابقين — أعد المحاولة';
        return;
      }
      await lock.setupSecret('pattern', result.pattern, { relockMs: lock.getState().relockMs });
      state.lockChoosing = false;
      closeSheets();
      toast('تم تفعيل القفل بالباترن — البيانات الآن مشفّرة');
      await refreshNotes();
      renderLockUI();
    },
  });
}

/** إعداد رمز سري (٦ أرقام على الأقل) — أقوى من الباترن. */
async function startPinSetup() {
  if (lock.isEnabled() && !(await requestUnlockVerification())) return;
  const pin = await promptDialog({
    title: 'رمز سري جديد',
    body: '٦ أرقام على الأقل. يُشفَّر به نص ملاحظاتك، ولا يمكن استرجاعه إن نسيته.',
    placeholder: '••••••',
    type: 'password',
    confirmText: 'متابعة',
    validate: (v) => (/^\d{6,}$/.test(v) ? null : 'أدخل ٦ أرقام أو أكثر'),
  });
  if (!pin) return;
  const again = await promptDialog({
    title: 'تأكيد الرمز',
    body: 'أعد إدخال الرمز نفسه',
    placeholder: '••••••',
    type: 'password',
    validate: (v) => (v === pin ? null : 'الرمزان غير متطابقين'),
  });
  if (!again) return;
  await lock.setupSecret('pin', pin, { relockMs: lock.getState().relockMs });
  state.lockChoosing = false;
  toast('تم تفعيل القفل بالرمز السري — البيانات الآن مشفّرة');
  await refreshNotes();
  renderLockUI();
}

/** إعداد القفل بالبصمة. */
async function startBiometricSetup() {
  if (lock.isEnabled() && !(await requestUnlockVerification())) return;
  const available = await lock.checkPlatformAuthenticator();
  if (!available) {
    toast('لا يوجد قارئ بصمة/وجه متاح في هذا المتصفح أو الجهاز', 4000);
    return;
  }
  toast('اطلب من جهازك بصمتك للتسجيل…', 2500);
  const result = await lock.setupBiometric({ relockMs: lock.getState().relockMs });
  if (!result.ok) {
    toast(result.reason === 'cancelled' ? 'أُلغيت العملية' : 'تعذّر تسجيل البصمة', 3500);
    return;
  }
  await refreshNotes();
  renderLockUI();
  if (result.encrypted) {
    toast('تم تفعيل القفل بالبصمة — البيانات مشفّرة بمفتاح من الجهاز');
  } else {
    toast('تم تفعيل القفل بالبصمة (حاجز فقط): جهازك لا يدعم استخراج مفتاح تشفير', 5000);
  }
}

async function disableLockFlow() {
  if (!(await requestUnlockVerification({ strict: true }))) return;
  const ok = await confirmDialog({
    title: 'إطفاء القفل',
    body: 'سيُلغى التشفير وتُكتب الملاحظات بلا حماية على هذا الجهاز. متابعة؟',
    confirmText: 'إطفاء',
    danger: true,
  });
  if (!ok) return;
  await lock.disableLock();
  state.lockChoosing = false;
  await refreshNotes();
  renderLockUI();
  toast('أُطفئ القفل وأُزيل التشفير');
}

function bindLockControls() {
  $('#btn-lock-toggle').addEventListener('click', () => {
    state.lockChoosing = !state.lockChoosing;
    renderLockUI();
  });
  // أي نقرة على صف القفل تفتح قائمة الطرق إن كانت مغلقة
  $$('#lock-methods .chip-btn').forEach((btn) => btn.addEventListener('focus', () => {
    if (!state.lockChoosing) { state.lockChoosing = true; renderLockUI(); }
  }));
  $$('#lock-methods .chip-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const method = btn.dataset.method;
      if (method === 'pattern') await startPatternSetup();
      else if (method === 'pin') await startPinSetup();
      else await startBiometricSetup();
    });
  });
  $('#setup-cancel').addEventListener('click', () => {
    closeSheets();
    state.setupStage = 0;
    state.setupFirst = null;
    if (state.setupPattern) { state.setupPattern.destroy(); state.setupPattern = null; }
  });
  $('#btn-lock-now').addEventListener('click', () => {
    lock.lockNow();
    appStarted = false;
    closeSheets();
    showGate({ mode: 'unlock', reason: 'manual' }).then(() => enterApp());
  });
  $('#btn-lock-off').addEventListener('click', disableLockFlow);
  $('#gate-cancel').addEventListener('click', () => {
    const resolve = state.gateResolve;
    state.gateResolve = null;
    hideGate();
    resolve?.(false);
  });
  $('#gate-pin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handleGateSecret($('#gate-pin').value.trim());
  });
  $('#gate-bio').addEventListener('click', handleGateBiometric);
}

// ---------------------------------------------------------------- التشغيل

let appStarted = false;

/** يبدأ عرض الملاحظات بعد نجاح الفتح (أو عند عدم وجود قفل). */
async function enterApp() {
  if (appStarted) return;
  appStarted = true;
  await refreshNotes();
  // فتح ملاحظة مباشرة عبر الرابط (#note-3) — بعد الفتح فقط
  const match = location.hash.match(/^#note-(\d+)$/);
  if (match) {
    const id = Number(match[1]);
    if (await getNote(id)) await openEditor(id);
  }
}

async function boot() {
  const result = await init();
  state.settings = await getSettings();
  state.sortMode = state.settings.sortMode || 'newest';
  applyAppearance();

  if (!result.persistent) {
    const banner = $('#banner-storage');
    banner.hidden = false;
    banner.textContent = 'التخزين الدائم غير متاح هنا (معاينة مقيّدة أو تصفح خاص): التعديلات لن تُحفظ بعد الإغلاق. افتح الملف من استضافة https لتجربة الحفظ الكامل.';
  }

  state.editor = new RichEditor({
    contentEl: $('#editor'),
    titleEl: $('#note-title'),
    onStatusChange: setSaveStatus,
    onCountsChange: renderCounts,
    onSave: async ({ title, html }) => {
      if (state.currentId == null) return;
      await patchNote(state.currentId, { title, contentHtml: html });
    },
  });

  bindEvents();
  bindLockControls();
  watchAppbarHeight();
  renderSortChips();
  registerServiceWorker();

  // القفل أولًا: لا تُعرض أي ملاحظة قبل التحقق
  const lockState = await lock.init();
  renderLockUI();
  if (lockState.enabled && !lockState.unlocked) {
    showGate({ mode: 'unlock', reason: 'startup' }).then((ok) => { if (ok) enterApp(); });
  } else {
    await enterApp();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) return;
  // لا تعتمد على حدث load وحده: قد يكون انقضى قبل وصولنا هنا
  const start = async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('نسخة جديدة جاهزة — أعد تحميل الصفحة', 4000);
          }
        });
      });
    } catch (e) {
      console.warn('[daftar] تعذّر تسجيل Service Worker', e);
    }
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installEvent = event;
  $('#btn-install').hidden = false;
  toast('يمكنك تثبيت «دفتر» كتطبيق على جهازك', 3500);
});

window.addEventListener('appinstalled', () => {
  state.installEvent = null;
  toast('تم تثبيت التطبيق ✓');
});

document.addEventListener('DOMContentLoaded', boot);
