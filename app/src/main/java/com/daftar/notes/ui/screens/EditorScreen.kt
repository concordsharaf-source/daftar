package com.daftar.notes.ui.screens

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(
    noteId: Long,
    fontFamily: FontFamily,
    fontSizeSp: Int,
    onNavigateBack: () -> Unit,
    viewModel: EditorViewModel,
    appLockManager: AppLockManager
) {
    val context = LocalContext.current
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current

    val title by viewModel.title.collectAsState()
    val contentHtml by viewModel.contentHtml.collectAsState()
    val images by viewModel.images.collectAsState()
    val canUndo by viewModel.canUndo.collectAsState()
    val canRedo by viewModel.canRedo.collectAsState()
    val saveStatus by viewModel.saveStatus.collectAsState()
    val isPinned by viewModel.notePinned.collectAsState()
    val isFavorite by viewModel.noteFavorite.collectAsState()
    val noteColor by viewModel.noteColor.collectAsState()
    val noteStatus by viewModel.noteStatus.collectAsState()

    val colors = MaterialTheme.colorScheme

    val richState = rememberRichTextState()
    val density = LocalDensity.current
    val scrollState = rememberScrollState()
    var contentLoaded by remember { mutableStateOf(false) }

    // Scroll + cursor restoration
    var savedScrollY by remember { mutableStateOf(0) }

    LaunchedEffect(scrollState.value) {
        // Keep this effect alive so the current scroll position remains observable.
    }

    LaunchedEffect(scrollState.isScrollInProgress) {
        snapshotFlow { scrollState.value }
            .collect { savedScrollY = it }
    }

    LaunchedEffect(noteId) {
        viewModel.loadNote(noteId)
    }

    // Apply loaded HTML to the editor once, then restore scroll position
    LaunchedEffect(contentHtml) {
        if (!contentLoaded) {
            richState.setHtml(contentHtml)
            contentLoaded = true

            if (savedScrollY > 0) {
                scrollState.animateScrollTo(
                    savedScrollY.coerceAtMost(scrollState.maxValue)
                )
            }
        }
    }

    // Persist HTML whenever rich editor content changes
    LaunchedEffect(richState) {
        snapshotFlow { richState.toHtml() }
            .collect { html ->
                if (contentLoaded) {
                    viewModel.updateContent(html)
                }
            }
    }

    /*
     * RELIABLE LIFECYCLE AUTO-SAVE
     *
     * Save when the editor goes to the background,
     * when the screen is destroyed, and when Compose
     * disposes this screen.
     */
    DisposableEffect(lifecycleOwner) {

        val observer = LifecycleEventObserver { _, event ->
            when (event) {

                Lifecycle.Event.ON_STOP -> {
                    viewModel.saveNowAsync()
                }

                Lifecycle.Event.ON_DESTROY -> {
                    viewModel.saveNowAsync()
                }

                else -> Unit
            }
        }

        lifecycleOwner.lifecycle.addObserver(observer)

        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            viewModel.saveNowAsync()
        }
    }

    val wordCount =
        if (richState.annotatedString.text.isBlank()) {
            0
        } else {
            richState.annotatedString.text
                .trim()
                .split("\\s+".toRegex())
                .size
        }

    val charCount = richState.annotatedString.text.length

    var showMoreMenu by remember { mutableStateOf(false) }
    var showImagePicker by remember { mutableStateOf(false) }
    var fullScreenImage by remember { mutableStateOf<String?>(null) }
    var pendingImageUri by remember { mutableStateOf<android.net.Uri?>(null) }

    // Formatting toolbar state
    var showColorPicker by remember { mutableStateOf(false) }
    var showHighlightPicker by remember { mutableStateOf(false) }
    var showLabelColorPicker by remember { mutableStateOf(false) }
    var unorderedListActive by remember { mutableStateOf(false) }
    var orderedListActive by remember { mutableStateOf(false) }

    // Gallery launcher
    val pickMediaLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        uri?.let {
            pendingImageUri = it
        }
    }

    // Camera launcher
    val takePhotoLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->

        bitmap?.let { bmp ->

            CoroutineScope(Dispatchers.IO).launch {

                try {

                    val cacheDir = File(
                        context.cacheDir,
                        "camera"
                    ).apply {
                        mkdirs()
                    }

                    val tempFile = File(
                        cacheDir,
                        "photo_${System.currentTimeMillis()}.jpg"
                    )

                    tempFile.outputStream().use { out ->
                        bmp.compress(
                            android.graphics.Bitmap.CompressFormat.JPEG,
                            90,
                            out
                        )
                    }

                    viewModel.repo().addImage(
                        viewModel.noteId,
                        tempFile
                    )

                    viewModel.refreshImages()

                } catch (e: Exception) {

                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            context,
                            "تعذر إضافة الصورة",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            }
        }
    }

    // إذن الكاميرا: التطبيق يعلن CAMERA في المانيفست، لذا يلزم الإذن وقت التشغيل
    // وإلا يفشل إطلاق الكاميرا (SecurityException) بلا أي رسالة واضحة.
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            appLockManager.beginExternalFlow()
            takePhotoLauncher.launch(null)
        } else {
            Toast.makeText(context, "التقاط الصور يحتاج إذن الكاميرا", Toast.LENGTH_LONG).show()
        }
    }

    // Process selected image
    LaunchedEffect(pendingImageUri) {

        val uri = pendingImageUri
            ?: return@LaunchedEffect

        pendingImageUri = null

        try {

            val contentResolver = context.contentResolver
            val mimeType = contentResolver.getType(uri)

            val extension =
                if (mimeType?.startsWith("image/") == true) {
                    ".jpg"
                } else {
                    ".bin"
                }

            val cacheFile = File(
                context.cacheDir,
                "picked_${System.currentTimeMillis()}$extension"
            )

            contentResolver.openInputStream(uri)?.use { input ->

                cacheFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }

            viewModel.repo().addImage(
                viewModel.noteId,
                cacheFile
            )

            viewModel.refreshImages()

        } catch (e: Exception) {

            Toast.makeText(
                context,
                "تعذر إضافة الصورة",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    val lineHeightPx = remember(fontSizeSp) {
        fontSizeSp * 1.6f
    }

    Scaffold(

        topBar = {

            TopAppBar(

                title = {},

                modifier = Modifier.statusBarsPadding(),

                navigationIcon = {

                    IconButton(
                        onClick = {

                            CoroutineScope(Dispatchers.Main).launch {

                                viewModel.saveNow()
                                onNavigateBack()
                            }
                        }
                    ) {

                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "رجوع"
                        )
                    }
                },

                actions = {

                    IconButton(
                        onClick = {

                            if (canUndo) {

                                viewModel.snapshotForUndo()
                                viewModel.undo()
                            }
                        }
                    ) {

                        Icon(
                            Icons.AutoMirrored.Filled.Undo,
                            contentDescription = "تراجع",
                            tint =
                                if (canUndo) {
                                    colors.onSurface
                                } else {
                                    colors.onSurface.copy(alpha = 0.35f)
                                }
                        )
                    }

                    IconButton(
                        onClick = {

                            if (canRedo) {

                                viewModel.snapshotForUndo()
                                viewModel.redo()
                            }
                        }
                    ) {

                        Icon(
                            Icons.AutoMirrored.Filled.Redo,
                            contentDescription = "إعادة",
                            tint =
                                if (canRedo) {
                                    colors.onSurface
                                } else {
                                    colors.onSurface.copy(alpha = 0.35f)
                                }
                        )
                    }

                    IconButton(
                        onClick = {
                            showImagePicker = true
                        }
                    ) {

                        Icon(
                            Icons.Filled.AddPhotoAlternate,
                            contentDescription = "إضافة صورة"
                        )
                    }

                    IconButton(
                        onClick = {
                            showMoreMenu = true
                        }
                    ) {

                        Icon(
                            Icons.Default.MoreVert,
                            contentDescription = "المزيد"
                        )
                    }
                },

                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor =
                        colors.background.copy(alpha = 0.85f)
                )
            )

            // Rich formatting toolbar
            FormattingToolbar(

                richState = richState,
                fontFamily = fontFamily,
                colors = colors,

                showColorPicker = showColorPicker,
                showHighlightPicker = showHighlightPicker,
                isUnorderedListActive = unorderedListActive,
                isOrderedListActive = orderedListActive,

                onToggleBold = {
                    viewModel.snapshotForUndo()

                    richState.toggleSpanStyle(
                        androidx.compose.ui.text.SpanStyle(
                            fontWeight = FontWeight.Bold
                        )
                    )
                },

                onToggleItalic = {
                    viewModel.snapshotForUndo()

                    richState.toggleSpanStyle(
                        androidx.compose.ui.text.SpanStyle(
                            fontStyle =
                                androidx.compose.ui.text.font.FontStyle.Italic
                        )
                    )
                },

                onToggleUnderline = {
                    viewModel.snapshotForUndo()

                    richState.toggleSpanStyle(
                        androidx.compose.ui.text.SpanStyle(
                            textDecoration =
                                androidx.compose.ui.text.style.TextDecoration.Underline
                        )
                    )
                },

                onHeading1 = {
                    viewModel.snapshotForUndo()
                    applyHeading(richState, 26)
                },

                onHeading2 = {
                    viewModel.snapshotForUndo()
                    applyHeading(richState, 22)
                },

                onNormal = {
                    viewModel.snapshotForUndo()
                    applyHeading(richState, null)
                },

                onBulletList = {
                    viewModel.snapshotForUndo()
                    richState.toggleUnorderedList()
                    unorderedListActive = !unorderedListActive
                    if (unorderedListActive) orderedListActive = false
                },

                onNumberedList = {
                    viewModel.snapshotForUndo()
                    richState.toggleOrderedList()
                    orderedListActive = !orderedListActive
                    if (orderedListActive) unorderedListActive = false
                },

                onToggleHighlightPicker = {
                    showHighlightPicker =
                        !showHighlightPicker
                },

                onApplyHighlight = { hex ->

                    showHighlightPicker = false

                    viewModel.snapshotForUndo()

                    val color =
                        Color(
                            android.graphics.Color.parseColor(hex)
                        )

                    richState.toggleSpanStyle(
                        androidx.compose.ui.text.SpanStyle(
                            background = color
                        )
                    )
                },

                onToggleColorPicker = {
                    showColorPicker =
                        !showColorPicker
                },

                onApplyColor = { hex ->

                    showColorPicker = false

                    viewModel.snapshotForUndo()

                    val color =
                        Color(
                            android.graphics.Color.parseColor(hex)
                        )

                    richState.toggleSpanStyle(
                        androidx.compose.ui.text.SpanStyle(
                            color = color
                        )
                    )
                }
            )
        }

    ) { padding ->

        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {

            // Title block: headline TextField (~40dp min) + 8dp gap + 1dp divider
            val titleBlockPx =
                with(density) { (40.dp + 8.dp + 1.dp).toPx() } + lineHeightPx * 1.5f
            PaperBackground(
                lineHeightPx = lineHeightPx,
                titleHeightPx = titleBlockPx
            ) {

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(scrollState)
                        .imePadding()
                        .padding(
                            horizontal = 20.dp,
                            vertical = 12.dp
                        )
                ) {

                    TextField(

                        value = title,

                        onValueChange = {
                            viewModel.updateTitle(it)
                        },

                        textStyle =
                            MaterialTheme.typography.headlineSmall.copy(
                                fontFamily = fontFamily,
                                fontWeight = FontWeight.Bold,
                                color = colors.onSurface
                            ),

                        placeholder = {

                            Text(
                                text = "عنوان المقال",
                                fontFamily = fontFamily,
                                fontWeight = FontWeight.Bold,
                                fontSize = (fontSizeSp + 12).sp,
                                color =
                                    colors.onSurfaceVariant.copy(
                                        alpha = 0.5f
                                    )
                            )
                        },

                        colors =
                            androidx.compose.material3.TextFieldDefaults.colors(
                                focusedContainerColor =
                                    Color.Transparent,

                                unfocusedContainerColor =
                                    Color.Transparent,

                                disabledContainerColor =
                                    Color.Transparent,

                                focusedIndicatorColor =
                                    Color.Transparent,

                                unfocusedIndicatorColor =
                                    Color.Transparent
                            ),

                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 40.dp)
                            .padding(bottom = 8.dp)
                    )

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(
                                colors.outline.copy(alpha = 0.5f)
                            )
                    )

                    RichTextEditor(

                        state = richState,

                        textStyle = TextStyle(
                            fontFamily = fontFamily,
                            fontSize = fontSizeSp.sp,
                            color = colors.onSurface,
                            lineHeight = (fontSizeSp * 1.6).sp
                        ),

                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 400.dp)
                    )

                    if (images.isNotEmpty()) {

                        Column(

                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 12.dp),

                            verticalArrangement =
                                Arrangement.spacedBy(12.dp)
                        ) {

                            images.forEach { img ->

                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                ) {

                                    AsyncImage(

                                        model =
                                            ImageRequest.Builder(context)
                                                .data(img.filePath)
                                                .crossfade(true)
                                                .build(),

                                        contentDescription = null,

                                        modifier = Modifier
                                            .fillMaxWidth(0.9f)
                                            .clip(
                                                RoundedCornerShape(12.dp)
                                            )
                                            .clickable {
                                                fullScreenImage =
                                                    img.filePath
                                            },

                                        contentScale =
                                            ContentScale.Fit
                                    )

                                    IconButton(

                                        onClick = {

                                            CoroutineScope(
                                                Dispatchers.IO
                                            ).launch {

                                                viewModel.deleteImage(
                                                    img.id
                                                )

                                                withContext(
                                                    Dispatchers.Main
                                                ) {
                                                    viewModel.refreshImages()
                                                }
                                            }
                                        },

                                        modifier = Modifier
                                            .align(Alignment.TopEnd)
                                            .padding(4.dp)
                                            .background(
                                                colors.surfaceVariant.copy(
                                                    alpha = 0.85f
                                                ),
                                                CircleShape
                                            )
                                    ) {

                                        Icon(
                                            Icons.Default.Close,
                                            contentDescription =
                                                "حذف الصورة",
                                            tint =
                                                colors.onSurfaceVariant,
                                            modifier =
                                                Modifier.size(18.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Spacer(
                        modifier = Modifier.height(160.dp)
                    )
                }
            }

            // Word counter + save indicator
            Box(

                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(bottom = 16.dp)
                    .navigationBarsPadding()
            ) {

                Row(

                    modifier = Modifier
                        .align(Alignment.Center)
                        .clip(
                            RoundedCornerShape(20.dp)
                        )
                        .background(
                            colors.surfaceVariant.copy(
                                alpha = 0.85f
                            )
                        )
                        .padding(
                            horizontal = 14.dp,
                            vertical = 7.dp
                        ),

                    verticalAlignment =
                        Alignment.CenterVertically,

                    horizontalArrangement =
                        Arrangement.spacedBy(8.dp)
                ) {

                    Text(
                        text =
                            "$wordCount كلمة • $charCount حرف",
                        fontFamily = DaftarFonts.Cairo,
                        fontSize = 12.sp,
                        color = colors.onSurfaceVariant
                    )

                    if (saveStatus == "saving") {

                        Text(
                            text = "• جاري الحفظ…",
                            fontFamily = DaftarFonts.Cairo,
                            fontSize = 11.sp,
                            color = colors.secondary
                        )

                    } else if (saveStatus == "saved") {

                        Text(
                            text = "• تم الحفظ",
                            fontFamily = DaftarFonts.Cairo,
                            fontSize = 11.sp,
                            color = colors.primary
                        )
                    }
                }
            }
        }
    }

    // More menu
    DropdownMenu(

        expanded = showMoreMenu,

        onDismissRequest = {
            showMoreMenu = false
        }
    ) {

        DropdownMenuItem(

            text = {
                Text(
                    "مشاركة",
                    fontFamily = DaftarFonts.Cairo
                )
            },

            onClick = {

                showMoreMenu = false

                val shareText = buildString {
                    append(title)
                    append("\n\n")
                    append(richState.annotatedString.text)
                }

                val intent =
                    Intent(Intent.ACTION_SEND).apply {

                        type = "text/plain"

                        putExtra(
                            Intent.EXTRA_TEXT,
                            shareText
                        )

                        putExtra(
                            Intent.EXTRA_SUBJECT,
                            title
                        )
                    }

                appLockManager.beginExternalFlow()
                context.startActivity(
                    Intent.createChooser(
                        intent,
                        "مشاركة الملاحظة"
                    )
                )
            },

            leadingIcon = {
                Icon(
                    Icons.Filled.Share,
                    contentDescription = null
                )
            }
        )

        DropdownMenuItem(

            text = {
                Text(
                    "تصدير PDF",
                    fontFamily = DaftarFonts.Cairo
                )
            },

            onClick = {

                showMoreMenu = false

                CoroutineScope(Dispatchers.IO).launch {

                    val cacheDir =
                        File(
                            context.cacheDir,
                            "pdf"
                        ).apply {
                            mkdirs()
                        }

                    val outFile =
                        File(
                            cacheDir,
                            "${title.ifEmpty { "note" }}.pdf"
                        )

                    val ok =
                        com.daftar.notes.util.PdfExporter
                            .exportRichNoteToPdf(
                                context,
                                title,
                                richState.toHtml(),
                                images.map { it.filePath },
                                outFile
                            )

                    withContext(Dispatchers.Main) {

                        if (ok && outFile.exists()) {

                            val provider =
                                androidx.core.content.FileProvider
                                    .getUriForFile(
                                        context,
                                        "${context.packageName}.fileprovider",
                                        outFile
                                    )

                            val viewIntent =
                                Intent(Intent.ACTION_VIEW).apply {

                                    setDataAndType(
                                        provider,
                                        "application/pdf"
                                    )

                                    addFlags(
                                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                                    )
                                }

                            try {

                                appLockManager.beginExternalFlow()
                                context.startActivity(
                                    viewIntent
                                )

                            } catch (e: Exception) {

                                Toast.makeText(
                                    context,
                                    "تم تصدير PDF إلى: ${outFile.absolutePath}",
                                    Toast.LENGTH_LONG
                                ).show()
                            }

                        } else {

                            Toast.makeText(
                                context,
                                "فشل تصدير PDF",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            },

            leadingIcon = {
                Icon(
                    Icons.Default.PictureAsPdf,
                    contentDescription = null
                )
            }
        )

        DropdownMenuItem(

            text = {
                Text(
                    if (isPinned) {
                        "إلغاء التثبيت"
                    } else {
                        "تثبيت"
                    },
                    fontFamily = DaftarFonts.Cairo
                )
            },

            onClick = {

                showMoreMenu = false

                viewModel.togglePinned(!isPinned)
            },

            leadingIcon = {

                Icon(
                    Icons.Default.PushPin,
                    contentDescription = null,
                    tint =
                        if (isPinned) {
                            colors.primary
                        } else {
                            colors.onSurfaceVariant
                        }
                )
            }
        )

        DropdownMenuItem(

            text = {

                Text(
                    if (isFavorite) {
                        "إزالة من المفضلة"
                    } else {
                        "إضافة للمفضلة"
                    },
                    fontFamily = DaftarFonts.Cairo
                )
            },

            onClick = {

                showMoreMenu = false

                viewModel.toggleFavorite(!isFavorite)
            },

            leadingIcon = {

                Icon(
                    if (isFavorite) {
                        Icons.Default.Favorite
                    } else {
                        Icons.Default.FavoriteBorder
                    },
                    contentDescription = null,
                    tint =
                        if (isFavorite) {
                            Color(0xFFE53935)
                        } else {
                            colors.onSurfaceVariant
                        }
                )
            }
        )

        DropdownMenuItem(

            text = {
                Text(
                    "لون الملاحظة",
                    fontFamily = DaftarFonts.Cairo
                )
            },

            onClick = {

                showMoreMenu = false
                showLabelColorPicker = true
            },

            leadingIcon = {
                Icon(
                    Icons.Default.Label,
                    contentDescription = null,
                    tint = colors.primary
                )
            }
        )

        DropdownMenuItem(

            text = {

                Text(
                    if (noteStatus == "done") {
                        "إعادة إلى المسودة"
                    } else {
                        "تحديد كمنجز"
                    },
                    fontFamily = DaftarFonts.Cairo
                )
            },

            onClick = {

                showMoreMenu = false

                val newStatus =
                    if (noteStatus == "done") "draft" else "done"

                viewModel.updateStatus(newStatus)
            },

            leadingIcon = {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint =
                        if (noteStatus == "done") {
                            colors.primary
                        } else {
                            colors.onSurfaceVariant
                        }
                )
            }
        )

        DropdownMenuItem(

            text = {
                Text(
                    "إضافة صورة",
                    fontFamily = DaftarFonts.Cairo
                )
            },

            onClick = {

                showMoreMenu = false
                showImagePicker = true
            },

            leadingIcon = {
                Icon(
                    Icons.Default.Photo,
                    contentDescription = null
                )
            }
        )
    }

    // Color picker popup
    if (showColorPicker || showHighlightPicker) {

        Dialog(
            onDismissRequest = {

                showColorPicker = false
                showHighlightPicker = false
            }
        ) {

            Box(

                modifier = Modifier
                    .clip(
                        RoundedCornerShape(20.dp)
                    )
                    .background(colors.surface)
                    .padding(20.dp)
            ) {

                Column(
                    verticalArrangement =
                        Arrangement.spacedBy(12.dp)
                ) {

                    Text(

                        text =
                            if (showColorPicker) {
                                "لون النص"
                            } else {
                                "لون التمييز"
                            },

                        fontFamily = fontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = colors.onSurface
                    )

                    val palette =
                        if (showColorPicker) {
                            TEXT_COLORS
                        } else {
                            HIGHLIGHT_COLORS
                        }

                    Row(

                        modifier =
                            Modifier.fillMaxWidth(),

                        horizontalArrangement =
                            Arrangement.SpaceEvenly
                    ) {

                        palette.forEach { c ->

                            Box(

                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(
                                        RoundedCornerShape(8.dp)
                                    )
                                    .background(c)
                                    .clickable {

                                        val hex = toHex(c)

                                        if (showColorPicker) {

                                            showColorPicker = false

                                            viewModel.snapshotForUndo()

                                            richState.toggleSpanStyle(
                                                androidx.compose.ui.text.SpanStyle(
                                                    color = c
                                                )
                                            )

                                        } else {

                                            showHighlightPicker = false

                                            viewModel.snapshotForUndo()

                                            richState.toggleSpanStyle(
                                                androidx.compose.ui.text.SpanStyle(
                                                    background = c
                                                )
                                            )
                                        }
                                    }
                            )
                        }
                    }
                }
            }
        }
    }

    // Image source picker
    if (showImagePicker) {

        Dialog(
            onDismissRequest = {
                showImagePicker = false
            }
        ) {

            Box(

                modifier = Modifier
                    .clip(
                        RoundedCornerShape(20.dp)
                    )
                    .background(colors.surface)
                    .padding(24.dp)
            ) {

                Column(
                    verticalArrangement =
                        Arrangement.spacedBy(12.dp)
                ) {

                    Text(
                        text = "إضافة صورة",
                        fontFamily = fontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        color = colors.onSurface
                    )

                    Row(

                        modifier =
                            Modifier.fillMaxWidth(),

                        horizontalArrangement =
                            Arrangement.SpaceEvenly
                    ) {

                        PickerButton(

                            icon = Icons.Default.Photo,

                            label = "المعرض",

                            onClick = {

                                showImagePicker = false

                                appLockManager.beginExternalFlow()

                                pickMediaLauncher.launch(
                                    "image/*"
                                )
                            }
                        )

                        PickerButton(

                            icon =
                                Icons.Default.AddPhotoAlternate,

                            label = "الكاميرا",

                            onClick = {

                                showImagePicker = false

                                if (androidx.core.content.ContextCompat.checkSelfPermission(
                                        context,
                                        android.Manifest.permission.CAMERA
                                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                                ) {
                                    appLockManager.beginExternalFlow()
                                    takePhotoLauncher.launch(null)
                                } else {
                                    cameraPermissionLauncher.launch(android.Manifest.permission.CAMERA)
                                }
                            }
                        )
                    }
                }
            }
        }
    }

    // Note label color picker
    if (showLabelColorPicker) {

        Dialog(
            onDismissRequest = {
                showLabelColorPicker = false
            }
        ) {

            Box(

                modifier = Modifier
                    .clip(
                        RoundedCornerShape(20.dp)
                    )
                    .background(colors.surface)
                    .padding(20.dp)
            ) {

                Column(
                    verticalArrangement =
                        Arrangement.spacedBy(12.dp)
                ) {

                    Text(
                        text = "لون الملاحظة",
                        fontFamily = fontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = colors.onSurface
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement =
                            Arrangement.SpaceEvenly
                    ) {

                        NoteColorPalette.options.forEach { c ->

                            val selected =
                                noteColor != null &&
                                    noteColor.equals(
                                        NoteColorPalette.toHex(c),
                                        ignoreCase = true
                                    )

                            Box(
                                modifier = Modifier
                                    .size(44.dp)
                                    .clip(
                                        RoundedCornerShape(10.dp)
                                    )
                                    .background(c)
                                    .clickable {

                                        showLabelColorPicker = false
                                        viewModel.updateColor(
                                            NoteColorPalette.toHex(c)
                                        )
                                    }
                            ) {

                                if (selected) {
                                    Icon(
                                        Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        tint = Color.Black,
                                        modifier = Modifier
                                            .align(Alignment.Center)
                                            .size(24.dp)
                                    )
                                }
                            }
                        }

                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(
                                    RoundedCornerShape(10.dp)
                                )
                                .background(
                                    colors.surfaceVariant,
                                    RoundedCornerShape(10.dp)
                                )
                                .clickable {
                                    showLabelColorPicker = false
                                    viewModel.updateColor(null)
                                }
                        ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "بدون لون",
                                tint = colors.onSurfaceVariant,
                                modifier = Modifier
                                    .align(Alignment.Center)
                                    .size(20.dp)
                            )
                        }
                    }
                }
            }
        }
    }

    // Full-screen image viewer
    fullScreenImage?.let { path ->

        Dialog(
            onDismissRequest = {
                fullScreenImage = null
            }
        ) {

            Box(

                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 700.dp)
                    .clip(
                        RoundedCornerShape(12.dp)
                    )
                    .clickable {
                        fullScreenImage = null
                    }
            ) {

                AsyncImage(

                    model =
                        ImageRequest.Builder(context)
                            .data(path)
                            .crossfade(true)
                            .build(),

                    contentDescription = null,

                    modifier =
                        Modifier.fillMaxWidth(),

                    contentScale =
                        ContentScale.Fit
                )
            }
        }
    }
}

/** Apply heading span style: null = normal. */