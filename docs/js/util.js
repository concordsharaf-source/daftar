/*
 * أدوات مساعدة — منقولة من تطبيق أندرويد (TextUtils.kt + HomeViewModel.kt)
 * لتوحيد السلوك بين النسختين (نفس تطبيع العربية، نفس تنسيق التواريخ).
 */

const HAMZA_MAP = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ي' };
const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

/** تطبيع العربية للترتيب الأبجدي: توحيد الهمزات وإزالة التشكيل والتطويل. */
export function normalizeArabic(text) {
  return [...(text || '')].map((ch) => HAMZA_MAP[ch] || ch).join('').replace(DIACRITICS, '');
}

/** تجريد HTML إلى نص عادي (مع دمج المسافات كما في النسخة الأصلية). */
export function stripHtml(html) {
  if (!html || !html.trim()) return '';
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00A0]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** مقطع مختصر لعرضه في بطاقة الملاحظة. */
export function snippet(html, max = 90) {
  const plain = stripHtml(html).replace(/\n/g, ' · ');
  return plain.length <= max ? plain : plain.slice(0, max).trimEnd() + '…';
}

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** تاريخ مطابق لصيغة النسخة الأصلية: «21 أغسطس 2026، 09:45». */
export function formatDateTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}، ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** تاريخ نسبي بالعربية: الآن / منذ X دقيقة / ساعة / يوم. */
export function formatRelative(ms) {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  if (hours < 24) return `منذ ${hours} ساعة`;
  if (days < 7) return `منذ ${days} يوم`;
  return formatDateTime(ms);
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return wrapped;
}

/**
 * تنظيف HTML القادم من اللصق أو من ملف نسخة احتياطية:
 * يحذف الوسوم الخطرة والسمات الحدثية و javascript: — مع الإبقاء على التنسيق.
 */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'B', 'I', 'U', 'S', 'STRIKE', 'STRONG', 'EM', 'MARK',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'A', 'IMG', 'BLOCKQUOTE',
  'PRE', 'CODE', 'FONT', 'SUB', 'SUP', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
]);

export function sanitizeHtml(html) {
  const host = document.createElement('div');
  host.innerHTML = String(html || '');
  host.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,svg').forEach((el) => el.remove());

  host.querySelectorAll('*').forEach((el) => {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      // استبدل الوسم غير المسموح بمحتواه النصي
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      return;
    }
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '');
      const isUrlAttr = ['href', 'src'].includes(name);
      if (name.startsWith('on') || name === 'srcdoc') el.removeAttribute(attr.name);
      else if (isUrlAttr && /^\s*(javascript|data:(?!image\/))/i.test(value)) el.removeAttribute(attr.name);
      else if (name === 'style' && /url\(|expression\(/i.test(value)) el.removeAttribute(attr.name);
    });
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return host.innerHTML;
}

/** هل النص المدخل يحتوي وسمًا فعليًا (لا نصًا عربيًا يشبه الوسوم)؟ */
export function looksLikeHtml(value) {
  return /<\/?(p|div|br|b|i|u|span|h[1-6]|ul|ol|li|img|blockquote|font|mark)\b/i.test(String(value || ''));
}
