package com.daftar.notes.util

object TextUtils {
    /** Strip HTML tags to obtain plain text. */
    fun stripHtml(html: String): String {
        if (html.isBlank()) return ""
        var text = html
            .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</p>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</div>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</h[1-6]>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</li>", RegexOption.IGNORE_CASE), "\n")
        text = text.replace(Regex("<[^>]+>"), " ")
        text = text
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
        return text.lines().joinToString("\n") { it.trim() }
            .replace(Regex("\n{2,}"), "\n")
            .trim()
    }

    /** Extract a snippet with the matching word highlighted, for search results. */
    fun extractSearchSnippet(plainText: String, query: String, maxLength: Int = 120): String {
        if (plainText.isBlank()) return ""
        val idx = plainText.indexOf(query, ignoreCase = true)
        val start = if (idx >= 0) (idx - 40).coerceAtLeast(0) else 0
        val end = (start + maxLength).coerceAtMost(plainText.length)
        val snippet = plainText.substring(start, end)
        return (if (start > 0) "…" else "") + snippet + (if (end < plainText.length) "…" else "")
    }

    fun extractSnippet(html: String, maxLength: Int = 80): String {
        val plain = stripHtml(html)
        return if (plain.length <= maxLength) plain else plain.substring(0, maxLength).trimEnd() + "…"
    }

    /** Format a date like "21 أغسطس 2026، 09:45". */
    fun formatDateTime(millis: Long): String {
        val sdf = java.text.SimpleDateFormat("d MMMM yyyy، HH:mm", java.util.Locale("ar"))
        return sdf.format(java.util.Date(millis))
    }

    fun formatRelative(millis: Long): String {
        val now = System.currentTimeMillis()
        val diff = now - millis
        val minutes = diff / 60_000
        val hours = diff / 3_600_000
        val days = diff / 86_400_000
        return when {
            minutes < 1 -> "الآن"
            minutes < 60 -> "منذ $minutes دقيقة"
            hours < 24 -> "منذ $hours ساعة"
            days < 7 -> "منذ $days يوم"
            else -> formatDateTime(millis)
        }
    }
}
