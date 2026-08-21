package com.daftar.notes.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import com.daftar.notes.R

// ---- Brand palette (deep ink blue + warm parchment) ----
val Ink = Color(0xFF0F4C75)
val InkDark = Color(0xFF0A3554)
val Parchment = Color(0xFFFDF8EE)
val ParchmentDark = Color(0xFF121212)

val LightColors = lightColorScheme(
    primary = Ink,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD3E3EE),
    onPrimaryContainer = Color(0xFF0B3A5A),
    secondary = Color(0xFF8C6A45),
    onSecondary = Color.White,
    background = Parchment,
    onBackground = Color(0xFF2B2B2B),
    surface = Color(0xFFF7F2E6),
    onSurface = Color(0xFF2B2B2B),
    surfaceVariant = Color(0xFFEDE6D6),
    onSurfaceVariant = Color(0xFF5C5850),
    outline = Color(0xFFC9C0AE),
    outlineVariant = Color(0xFFDDD4C2),
    error = Color(0xFFB3261E)
)

val DarkColors = darkColorScheme(
    primary = Color(0xFF9DC4E2),
    onPrimary = InkDark,
    primaryContainer = Color(0xFF2A5C7E),
    onPrimaryContainer = Color(0xFFD6E6F2),
    secondary = Color(0xFFD9B98C),
    onSecondary = Color(0xFF3A2A16),
    background = ParchmentDark,
    onBackground = Color(0xFFECEBE6),
    surface = Color(0xFF1C1C1C),
    onSurface = Color(0xFFECEBE6),
    surfaceVariant = Color(0xFF2A2A2A),
    onSurfaceVariant = Color(0xFFBDB7AC),
    outline = Color(0xFF4A4842),
    outlineVariant = Color(0xFF3A3833),
    error = Color(0xFFFFB4AB)
)

/** Registered Arabic font families with OFL licenses (Google Fonts). */
object DaftarFonts {
    val Cairo = FontFamily(
        Font(R.font.cairo_regular, FontWeight.Normal),
        Font(R.font.cairo_bold, FontWeight.Bold)
    )
    val Tajawal = FontFamily(
        Font(R.font.tajawal_regular, FontWeight.Normal),
        Font(R.font.tajawal_bold, FontWeight.Bold)
    )
    val NotoSansArabic = FontFamily(
        Font(R.font.notosansarabic_regular, FontWeight.Normal),
        Font(R.font.notosansarabic_bold, FontWeight.Bold)
    )
    val NotoNaskhArabic = FontFamily(
        Font(R.font.notonaskharabic_regular, FontWeight.Normal),
        Font(R.font.notonaskharabic_bold, FontWeight.Bold)
    )
    val Amiri = FontFamily(Font(R.font.amiri_regular, FontWeight.Normal))
}

/** Available fonts for the user picker, grouped by category. */
sealed class FontCategory(val displayName: String) {
    abstract val fonts: List<AvailableFont>

    object ModernOfficial : FontCategory("خطوط رسمية حديثة") {
        override val fonts = listOf(
            AvailableFont("Cairo", "القاهرة", DaftarFonts.Cairo),
            AvailableFont("Tajawal", "تجوال", DaftarFonts.Tajawal),
            AvailableFont("Noto Sans Arabic", "نوتو سنس عربي", DaftarFonts.NotoSansArabic)
        )
    }

    object NaskhReading : FontCategory("خطوط النسخ والقراءة") {
        override val fonts = listOf(
            AvailableFont("Noto Naskh Arabic", "نوتو نسخ عربي", DaftarFonts.NotoNaskhArabic),
            AvailableFont("Amiri", "أميري", DaftarFonts.Amiri)
        )
    }

    val all: List<AvailableFont> get() = fonts
}

object DaftarFontCatalog {
    private val categoryList: List<FontCategory> =
        listOf(FontCategory.ModernOfficial, FontCategory.NaskhReading)
    val all: List<AvailableFont> = categoryList.flatMap { it.fonts }
    val categories: List<FontCategory> = categoryList
    val default: AvailableFont = FontCategory.ModernOfficial.fonts[0]
}

data class AvailableFont(
    val key: String,
    val displayName: String,
    val family: FontFamily
)

// Local provider for the currently selected font family
val LocalNoteFont = staticCompositionLocalOf { DaftarFonts.Cairo }
