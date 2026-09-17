package com.daftar.notes.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.io.File

class NotesRepository(
    private val dao: NoteDao,
    /** إدارة ملفات الصور. تُمرَّر من AppContainer، وتبقى اختيارية للاختبارات. */
    private val files: NoteFileStore? = null
) {
    private fun requireFiles(): NoteFileStore =
        files ?: throw IllegalStateException("NoteFileStore غير مُهيّأ")

    /** هل الصور مدعومة في هذه البيئة؟ (اختبارات الوحدة: لا) */
    val imagesSupported: Boolean get() = files != null

    fun getAllNotes(): Flow<List<Note>> = dao.getAllNotes()
    suspend fun getAllNotesOnce(): List<Note> = dao.getAllNotesOnce()
    fun getDeletedNotes(): Flow<List<Note>> = dao.getDeletedNotes()
    fun getFavoriteNotes(): Flow<List<Note>> = dao.getFavoriteNotes()
    fun getNotesByFolder(folderId: Long): Flow<List<Note>> = dao.getNotesByFolder(folderId)
    fun getNoteById(id: Long): Flow<Note?> = dao.getNoteById(id)
    suspend fun getNoteByIdOnce(id: Long): Note? = dao.getNoteByIdOnce(id)

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
    /**
     * حذف نهائي متسلسل: صفوف الصور + ملفاتها على القرص + الملاحظة نفسها.
     * سابقًا كانت الصفوف والملفات تبقى (تسريب مساحة دائم).
     */
    suspend fun permanentDelete(id: Long) = withContext(Dispatchers.IO) {
        val images = dao.getImagesOnce(id)
        dao.deleteImagesForNote(id)
        dao.permanentDelete(id)
        images.forEach { img -> runCatching { File(img.filePath).delete() } }
        files?.deleteNoteFiles(id)
    }

    /** إفراغ السلة: يحذف الملاحظات المحذوفة نهائيًا مع صورها. */
    suspend fun emptyTrash() = withContext(Dispatchers.IO) {
        val doomed = dao.getDeletedNotesOnce()
        val images = doomed.flatMap { note -> dao.getImagesOnce(note.id) }
        doomed.forEach { note -> dao.deleteImagesForNote(note.id) }
        dao.emptyTrash()
        images.forEach { img -> runCatching { File(img.filePath).delete() } }
        doomed.forEach { note -> files?.deleteNoteFiles(note.id) }
    }

    /** حذف كل ملفات الصور التي لا تخص أي ملاحظة موجودة (صيانة). */
    suspend fun cleanupOrphanImages(): Int = withContext(Dispatchers.IO) {
        val store = files ?: return@withContext 0
        val liveIds = (dao.getAllNotesOnce().map { it.id } + dao.getDeletedNotesOnce().map { it.id }).toSet()
        var removed = 0
        store.orphanNoteDirs(liveIds).forEach { dir -> if (dir.deleteRecursively()) removed++ }
        removed
    }
    suspend fun moveNoteToFolder(id: Long, folderId: Long?) = dao.moveNoteToFolder(id, folderId)

    fun getImages(noteId: Long): Flow<List<NoteImage>> = dao.getImages(noteId)
    suspend fun getImagesOnce(noteId: Long): List<NoteImage> = dao.getImagesOnce(noteId)

    fun getAllFolders(): Flow<List<Folder>> = dao.getAllFolders()
    suspend fun insertFolder(name: String): Long = dao.insertFolder(Folder(name = name))
    suspend fun deleteFolder(id: Long) = dao.deleteFolder(id)

    /** Copy a selected image into the app's private storage and register it. */
    suspend fun addImage(noteId: Long, source: File) = withContext(Dispatchers.IO) {
        // مهم: مسار مطلق داخل التخزين الخاص للتطبيق (كان نسبيًا فلا تنجح الكتابة)
        val dest = requireFiles().copyInto(noteId, source)
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

}
