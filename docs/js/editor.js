/*
 * المحرر الغني — مكافئ riche-editor + EditorViewModel في نسخة أندرويد.
 *
 * يخزّن HTML في حقل contentHtml تمامًا كالنسخة الأصلية، لذا تبقى الملاحظات
 * المتبادلة (نسخ احتياطي/استيراد) قابلة للقراءة في النسختين.
 *
 * الحفظ: تلقائي بعد 750ms من آخر تعديل، مع إمكانية الحفظ الفوري عند الخروج.
 * التراجع: مكدس لقطات (حد 50) بأخذ لقطة تلقائية أثناء الكتابة كما في الأصل.
 */

import { sanitizeHtml, debounce } from './util.js';

const MAX_STACK = 50;
const SNAPSHOT_DELAY = 1500; // لقطة واحدة أثناء الكتابة المتواصلة
const SAVE_DELAY = 750;      // debounce الحفظ (نفس النسخة الأصلية)

export class RichEditor {
  constructor({ contentEl, titleEl, onSave, onStatusChange }) {
    this.contentEl = contentEl;
    this.titleEl = titleEl;
    this.onSave = onSave;
    this.onStatusChange = onStatusChange || (() => {});

    this.undoStack = [];
    this.redoStack = [];
    this.lastSnapshotHtml = null;
    this.lastSnapshotTitle = null;
    this.pendingSnapshot = null;
    this.applyingRemote = false;
    this.dirty = false;
    this.lastSavedHtml = '';
    this.lastSavedTitle = '';

    this.snapshotTimer = null;
    this.saveTimer = null;
    this.statusTimer = null;

    this._bind();
  }

  // ------------------------------------------------------------ ربط الأحداث

  _bind() {
    this.contentEl.setAttribute('contenteditable', 'true');
    this.contentEl.setAttribute('dir', 'rtl');
    this.contentEl.spellcheck = false;

    this.onInput = () => {
      if (this.applyingRemote) return;
      this._scheduleSnapshot();
      this._scheduleSave();
    };
    this.contentEl.addEventListener('input', this.onInput);
    this.titleEl.addEventListener('input', this.onInput);

    this.onPaste = (event) => {
      // اللصق: أبقِ التنسيق الآمن فقط
      const html = event.clipboardData?.getData('text/html');
      const text = event.clipboardData?.getData('text/plain') || '';
      event.preventDefault();
      if (html) {
        document.execCommand('insertHTML', false, sanitizeHtml(html));
      } else {
        document.execCommand('insertText', false, text);
      }
      this._scheduleSnapshot();
      this._scheduleSave();
    };
    this.contentEl.addEventListener('paste', this.onPaste);

    this.onKeydown = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 'b') { event.preventDefault(); this.exec('bold'); }
      else if (key === 'i') { event.preventDefault(); this.exec('italic'); }
      else if (key === 'u') { event.preventDefault(); this.exec('underline'); }
      else if (key === 'z' && !event.shiftKey) { event.preventDefault(); this.undo(); }
      else if (key === 'z' && event.shiftKey) { event.preventDefault(); this.redo(); }
      else if (key === 'y') { event.preventDefault(); this.redo(); }
    };
    this.contentEl.addEventListener('keydown', this.onKeydown);
  }

  destroy() {
    this.contentEl.removeEventListener('input', this.onInput);
    this.contentEl.removeEventListener('paste', this.onPaste);
    this.contentEl.removeEventListener('keydown', this.onKeydown);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.saveTimer);
    clearTimeout(this.statusTimer);
  }

  // ------------------------------------------------------------ المحتوى

  get html() { return this.contentEl.innerHTML; }

  get title() { return this.titleEl.value; }

  /** تحميل ملاحظة في المحرر (بلا تفعيل الحفظ التلقائي). */
  setDocument({ title = '', html = '' } = {}) {
    this.applyingRemote = true;
    this.titleEl.value = title;
    this.contentEl.innerHTML = html || '';
    this.applyingRemote = false;
    this.lastSavedHtml = html || '';
    this.lastSavedTitle = title;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.lastSnapshotHtml = html || '';
    this.lastSnapshotTitle = title;
    this.onStatusChange('idle');
  }

  // ------------------------------------------------------------ التنسيق

  exec(command, value = null) {
    this.contentEl.focus();
    this._snapshotNow();
    // مهم للتوافق مع تطبيق أندرويد:
    //  - العريض/المائل/التسطير كوسوم (b/i/u) لأن مُصدِّر PDF في الأندرويد يبحث
    //    عن الوسوم تحديدًا (element.select("b, strong")).
    //  - الألوان والتظليل كأنماط على span لأن مُصدِّر PDF يقرأ style="color/background".
    const styleFlags = ['foreColor', 'hiliteColor', 'backColor'];
    const useCss = styleFlags.includes(command);
    try {
      document.execCommand('styleWithCSS', false, useCss);
      document.execCommand(command, false, value);
    } finally {
      document.execCommand('styleWithCSS', false, false);
    }
    this._scheduleSave();
  }

  /** تلوين النص المحدّد. */
  setTextColor(color) { this.exec('foreColor', color); }

  /** تظليل النص المحدّد. */
  setHighlight(color) { this.exec('hiliteColor', color); }

  formatBlock(tag) { this.exec('formatBlock', tag); }

  insertHtml(html) {
    this.contentEl.focus();
    this._snapshotNow();
    document.execCommand('insertHTML', false, sanitizeHtml(html));
    this._scheduleSave();
  }

  // ------------------------------------------------------------ التراجع/الإعادة

  _capturePreEdit() {
    return { html: this.html, title: this.title };
  }

  /** لقطة فورية (عند أوامر التنسيق). */
  _snapshotNow() {
    const pre = this._capturePreEdit();
    if (pre.html === this.lastSnapshotHtml && pre.title === this.lastSnapshotTitle) return;
    this._pushSnapshot(pre);
  }

  /** لقطة مؤجلة أثناء الكتابة (1500ms) — نفس سلوك النسخة الأصلية. */
  _scheduleSnapshot() {
    const pre = this._capturePreEdit();
    if (pre.html === this.lastSnapshotHtml && pre.title === this.lastSnapshotTitle) return;
    if (this.pendingSnapshot && this.pendingSnapshot.html === pre.html && this.pendingSnapshot.title === pre.title) return;
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.pendingSnapshot = null;
      this._pushSnapshot(pre);
    }, SNAPSHOT_DELAY);
    this.pendingSnapshot = pre;
  }

  _pushSnapshot(snapshot) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_STACK) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnapshotHtml = snapshot.html;
    this.lastSnapshotTitle = snapshot.title;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    clearTimeout(this.snapshotTimer);
    this.pendingSnapshot = null;
    if (!this.undoStack.length) return;
    this.redoStack.push(this._capturePreEdit());
    const snap = this.undoStack.pop();
    this._applySnapshot(snap);
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this._capturePreEdit());
    const snap = this.redoStack.pop();
    this._applySnapshot(snap);
  }

  _applySnapshot(snapshot) {
    this.applyingRemote = true;
    this.titleEl.value = snapshot.title;
    this.contentEl.innerHTML = snapshot.html;
    this.applyingRemote = false;
    this.lastSnapshotHtml = snapshot.html;
    this.lastSnapshotTitle = snapshot.title;
    this.dirty = true;
    this._scheduleSave();
  }

  // ------------------------------------------------------------ الحفظ

  _scheduleSave() {
    this.dirty = true;
    this.onStatusChange('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save({ silent: false }), SAVE_DELAY);
  }

  /** حفظ فوري (عند الخروج من الشاشة). */
  async save({ silent = true } = {}) {
    clearTimeout(this.saveTimer);
    if (!this.dirty) {
      if (!silent) this.onStatusChange('saved');
      return false;
    }
    const html = this.html;
    const title = this.title;
    try {
      await this.onSave({ title, html });
      this.lastSavedHtml = html;
      this.lastSavedTitle = title;
      this.dirty = false;
      this.onStatusChange('saved');
      clearTimeout(this.statusTimer);
      this.statusTimer = setTimeout(() => this.onStatusChange('idle'), 2500);
      return true;
    } catch (e) {
      console.error('[daftar] فشل الحفظ', e);
      this.onStatusChange('idle');
      return false;
    }
  }

  /** هل هناك تغييرات غير محفوظة؟ */
  get hasUnsaved() { return this.dirty; }
}
