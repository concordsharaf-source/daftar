package com.daftar.notes.ui.screens

/*
 * شريط تنسيق المحرر وأزراره + لوحات الألوان ودوال المساعدة اللونية.
 * فُصلت من EditorScreen.kt (كان ~1800 سطر) لتسهيل القراءة والتعديل.
 */

import android.content.Intent
import android.widget.Toast
import com.daftar.notes.security.AppLockManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FormatShapes
import androidx.compose.material.icons.filled.FormatColorFill
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.FormatListBulleted
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Colorize
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.FormatUnderlined
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.daftar.notes.ui.components.NoteColorPalette
import com.daftar.notes.ui.components.PaperBackground
import com.daftar.notes.ui.theme.DaftarFonts
import com.mohamedrejeb.richeditor.model.RichTextState
import com.mohamedrejeb.richeditor.model.rememberRichTextState
import com.mohamedrejeb.richeditor.ui.material3.RichTextEditor
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Palette of highlight and text colors for the formatting toolbar. */
internal val HIGHLIGHT_COLORS = listOf(
    Color(0xFFFFF176),
    Color(0xFFFFCC80),
    Color(0xFFA5D6A7),
    Color(0xFF90CAF9),
    Color(0xFFFFB3BA),
    Color(0xFFD1C4E9)
)

internal val TEXT_COLORS = listOf(
    Color(0xFF000000),
    Color(0xFFE53935),
    Color(0xFF1E88E5),
    Color(0xFF2E7D32),
    Color(0xFF6A1B9A),
    Color(0xFFEF6C00)
)

internal fun toHex(color: Color): String =
    String.format(
        "#%02X%02X%02X",
        color.redInt(),
        color.greenInt(),
        color.blueInt()
    )

internal fun Color.redInt(): Int =
    (red * 255).toInt().coerceIn(0, 255)

internal fun Color.greenInt(): Int =
    (green * 255).toInt().coerceIn(0, 255)

internal fun Color.blueInt(): Int =
    (blue * 255).toInt().coerceIn(0, 255)

internal fun applyHeading(
    state: RichTextState,
    fontSizeSp: Int?
) {

    val h1 =
        androidx.compose.ui.text.SpanStyle(
            fontWeight = FontWeight.Bold,
            fontSize = 26.sp
        )

    val h2 =
        androidx.compose.ui.text.SpanStyle(
            fontWeight = FontWeight.Bold,
            fontSize = 22.sp
        )

    if (fontSizeSp == null) {

        state.removeSpanStyle(h1)
        state.removeSpanStyle(h2)

    } else if (fontSizeSp == 26) {

        state.removeSpanStyle(h2)
        state.toggleSpanStyle(h1)

    } else {

        state.removeSpanStyle(h1)
        state.toggleSpanStyle(h2)
    }
}

/** Compact format toolbar. */
@Composable
internal fun FormattingToolbar(
    richState: RichTextState,
    fontFamily: FontFamily,
    colors: androidx.compose.material3.ColorScheme,
    showColorPicker: Boolean,
    showHighlightPicker: Boolean,
    isUnorderedListActive: Boolean,
    isOrderedListActive: Boolean,
    onToggleBold: () -> Unit,
    onToggleItalic: () -> Unit,
    onToggleUnderline: () -> Unit,
    onHeading1: () -> Unit,
    onHeading2: () -> Unit,
    onNormal: () -> Unit,
    onBulletList: () -> Unit,
    onNumberedList: () -> Unit,
    onToggleHighlightPicker: () -> Unit,
    onApplyHighlight: (String) -> Unit,
    onToggleColorPicker: () -> Unit,
    onApplyColor: (String) -> Unit
) {

    val currentSpan =
        richState.currentSpanStyle

    Box(

        modifier = Modifier
            .fillMaxWidth()
            .background(
                colors.surface.copy(alpha = 0.92f)
            )
            .padding(
                vertical = 3.dp,
                horizontal = 4.dp
            )
    ) {

        Row(

            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(
                    rememberScrollState()
                ),

            horizontalArrangement =
                Arrangement.spacedBy(1.dp),

            verticalAlignment =
                Alignment.CenterVertically
        ) {

            ToolbarButton(

                icon = Icons.Default.FormatBold,

                label = "غامق",

                active =
                    currentSpan.fontWeight ==
                        FontWeight.Bold,

                onClick = onToggleBold
            )

            ToolbarButton(

                icon = Icons.Default.FormatItalic,

                label = "مائل",

                active =
                    currentSpan.fontStyle ==
                        androidx.compose.ui.text.font.FontStyle.Italic,

                onClick = onToggleItalic
            )

            ToolbarButton(

                icon =
                    Icons.Default.FormatUnderlined,

                label = "تسطير",

                active =
                    currentSpan.textDecoration
                        ?.contains(
                            androidx.compose.ui.text.style.TextDecoration.Underline
                        ) == true,

                onClick = onToggleUnderline
            )

            ToolbarTextButton(
                label = "ع1",
                active =
                    currentSpan.fontSize == 26.sp,
                onClick = onHeading1
            )

            ToolbarTextButton(
                label = "ع2",
                active =
                    currentSpan.fontSize == 22.sp,
                onClick = onHeading2
            )

            ToolbarTextButton(
                label = "عادي",
                active =
                    currentSpan.fontSize == null,
                onClick = onNormal
            )

            ToolbarButton(

                icon =
                    Icons.Filled.FormatListBulleted,

                                label = "تعداد نقطي",
                active = isUnorderedListActive,
                onClick = onBulletList
            )

            ToolbarButton(

                icon =
                    Icons.Filled.FormatListNumbered,

                                label = "تعداد مرقم",
                active = isOrderedListActive,
                onClick = onNumberedList
            )

            ToolbarButton(

                icon =
                    Icons.Filled.FormatShapes,

                label = "تمييز",

                active = showHighlightPicker,

                onClick =
                    onToggleHighlightPicker
            )

            ToolbarButton(

                icon =
                    Icons.Default.FormatColorFill,

                label = "لون",

                active = showColorPicker,

                onClick = onToggleColorPicker
            )
        }
    }
}

@Composable
internal fun ToolbarButton(
    icon: ImageVector,
    label: String,
    active: Boolean,
    onClick: () -> Unit
) {

    val colors =
        MaterialTheme.colorScheme

    IconButton(

        onClick = onClick,

        modifier =
            Modifier.size(34.dp)
    ) {

        Icon(

            icon,

            contentDescription = label,

            tint =
                if (active) {
                    colors.primary
                } else {
                    colors.onSurfaceVariant
                },

            modifier =
                Modifier.size(19.dp)
        )
    }
}

@Composable
internal fun ToolbarTextButton(
    label: String,
    active: Boolean,
    onClick: () -> Unit
) {

    val colors =
        MaterialTheme.colorScheme

    Text(

        text = label,

        fontFamily =
            DaftarFonts.Cairo,

        fontSize = 12.sp,

        color =
            if (active) {
                colors.primary
            } else {
                colors.onSurfaceVariant
            },

        fontWeight =
            if (active) {
                FontWeight.Bold
            } else {
                FontWeight.Medium
            },

        modifier = Modifier
            .clip(
                RoundedCornerShape(6.dp)
            )
            .clickable(
                onClick = onClick
            )
            .padding(
                horizontal = 7.dp,
                vertical = 7.dp
            )
    )
}

@Composable
internal fun PickerButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit
) {

    val colors =
        MaterialTheme.colorScheme

    Column(

        horizontalAlignment =
            Alignment.CenterHorizontally,

        modifier = Modifier
            .clip(
                RoundedCornerShape(12.dp)
            )
            .clickable(
                onClick = onClick
            )
            .background(
                colors.surfaceVariant
            )
            .padding(
                horizontal = 20.dp,
                vertical = 14.dp
            )
    ) {

        Icon(
            icon,
            contentDescription = label,
            tint = colors.primary
        )

        Spacer(
            modifier =
                Modifier.height(4.dp)
        )

        Text(
            text = label,
            fontFamily = DaftarFonts.Cairo,
            fontSize = 13.sp,
            color = colors.onSurface
        )
    }
}
