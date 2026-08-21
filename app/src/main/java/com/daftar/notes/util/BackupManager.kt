package com.daftar.notes.util

import android.content.Context
import android.net.Uri
import com.daftar.notes.data.Note
import com.daftar.notes.data.NotesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Backup / restore notes to a JSON file.
 *
 * Import flow: user picks a .json/.daftar file via SAF, we read it into memory,
 * show a preview, and the user confirms to import (avoids accidental overwrite).
 */
object BackupManager {

    @Serializable
    data class BackupFile(
        val version: Int = 2,
        val exportedAt: Long = System.currentTimeMillis(),
        val notes: List<BackupNote> = emptyList()
    )

    @Serializable
    data class BackupNote(
        val title: String,
        val contentHtml: String,
        val isFavorite: Boolean,
        val isPinned: Boolean,
        val colorLabel: String?,
        val status: String,
        val createdAt: Long,
        val updatedAt: Long
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true; ignoreUnknownKeys = true }

    suspend fun createBackup(context: Context, repo: NotesRepository): String =
        withContext(Dispatchers.IO) {
            val notes = repo.getAllNotesOnce()
            val backup = BackupFile(notes = notes.map { n ->
                BackupNote(
                    title = n.title,
                    contentHtml = n.contentHtml,
                    isFavorite = n.isFavorite,
                    isPinned = n.isPinned,
                    colorLabel = n.colorLabel,
                    status = n.status,
                    createdAt = n.createdAt,
                    updatedAt = n.updatedAt
                )
            })
            val file = java.io.File(context.cacheDir, "daftar_backup_${System.currentTimeMillis()}.daftar.json")
            file.writeText(json.encodeToString(backup))
            file.absolutePath
        }

    suspend fun readBackup(context: Context, uri: Uri): BackupFile? =
        withContext(Dispatchers.IO) {
            try {
                val text = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                text?.let { json.decodeFromString<BackupFile>(it) }
            } catch (e: Exception) {
                e.printStackTrace()
                null
            }
        }

    suspend fun importBackup(repo: NotesRepository, backup: BackupFile): Int =
        withContext(Dispatchers.IO) {
            var imported = 0
            for (n in backup.notes) {
                try {
                    repo.insertNote(
                        Note(
                            title = n.title,
                            contentHtml = n.contentHtml,
                            isFavorite = n.isFavorite,
                            isPinned = n.isPinned,
                            colorLabel = n.colorLabel,
                            status = n.status,
                            createdAt = n.createdAt,
                            updatedAt = n.updatedAt
                        )
                    )
                    imported++
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            imported
        }
}
