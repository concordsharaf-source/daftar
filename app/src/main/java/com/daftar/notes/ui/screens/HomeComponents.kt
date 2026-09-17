package com.daftar.notes.ui.screens

/*
 * مكوّنات شاشة القائمة الرئيسية (صفوف، عناوين أقسام، قائمة خيارات الملاحظة،
 * صفوف النسخ الاحتياطي). فُصلت من HomeScreen.kt لتقليل حجم الملف وتسهيل التعديل.
 */

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ColorLens
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SearchBar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.daftar.notes.app.AppContainer
import com.daftar.notes.data.Note
import com.daftar.notes.data.NoteImage
import com.daftar.notes.ui.components.NoteCard
import com.daftar.notes.ui.components.NoteColorPalette
import com.daftar.notes.ui.theme.DaftarFonts
import com.daftar.notes.security.AppLockManager
import com.daftar.notes.util.BackupManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun SearchResultItem(row: NoteRow, query: String, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .background(colors.surface)
            .padding(14.dp)
    ) {
        val annotatedTitle = remember(row.note.id, query) {
            highlightQuery(row.note.title.ifBlank { "بدون عنوان" }, query)
        }
        Text(
            text = annotatedTitle,
            fontFamily = DaftarFonts.Cairo,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = colors.onSurface
        )
        val plainText = com.daftar.notes.util.TextUtils.stripHtml(row.note.contentHtml)
        val snippet = com.daftar.notes.util.TextUtils.extractSearchSnippet(plainText, query)
        if (snippet.isNotBlank()) {
            val annotatedSnippet = remember(row.note.id, query, snippet) {
                highlightQuery(snippet, query)
            }
            Text(
                text = annotatedSnippet,
                fontFamily = DaftarFonts.Cairo,
                fontSize = 13.sp,
                color = colors.onSurfaceVariant,
                maxLines = 3,
                modifier = Modifier.padding(top = 3.dp)
            )
        }
    }
}

/** Paint every occurrence of the search query with a tinted background. */
internal fun highlightQuery(text: String, query: String): androidx.compose.ui.text.AnnotatedString {
    if (query.isBlank()) return androidx.compose.ui.text.AnnotatedString(text)
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return androidx.compose.ui.text.AnnotatedString(text)
    val lower = text.lowercase()
    return androidx.compose.ui.text.buildAnnotatedString {
        append(text)
        var start = 0
        while (true) {
            val idx = lower.indexOf(needle, start)
            if (idx < 0) break
            addStyle(
                style = androidx.compose.ui.text.SpanStyle(
                    background = androidx.compose.ui.graphics.Color(0xFFFFF176),
                    color = androidx.compose.ui.graphics.Color.Black,
                    fontWeight = FontWeight.Bold
                ),
                start = idx,
                end = idx + needle.length
            )
            start = idx + needle.length
        }
    }
}

@Composable
internal fun TrashRow(note: Note, onRestore: () -> Unit, onDelete: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    NoteCard(
        note = note,
        images = emptyList(),
        searchQuery = "",
        isFavorite = note.isFavorite,
        isPinned = false,
        onClick = { onRestore() },
        onLongPress = {}
    )
    Row {
        TextButton(onClick = onRestore) {
            Icon(Icons.Default.RestoreFromTrash, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.size(4.dp))
            Text("استعادة", fontFamily = DaftarFonts.Cairo)
        }
        Spacer(modifier = Modifier.weight(1f))
        TextButton(
            onClick = onDelete,
            colors = ButtonDefaults.textButtonColors(contentColor = colors.error)
        ) {
            Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp), tint = colors.error)
            Spacer(modifier = Modifier.size(4.dp))
            Text("حذف نهائي", fontFamily = DaftarFonts.Cairo, color = colors.error)
        }
    }
}

@Composable
internal fun SectionHeader(title: String, count: Int) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            Icons.Default.PushPin,
            contentDescription = null,
            tint = colors.primary,
            modifier = Modifier.size(18.dp)
        )
        Spacer(modifier = Modifier.size(6.dp))
        Text(
            text = title,
            fontFamily = DaftarFonts.Cairo,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = colors.onSurface
        )
        Text(
            text = "($count)",
            fontFamily = DaftarFonts.Cairo,
            fontSize = 13.sp,
            color = colors.onSurfaceVariant,
            modifier = Modifier.padding(start = 6.dp)
        )
    }
}

@Composable
internal fun NoteOverflowMenu(
    noteId: Long,
    noteTitle: String,
    noteStatus: String,
    noteContentText: String,
    expanded: Boolean,
    onDismiss: () -> Unit,
    onPin: () -> Unit,
    onFavorite: () -> Unit,
    isFavorite: Boolean,
    onColor: () -> Unit,
    onToggleStatus: () -> Unit,
    onDelete: () -> Unit,
    onShare: (android.content.Intent) -> Unit
) {
    val colors = MaterialTheme.colorScheme
    val context = LocalContext.current
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text("تثبيت / إلغاء التثبيت", fontFamily = DaftarFonts.Cairo) },
            onClick = { onPin(); onDismiss() },
            leadingIcon = { Icon(Icons.Default.PushPin, contentDescription = null) }
        )
        DropdownMenuItem(
            text = { Text(if (isFavorite) "إزالة من المفضلة" else "إضافة للمفضلة", fontFamily = DaftarFonts.Cairo) },
            onClick = { onFavorite(); onDismiss() },
            leadingIcon = { Icon(if (isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder, contentDescription = null) }
        )
        DropdownMenuItem(
            text = { Text("تغيير اللون", fontFamily = DaftarFonts.Cairo) },
            onClick = { onColor(); onDismiss() },
            leadingIcon = { Icon(Icons.Default.ColorLens, contentDescription = null) }
        )
        DropdownMenuItem(
            text = {
                Text(
                    if (noteStatus == "done") "إعادة إلى المسودة" else "تحديد كمنجز",
                    fontFamily = DaftarFonts.Cairo
                )
            },
            onClick = { onToggleStatus(); onDismiss() },
            leadingIcon = { Icon(Icons.Default.CheckCircle, contentDescription = null, tint = colors.primary) }
        )
        DropdownMenuItem(
            text = { Text("مشاركة", fontFamily = DaftarFonts.Cairo) },
            onClick = {
                onDismiss()
                val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(android.content.Intent.EXTRA_TEXT, "$noteTitle\n\n$noteContentText")
                    if (noteTitle.isNotBlank()) putExtra(android.content.Intent.EXTRA_SUBJECT, noteTitle)
                }
                onShare(intent)
            },
            leadingIcon = { Icon(Icons.Default.Share, contentDescription = null) }
        )
        HorizontalDivider()
        DropdownMenuItem(
            text = { Text("حذف", fontFamily = DaftarFonts.Cairo, color = colors.error) },
            onClick = { onDelete(); onDismiss() },
            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = colors.error) }
        )
    }
}

@Composable
internal fun ExportOptionRow(
    icon: ImageVector,
    label: String,
    description: String,
    onClick: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .background(colors.surfaceVariant)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = colors.primary)
        Spacer(modifier = Modifier.size(12.dp))
        Column {
            Text(label, fontFamily = DaftarFonts.Cairo, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = colors.onSurface)
            Text(description, fontFamily = DaftarFonts.Cairo, fontSize = 12.sp, color = colors.onSurfaceVariant)
        }
    }
}

internal fun sortLabel(mode: String): String = when (mode) {
    "oldest" -> "الأقدم"
    "alpha" -> "أبجدي (A-Z)"
    "alphaAr" -> "أبجدي عربي"
    else -> "الأحدث"
}
