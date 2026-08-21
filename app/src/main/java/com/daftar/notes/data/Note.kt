package com.daftar.notes.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Note entity. contentHtml stores the rich HTML content.
 * colorLabel: optional label color hex (e.g. "#FF8A65").
 * isPinned: pinned notes stay on top regardless of sort.
 * status: "draft" or "done" (requirement #18).
 */
@Entity(tableName = "notes")
data class Note(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String = "",
    val contentHtml: String = "",
    val folderId: Long? = null,
    val isFavorite: Boolean = false,
    val isDeleted: Boolean = false,
    val isPinned: Boolean = false,
    val colorLabel: String? = null,
    val status: String = "draft", // "draft" | "done"
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "folders")
data class Folder(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String = "",
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "note_images")
data class NoteImage(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val noteId: Long,
    val filePath: String,
    val order: Int = 0
)
