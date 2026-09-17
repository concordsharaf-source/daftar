package com.daftar.notes.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * اختبارات دوال النصوص (JVM خالص، بلا أندرويد):
 * تجريد HTML، مقاطع البحث، وصياغة التواريخ النسبية بالعربية.
 */
class TextUtilsTest {

    @Test
    fun stripHtmlRemovesTagsAndKeepsText() {
        val html = "<p>مرحبًا <b>بك</b></p><p>سطر ثانٍ</p>"
        val plain = TextUtils.stripHtml(html)
        assertTrue(plain.contains("مرحبًا بك"))
        assertTrue(plain.contains("سطر ثانٍ"))
        assertTrue("لا يجب أن تبقى وسوم", !plain.contains("<"))
    }

    @Test
    fun stripHtmlConvertsMeaningfulBreaksToNewlines() {
        val plain = TextUtils.stripHtml("سطر<br>آخر")
        assertEquals("سطر\nآخر", plain)
    }

    @Test
    fun stripHtmlDecodesBasicEntities() {
        val plain = TextUtils.stripHtml("<p>أ &amp; ب &lt;ج&gt;</p>")
        assertTrue(plain.contains("أ & ب <ج>"))
    }

    @Test
    fun stripHtmlCollapsesExtraBlankLines() {
        val plain = TextUtils.stripHtml("<p>أ</p><p></p><p>ب</p>")
        assertTrue("لا فراغات مكررة", !plain.contains("\n\n"))
    }

    @Test
    fun stripHtmlOnBlankInputIsEmpty() {
        assertEquals("", TextUtils.stripHtml(""))
        assertEquals("", TextUtils.stripHtml("   "))
    }

    @Test
    fun searchSnippetCentersOnMatchWithEllipsis() {
        val text = "أ".repeat(100) + "ملاحظة مهمة" + "ب".repeat(100)
        val snippet = TextUtils.extractSearchSnippet(text, "مهمة")
        assertTrue(snippet.contains("مهمة"))
        assertTrue("يبدأ بثلاث نقاط عند وجود نص سابق", snippet.startsWith("…"))
        assertTrue("ينتهي بثلاث نقاط عند وجود نص لاحق", snippet.endsWith("…"))
    }

    @Test
    fun snippetIsTruncatedWithEllipsis() {
        val snippet = TextUtils.extractSnippet("<p>" + "ك".repeat(200) + "</p>", maxLength = 50)
        assertEquals(51, snippet.length) // 50 حرفًا + …
        assertTrue(snippet.endsWith("…"))
    }

    @Test
    fun relativeTimeIsArabicAndBucketed() {
        val now = System.currentTimeMillis()
        assertEquals("الآن", TextUtils.formatRelative(now))
        assertTrue(TextUtils.formatRelative(now - 5 * 60_000L).contains("دقيقة"))
        assertTrue(TextUtils.formatRelative(now - 3 * 3_600_000L).contains("ساعة"))
        assertTrue(TextUtils.formatRelative(now - 2 * 86_400_000L).contains("يوم"))
    }
}
