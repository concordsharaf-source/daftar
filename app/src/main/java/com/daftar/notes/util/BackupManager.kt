package com.daftar.notes.util

import android.content.Context
import android.net.Uri
import com.daftar.notes.app.AppContainer
import com.daftar.notes.data.Note
import com.daftar.notes.data.NotesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.BufferedInputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Backup / restore notes to a self-contained ZIP archive:
 *   daftar.json    — all notes as JSON (v3 format)
 *   images/<noteId>/... — copies of every note image
 * Older single-file JSON backups (v2) are still supported on import.
 */
object BackupManager {

    @Serializable
    data class BackupFile(
        val version: Int = 3,
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
        val updatedAt: Long,
        val images: List<String> = emptyList() // relative paths inside the archive
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true; ignoreUnknownKeys = true }

    /**
     * Create a ZIP backup containing all notes and their images.
     * Returns the absolute path of the created archive.
     */
    suspend fun createBackup(context: Context, repo: NotesRepository): String =
        withContext(Dispatchers.IO) {
            val notes = repo.getAllNotesOnce()
            val archive = File(context.cacheDir, "daftar_backup_${System.currentTimeMillis()}.daftar.zip")
            ZipOutputStream(archive.outputStream().buffered()).use { zos ->
                // 1) notes manifest
                zos.putNextEntry(ZipEntry("daftar.json"))
                val backup = BackupFile(notes = notes.map { n ->
                    val imgFiles = repo.getImagesOnce(n.id).map { File(it.filePath) }
                    BackupNote(
                        title = n.title,
                        contentHtml = n.contentHtml,
                        isFavorite = n.isFavorite,
                        isPinned = n.isPinned,
                        colorLabel = n.colorLabel,
                        status = n.status,
                        createdAt = n.createdAt,
                        updatedAt = n.updatedAt,
                        images = imgFiles.map { "images/${n.id}/${it.name}" }
                    )
                })
                zos.write(json.encodeToString(backup).toByteArray())
                zos.closeEntry()
                // 2) image files, each under images/<noteId>/
                for (n in notes) {
                    for (img in repo.getImagesOnce(n.id).map { File(it.filePath) }) {
                        zos.putNextEntry(ZipEntry("images/${n.id}/${img.name}"))
                        img.inputStream().use { it.copyTo(zos) }
                        zos.closeEntry()
                    }
                }
            }
            archive.absolutePath
        }

    /**
     * Read a backup URI (ZIP or legacy JSON). Returns null on failure.
     */
    suspend fun readBackup(context: Context, uri: Uri): BackupFile? =
        withContext(Dispatchers.IO) {
            try {
                val input = context.contentResolver.openInputStream(uri) ?: return@withContext null
                BufferedInputStream(input).use { bis ->
                    if (isZip(bis)) {
                        // extract manifest; keep images in cacheDir temporarily
                        val tmpDir = File(context.cacheDir, "backup_restore_${System.currentTimeMillis()}")
                        tmpDir.mkdirs()
                        bis.close()
                        var manifest: BackupFile? = null
                        context.contentResolver.openInputStream(uri)?.use { stream ->
                            ZipInputStream(stream).use { zis ->
                                while (true) {
                                    val entry = zis.nextEntry ?: break
                                    if (entry.name == "daftar.json") {
                                        manifest = json.decodeFromString<BackupFile>(
                                            zis.bufferedReader().readText()
                                        )
                                    } else if (entry.name.startsWith("images/")) {
                                        val file = File(tmpDir, entry.name)
                                        file.parentFile?.mkdirs()
                                        file.outputStream().use { zis.copyTo(it) }
                                    }
                                    zis.closeEntry()
                                }
                            }
                        }
                        if (manifest != null) BACKUP_TEMP_DIR = tmpDir
                        manifest
                    } else {
                        // legacy single JSON backup (v2)
                        json.decodeFromString<BackupFile>(bis.bufferedReader().readText())
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                null
            }
        }

    @Volatile
    private var BACKUP_TEMP_DIR: File? = null

    /**
     * Import notes from a parsed backup, restoring their images too.
     * Returns the number of notes successfully imported.
     */
    suspend fun importBackup(repo: NotesRepository, backup: BackupFile): Int =
        withContext(Dispatchers.IO) {
            var imported = 0
            val tmpDir = BACKUP_TEMP_DIR
            for (n in backup.notes) {
                try {
                    val id = repo.insertNote(
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
                    if (id > 0) {
                        for (relative in n.images) {
                            try {
                                val src = tmpDir?.let { File(it, relative) }
                                if (src != null && src.exists()) {
                                    repo.addImage(id, src)
                                }
                            } catch (e: Exception) {
                                e.printStackTrace()
                            }
                        }
                        imported++
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            // cleanup temp files
            tmpDir?.deleteRecursively()
            BACKUP_TEMP_DIR = null
            imported
        }

    /** Peek whether the stream looks like a ZIP (PK header). */
    private fun isZip(bis: java.io.BufferedInputStream): Boolean {
        return try {
            bis.mark(4)
            val buf = ByteArray(4)
            val read = bis.read(buf)
            bis.reset()
            read == 4 && buf[0] == 0x50.toByte() && buf[1] == 0x4B.toByte()
        } catch (e: Exception) {
            false
        }
    }
}
