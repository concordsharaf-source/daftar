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
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------- أدوات واجهة

function toast(message, ms = 2200) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

/** حوار تأكيد بسيط يعيد Promise<boolean>. */
function confirmDialog({ title, body, confirmText = 'تأكيد', danger = false }) {
  return new Promise((resolve) => {
    const dlg = $('#dialog-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    ok.textContent = confirmText;
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

  // إخفاء الواجهة عند مغادرة الصفحة بعد الحفظ الفوري
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.editor?.hasUnsaved) state.editor.save();
  });
}

function refreshToolbarState() {
  ['insertUnorderedList', 'insertOrderedList'].forEach((cmd) => {
    const btn = document.querySelector(`#toolbar [data-cmd="${cmd}"]`);
    if (!btn) return;
    try { btn.classList.toggle('active', document.queryCommandState(cmd)); } catch { /* غير مدعوم */ }
  });
}

// ---------------------------------------------------------------- التشغيل

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
    onSave: async ({ title, html }) => {
      if (state.currentId == null) return;
      await patchNote(state.currentId, { title, contentHtml: html });
    },
  });

  bindEvents();
  renderSortChips();
  await refreshNotes();

  // فتح ملاحظة مباشرة عبر الرابط (#note-3)
  const match = location.hash.match(/^#note-(\d+)$/);
  if (match) {
    const id = Number(match[1]);
    if (await getNote(id)) await openEditor(id);
  }

  registerServiceWorker();
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
