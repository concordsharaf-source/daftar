package com.daftar.notes.ui.components

import androidx.compose.ui.graphics.Color

/** Note label colors (soft paper tones that stay readable in light/dark). */
object NoteColorPalette {
    val options = listOf(
        Color(0xFFFFCC80), // برتقالي
        Color(0xFFFFE082), // أصفر
        Color(0xFFA5D6A7), // أخضر
        Color(0xFF80DEEA), // سماوي
        Color(0xFF90CAF9), // أزرق
        Color(0xFFCE93D8), // بنفسجي
        Color(0xFFEF9A9A)  // أحمر
    )

    val names = listOf(
        "برتقالي", "أصفر", "أخضر", "سماوي", "أزرق", "بنفسجي", "أحمر"
    )

    fun toHex(color: Color): String =
        String.format("#%02X%02X%02X", color.redInt(), color.greenInt(), color.blueInt())

    private fun Color.redInt(): Int = (red * 255).toInt().coerceIn(0, 255)
    private fun Color.greenInt(): Int = (green * 255).toInt().coerceIn(0, 255)
    private fun Color.blueInt(): Int = (blue * 255).toInt().coerceIn(0, 255)
}
