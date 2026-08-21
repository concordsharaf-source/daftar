package com.daftar.notes.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.io.File

class NotesRepository(private val dao: NoteDao) {
    val appContext: Context get() = com.daftar.notes.app.AppContainer.get().appContext

    fun getAllNotes(): Flow<List<Note>> = dao.getAllNotes()
    suspend fun getAllNotesOnce(): List<Note> = dao.getAllNotesOnce()
    fun getDeletedNotes(): Flow<List<Note>> = dao.getDeletedNotes()
    fun getFavoriteNotes(): Flow<List<Note>> = dao.getFavoriteNotes()
    fun getNotesByFolder(folderId: Long): Flow<List<Note>> = dao.getNotesByFolder(folderId)
    fun getNoteById(id: Long): Flow<Note?> = dao.getNoteById(id)
    suspend fun getNoteByIdOnce(id: Long): Note? = dao.getNoteByIdOnce(id)
    fun searchNotes(query: String): Flow<List<Note>> = dao.searchNotes(query)

    suspend fun insertNote(note: Note): Long = dao.insert(note)
    suspend fun updateNote(note: Note) = dao.update(note)
    suspend fun updateTitle(id: Long, title: String) = dao.updateTitle(id, title)
    suspend fun updateContent(id: Long, contentHtml: String) = dao.updateContent(id, contentHtml)
    suspend fun updateFavorite(id: Long, fav: Boolean) = dao.updateFavorite(id, fav)
    suspend fun updatePinned(id: Long, pinned: Boolean) = dao.updatePinned(id, pinned)
    suspend fun updateColor(id: Long, color: String?) = dao.updateColor(id, color)
    suspend fun updateStatus(id: Long, status: String) = dao.updateStatus(id, status)
    suspend fun softDelete(id: Long) = dao.softDelete(id)
    suspend fun restoreNote(id: Long) = dao.restoreNote(id)
    suspend fun permanentDelete(id: Long) = dao.permanentDelete(id)
    suspend fun emptyTrash() = dao.emptyTrash()
    suspend fun moveNoteToFolder(id: Long, folderId: Long?) = dao.moveNoteToFolder(id, folderId)

    fun getImages(noteId: Long): Flow<List<NoteImage>> = dao.getImages(noteId)
    suspend fun getImagesOnce(noteId: Long): List<NoteImage> = dao.getImagesOnce(noteId)

    fun getAllFolders(): Flow<List<Folder>> = dao.getAllFolders()
    suspend fun insertFolder(name: String): Long = dao.insertFolder(Folder(name = name))
    suspend fun deleteFolder(id: Long) = dao.deleteFolder(id)

    /** Copy a selected image into the app's private storage and register it. */
    suspend fun addImage(noteId: Long, source: File) = withContext(Dispatchers.IO) {
        val dir = File(getImagesDir(noteId)).apply { mkdirs() }
        val dest = File(dir, "img_${System.currentTimeMillis()}_${source.nameWithoutExtension}.jpg")
        source.inputStream().use { input -> dest.outputStream().use { output -> input.copyTo(output) } }
        val maxOrder = (dao.getImagesOnce(noteId).maxOfOrNull { it.order } ?: -1) + 1
        dao.insertImage(NoteImage(noteId = noteId, filePath = dest.absolutePath, order = maxOrder))
        dest.absolutePath
    }

    suspend fun deleteImage(imageId: Long, noteId: Long) = withContext(Dispatchers.IO) {
        val images = dao.getImagesOnce(noteId)
        val img = images.firstOrNull { it.id == imageId }
        dao.deleteImage(imageId)
        img?.let { File(it.filePath).delete() }
    }

    fun getImagesDir(noteId: Long): String = "notes/$noteId/images"

    fun getNoteImagesDir(noteId: Long): File =
        File(com.daftar.notes.app.AppContainer.get().appContext.getDir("notes", Context.MODE_PRIVATE), "$noteId/images")
}
