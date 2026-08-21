package com.daftar.notes.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.daftar.notes.data.Note
import com.daftar.notes.data.NoteImage
import com.daftar.notes.ui.theme.DaftarFonts
import com.daftar.notes.util.TextUtils

/**
 * Note card for the home list with: color label bar, pin/favorite icons,
 * image thumbnail, snippet, and relative last-modified date.
 */
@Composable
fun NoteCard(
    note: Note,
    images: List<NoteImage>,
    searchQuery: String,
    isFavorite: Boolean,
    isPinned: Boolean,
    onClick: () -> Unit,
    onLongPress: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = MaterialTheme.colorScheme
    val labelColor = note.colorLabel?.let {
        try {
            Color(android.graphics.Color.parseColor(it))
        } catch (e: Exception) { null }
    }

    val snippet = if (searchQuery.isNotBlank()) {
        val plain = TextUtils.stripHtml(note.contentHtml)
        TextUtils.extractSearchSnippet(plain, searchQuery)
    } else {
        TextUtils.extractSnippet(note.contentHtml, maxLength = 90)
    }

    val cardShape = RoundedCornerShape(14.dp)

    CardSurface(
        labelColor = labelColor,
        modifier = modifier
            .fillMaxWidth()
            .clip(cardShape)
            .background(colors.surface)
            .border(1.dp, colors.outlineVariant, cardShape)
            .clickable(onClick = onClick)
            .padding(14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = note.title.ifBlank { "بدون عنوان" },
                    fontFamily = DaftarFonts.Cairo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = colors.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                if (snippet.isNotBlank()) {
                    Text(
                        text = if (searchQuery.isNotBlank() && snippet.contains(searchQuery, ignoreCase = true)) {
                            snippet
                        } else {
                            snippet
                        },
                        fontFamily = DaftarFonts.Cairo,
                        fontSize = 13.sp,
                        color = colors.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
                Row(
                    modifier = Modifier.padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = TextUtils.formatRelative(note.updatedAt),
                        fontFamily = DaftarFonts.Cairo,
                        fontSize = 11.sp,
                        color = colors.onSurfaceVariant.copy(alpha = 0.7f)
                    )
                    if (note.status == "draft") {
                        Text(
                            text = "• مسودة",
                            fontFamily = DaftarFonts.Cairo,
                            fontSize = 11.sp,
                            color = colors.secondary
                        )
                    }
                }
            }

            // Thumbnail
            if (images.isNotEmpty()) {
                AsyncImage(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(images.first().filePath)
                        .crossfade(true)
                        .build(),
                    contentDescription = null,
                    modifier = Modifier
                        .size(56.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(colors.surfaceVariant),
                    contentScale = ContentScale.Crop
                )
            }

            // Pin + favorite icons
            Column(
                modifier = Modifier.padding(start = 8.dp),
                horizontalAlignment = Alignment.End
            ) {
                if (isPinned) {
                    Icon(
                        Icons.Default.PushPin,
                        contentDescription = "مثبتة",
                        tint = colors.primary,
                        modifier = Modifier.size(16.dp)
                    )
                }
                if (isFavorite) {
                    Icon(
                        Icons.Default.Favorite,
                        contentDescription = "مفضلة",
                        tint = Color(0xFFE53935),
                        modifier = Modifier
                            .size(16.dp)
                            .padding(top = if (isPinned) 4.dp else 0.dp)
                    )
                }
            }
        }
    }
}

/** Card with a right-side color bar for the note label. */
@Composable
private fun CardSurface(
    labelColor: Color?,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    if (labelColor == null) {
        Box(modifier = modifier) { content() }
    } else {
        Row(modifier = modifier) {
            Box(
                modifier = Modifier
                    .width(5.dp)
                    .background(labelColor)
            )
            Box(modifier = Modifier.weight(1f)) { content() }
        }
    }
}
