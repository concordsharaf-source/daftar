package com.daftar.notes.ui.screens

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
import androidx.compose.material.icons.filled.ColorLens
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
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
import com.daftar.notes.util.BackupManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Compact wrapper around a note + its optional thumbnail path. */
private data class NoteRow(val note: Note, val thumbnailPath: String?) {
    fun noteImages(): List<NoteImage> =
        thumbnailPath?.let { listOf(NoteImage(noteId = note.id, filePath = it)) } ?: emptyList()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenNote: (Long) -> Unit,
    onOpenSettings: () -> Unit
) {
    val context = LocalContext.current
    val colors = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()

    val notes by viewModel.notes.collectAsState()
    val deletedNotes by viewModel.deletedNotes.collectAsState()

    val rows = remember(notes) { notes.map { NoteRow(it, null) } }
    val pinnedRows = rows.filter { it.note.isPinned }
    val regularRows = rows.filter { !it.note.isPinned }

    // UI state
    var expandedNoteId by remember { mutableStateOf<Long?>(null) }
    var deleteTarget by remember { mutableStateOf<Note?>(null) }
    var restoreTarget by remember { mutableStateOf<Note?>(null) }
    var colorTarget by remember { mutableStateOf<Note?>(null) }
    var showTrashSheet by remember { mutableStateOf(false) }
    var showExportSheet by remember { mutableStateOf(false) }
    var emptyTrashConfirm by remember { mutableStateOf(false) }
    var showBackupSheet by remember { mutableStateOf(false) }

    // Thumbnails (first image per note)
    var imageMap by remember { mutableStateOf<Map<Long, String?>>(emptyMap()) }
    LaunchedEffect(notes) {
        withContext(Dispatchers.IO) {
            val repo = AppContainer.get().notesRepository
            val map = mutableMapOf<Long, String?>()
            for (n in notes) {
                try {
                    map[n.id] = repo.getImagesOnce(n.id).firstOrNull()?.filePath
                } catch (_: Exception) {
                    map[n.id] = null
                }
            }
            withContext(Dispatchers.Main) { imageMap = map }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "دفتر",
                    fontFamily = DaftarFonts.Amiri,
                    fontWeight = FontWeight.Bold,
                    fontSize = 30.sp,
                    color = colors.primary
                )
                Spacer(modifier = Modifier.weight(1f))
                IconButton(onClick = { showExportSheet = true }) {
                    Icon(Icons.Default.Backup, contentDescription = "النسخ الاحتياطي")
                }
                IconButton(onClick = { showTrashSheet = true }) {
                    Icon(Icons.Default.RestoreFromTrash, contentDescription = "سلة المحذوفات")
                }
                IconButton(onClick = { onOpenSettings() }) {
                    Icon(Icons.Default.Settings, contentDescription = "الإعدادات")
                }
            }

            // Search bar (results shown only while active/expanded)
            var input by remember { mutableStateOf("") }
            var active by remember { mutableStateOf(false) }
            SearchBar(
                query = input,
                onQueryChange = { input = it; if (!it.isNotBlank()) { active = false; viewModel.search("") } },
                onSearch = { /* user pressed search — results stay visible while active */ },
                active = active,
                onActiveChange = { active = it; if (!it && input.isBlank()) viewModel.search("") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                placeholder = { Text("ابحث في ملاحظاتك…", fontFamily = DaftarFonts.Cairo) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (input.isNotEmpty()) {
                        IconButton(onClick = { input = ""; active = false; viewModel.search("") }) {
                            Icon(Icons.Default.Close, contentDescription = "مسح")
                        }
                    }
                },
                shape = RoundedCornerShape(24.dp)
            ) {
                val results = notes.filter {
                    it.title.contains(input, ignoreCase = true) ||
                        com.daftar.notes.util.TextUtils.stripHtml(it.contentHtml).contains(input, ignoreCase = true)
                }.map { NoteRow(it, imageMap[it.id]) }
                if (input.isNotBlank()) {
                    LazyColumn(modifier = Modifier.fillMaxWidth()) {
                        items(results) { row ->
                            SearchResultItem(
                                row = row,
                                query = input,
                                onClick = {
                                    active = false
                                    onOpenNote(row.note.id)
                                }
                            )
                        }
                    }
                }
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (pinnedRows.isNotEmpty()) {
                    item { SectionHeader(title = "المثبتة", count = pinnedRows.size) }
                    items(pinnedRows) { row ->
                        NoteCard(
                            note = row.note,
                            images = row.noteImages(),
                            searchQuery = "",
                            isFavorite = row.note.isFavorite,
                            isPinned = true,
                            onClick = { onOpenNote(row.note.id) },
                            onLongPress = { expandedNoteId = row.note.id }
                        )
                        NoteOverflowMenu(
                            noteId = row.note.id,
                            expanded = expandedNoteId == row.note.id,
                            onDismiss = { expandedNoteId = null },
                            onPin = { scope.launch { viewModel.togglePinned(row.note.id, false) } },
                            onFavorite = { scope.launch { viewModel.toggleFavorite(row.note.id, !row.note.isFavorite) } },
                            isFavorite = row.note.isFavorite,
                            onColor = { colorTarget = row.note },
                            onDelete = { deleteTarget = row.note }
                        )
                    }
                }

                if (pinnedRows.isNotEmpty() && regularRows.isNotEmpty()) {
                    item { Spacer(modifier = Modifier.height(6.dp)) }
                    item { SectionHeader(title = "الكل", count = regularRows.size) }
                }

                items(regularRows) { row ->
                    NoteCard(
                        note = row.note,
                        images = row.noteImages(),
                        searchQuery = "",
                        isFavorite = row.note.isFavorite,
                        isPinned = false,
                        onClick = { onOpenNote(row.note.id) },
                        onLongPress = { expandedNoteId = row.note.id }
                    )
                    NoteOverflowMenu(
                        noteId = row.note.id,
                        expanded = expandedNoteId == row.note.id,
                        onDismiss = { expandedNoteId = null },
                        onPin = { scope.launch { viewModel.togglePinned(row.note.id, true) } },
                        onFavorite = { scope.launch { viewModel.toggleFavorite(row.note.id, !row.note.isFavorite) } },
                        isFavorite = row.note.isFavorite,
                        onColor = { colorTarget = row.note },
                        onDelete = { deleteTarget = row.note }
                    )
                }

                if (rows.isEmpty()) {
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 80.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                text = "دفترك فارغ",
                                fontFamily = DaftarFonts.Cairo,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = colors.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = "اضغط زر + لإنشاء أول ملاحظة",
                                fontFamily = DaftarFonts.Cairo,
                                fontSize = 14.sp,
                                color = colors.onSurfaceVariant.copy(alpha = 0.7f)
                            )
                        }
                    }
                }

                // Bottom space for FAB
                item { Spacer(modifier = Modifier.height(96.dp)) }
            }
        }

        // FAB
        FloatingActionButton(
            onClick = {
                scope.launch {
                    val id = viewModel.createNote()
                    if (id > 0) {
                        withContext(Dispatchers.Main) { onOpenNote(id) }
                    }
                }
            },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(bottom = 24.dp, end = 24.dp)
                .navigationBarsPadding(),
            containerColor = colors.primary
        ) {
            Icon(Icons.Default.Add, contentDescription = "ملاحظة جديدة")
        }
    }

    // ---------- Trash sheet ----------
    if (showTrashSheet) {
        ModalBottomSheet(
            onDismissRequest = { showTrashSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp)
                    .navigationBarsPadding()
            ) {
                Text(
                    text = "سلة المحذوفات",
                    fontFamily = DaftarFonts.Cairo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = colors.onSurface
                )
                Spacer(modifier = Modifier.height(8.dp))
                if (deletedNotes.isEmpty()) {
                    Text(
                        text = "السلة فارغة",
                        fontFamily = DaftarFonts.Cairo,
                        fontSize = 14.sp,
                        color = colors.onSurfaceVariant
                    )
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(deletedNotes) { note ->
                            TrashRow(
                                note = note,
                                onRestore = { restoreTarget = note },
                                onDelete = { deleteTarget = note }
                            )
                        }
                    }
                    HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
                    OutlinedButton(
                        onClick = { emptyTrashConfirm = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.DeleteSweep, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.size(6.dp))
                        Text("إفراغ السلة", fontFamily = DaftarFonts.Cairo)
                    }
                }
            }
        }
    }

    // ---------- Backup/export sheet ----------
    if (showExportSheet) {
        ModalBottomSheet(
            onDismissRequest = { showExportSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp)
                    .navigationBarsPadding(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "النسخ الاحتياطي",
                    fontFamily = DaftarFonts.Cairo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp
                )
                ExportOptionRow(
                    icon = Icons.Default.Backup,
                    label = "إنشاء نسخة احتياطية",
                    description = "تصدير كل الملاحظات إلى ملف يمكن استعادته لاحقاً"
                ) {
                    scope.launch {
                        try {
                            val path = BackupManager.createBackup(context, AppContainer.get().notesRepository)
                            val file = java.io.File(path)
                            val uri = androidx.core.content.FileProvider.getUriForFile(
                                context, "${context.packageName}.fileprovider", file
                            )
                            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                type = "application/json"
                                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            context.startActivity(android.content.Intent.createChooser(intent, "حفظ النسخة الاحتياطية"))
                        } catch (e: Exception) {
                            withContext(Dispatchers.Main) {
                                android.widget.Toast.makeText(context, "تعذر إنشاء النسخة", android.widget.Toast.LENGTH_SHORT).show()
                            }
                        }
                        showExportSheet = false
                    }
                }
                ExportOptionRow(
                    icon = Icons.Default.RestoreFromTrash,
                    label = "استعادة من نسخة",
                    description = "اختر ملف نسخة احتياطية لإضافة ملاحظاته إلى دفترك"
                ) {
                    showExportSheet = false
                    showBackupSheet = true
                }
            }
        }
    }

    // ---------- Restore picker (must be created unconditionally) ----------
    val restorePicker = rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri ->
        if (!showBackupSheet) return@rememberLauncherForActivityResult
        uri?.let { u ->
            scope.launch {
                val backup = BackupManager.readBackup(context, u)
                if (backup == null) {
                    withContext(Dispatchers.Main) {
                        android.widget.Toast.makeText(context, "تعذر قراءة الملف", android.widget.Toast.LENGTH_SHORT).show()
                    }
                } else {
                    showBackupSheet = false
                    try {
                        val imported =         BackupManager.importBackup(AppContainer.get().notesRepository, backup)
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "تمت استعادة $imported ملاحظة", Toast.LENGTH_SHORT).show()
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "فشل الاستعادة: ${e.message}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }
    }

    if (showBackupSheet) {
        restorePicker.launch("application/json")
    }

    // ---------- Delete confirmation ----------
    deleteTarget?.let { note ->
        val inTrash = deletedNotes.any { it.id == note.id }
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("حذف الملاحظة", fontFamily = DaftarFonts.Cairo) },
            text = {
                Text(
                    text = if (inTrash) "حذف هذه الملاحظة نهائياً؟ لا يمكن التراجع عن هذا الإجراء."
                    else "نقل \"${note.title.ifBlank { "بدون عنوان" }}\" إلى سلة المحذوفات؟ يمكن استعادتها لاحقاً.",
                    fontFamily = DaftarFonts.Cairo
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            if (inTrash) viewModel.permanentDelete(note.id)
                            else viewModel.softDelete(note.id)
                            deleteTarget = null
                        }
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = colors.error)
                ) {
                    Text("حذف", fontFamily = DaftarFonts.Cairo)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text("إلغاء", fontFamily = DaftarFonts.Cairo)
                }
            }
        )
    }

    // ---------- Restore confirmation ----------
    restoreTarget?.let { note ->
        AlertDialog(
            onDismissRequest = { restoreTarget = null },
            title = { Text("استعادة الملاحظة", fontFamily = DaftarFonts.Cairo) },
            text = { Text("إعادة \"${note.title.ifBlank { "بدون عنوان" }}\" إلى الدفتر؟", fontFamily = DaftarFonts.Cairo) },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        viewModel.restore(note.id)
                        restoreTarget = null
                    }
                }) {
                    Text("استعادة", fontFamily = DaftarFonts.Cairo)
                }
            },
            dismissButton = {
                TextButton(onClick = { restoreTarget = null }) {
                    Text("إلغاء", fontFamily = DaftarFonts.Cairo)
                }
            }
        )
    }

    // ---------- Color picker dialog ----------
    colorTarget?.let { note ->
        AlertDialog(
            onDismissRequest = { colorTarget = null },
            title = { Text("لون الملاحظة", fontFamily = DaftarFonts.Cairo) },
            text = {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    NoteColorPalette.options.forEach { c ->
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(CircleShape)
                                .background(c)
                                .border(
                                    2.dp,
                                    if (note.colorLabel == NoteColorPalette.toHex(c)) colors.onSurface else colors.outline,
                                    CircleShape
                                )
                                .clickable {
                                    scope.launch {
                                        viewModel.updateColor(note.id, NoteColorPalette.toHex(c))
                                        colorTarget = null
                                    }
                                }
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        viewModel.updateColor(note.id, null)
                        colorTarget = null
                    }
                }) {
                    Text("إزالة اللون", fontFamily = DaftarFonts.Cairo, color = colors.error)
                }
            }
        )
    }

    // ---------- Empty trash confirmation ----------
    if (emptyTrashConfirm) {
        AlertDialog(
            onDismissRequest = { emptyTrashConfirm = false },
            title = { Text("إفراغ السلة", fontFamily = DaftarFonts.Cairo) },
            text = { Text("سيتم حذف كل الملاحظات في السلة نهائياً. هل أنت متأكد؟", fontFamily = DaftarFonts.Cairo) },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            viewModel.emptyTrash()
                            emptyTrashConfirm = false
                            showTrashSheet = false
                        }
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = colors.error)
                ) { Text("إفراغ", fontFamily = DaftarFonts.Cairo) }
            },
            dismissButton = {
                TextButton(onClick = { emptyTrashConfirm = false }) {
                    Text("إلغاء", fontFamily = DaftarFonts.Cairo)
                }
            }
        )
    }
}

@Composable
private fun SearchResultItem(row: NoteRow, query: String, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .background(colors.surface)
            .padding(14.dp)
    ) {
        Text(
            text = row.note.title.ifBlank { "بدون عنوان" },
            fontFamily = DaftarFonts.Cairo,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = colors.onSurface
        )
        val snippet = com.daftar.notes.util.TextUtils.extractSearchSnippet(
            com.daftar.notes.util.TextUtils.stripHtml(row.note.contentHtml),
            query
        )
        if (snippet.isNotBlank()) {
            Text(
                text = snippet,
                fontFamily = DaftarFonts.Cairo,
                fontSize = 13.sp,
                color = colors.onSurfaceVariant,
                maxLines = 3,
                modifier = Modifier.padding(top = 3.dp)
            )
        }
    }
}

@Composable
private fun TrashRow(note: Note, onRestore: () -> Unit, onDelete: () -> Unit) {
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
private fun SectionHeader(title: String, count: Int) {
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
private fun NoteOverflowMenu(
    noteId: Long,
    expanded: Boolean,
    onDismiss: () -> Unit,
    onPin: () -> Unit,
    onFavorite: () -> Unit,
    isFavorite: Boolean,
    onColor: () -> Unit,
    onDelete: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
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
        HorizontalDivider()
        DropdownMenuItem(
            text = { Text("حذف", fontFamily = DaftarFonts.Cairo, color = colors.error) },
            onClick = { onDelete(); onDismiss() },
            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = colors.error) }
        )
    }
}

@Composable
private fun ExportOptionRow(
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
