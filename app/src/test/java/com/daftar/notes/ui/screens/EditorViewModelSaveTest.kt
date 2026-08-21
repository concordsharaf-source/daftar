package com.daftar.notes.ui.screens

import com.daftar.notes.data.Note
import com.daftar.notes.data.NotesRepository
import com.daftar.notes.data.NoteImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class FakeRepo : NotesRepository {
    val updates = mutableListOf<Pair<Long, String>>() // (id, contentHtml)
    val titleUpdates = mutableListOf<Pair<Long, String>>()
    var note: Note? = null
    override suspend fun getNoteByIdOnce(id: Long): Note? = note
    override suspend fun updateTitle(id: Long, title: String) { titleUpdates += id to title }
    override suspend fun updateContent(id: Long, contentHtml: String) { updates += id to contentHtml }
    override suspend fun updateFavorite(id: Long, fav: Boolean) {}
    override suspend fun updatePinned(id: Long, pinned: Boolean) {}
    override suspend fun updateColor(id: Long, color: String?) {}
    override suspend fun updateStatus(id: Long, status: String) {}
    override suspend fun getImagesOnce(noteId: Long): List<NoteImage> = emptyList()
    override suspend fun addImage(noteId: Long, file: java.io.File) {}
    override suspend fun deleteImage(imageId: Long, noteId: Long) {}
}

class EditorViewModelSaveTest {
    private lateinit var repo: FakeRepo
    private lateinit var vm: EditorViewModel

    @Before
    fun setup() {
        repo = FakeRepo()
        vm = EditorViewModel(repo)
    }

    @Test
    fun contentUpdateFlowsToDatabase() = runTest {
        repo.note = Note(id = 1, title = "ت", contentHtml = "", folderId = null,
            isFavorite = false, isDeleted = false, isPinned = false, colorLabel = null, status = "draft")
        vm.loadNote(1)
        advanceTimeBy(100)
        // Simulate typing: user edits rich state => html changes
        vm.updateContent("<p>مرحبا</p>")
        assertEquals("saving", vm.saveStatus.value)
        advanceTimeBy(800) // debounce 750ms + margin
        assertEquals("saved", vm.saveStatus.value)
        assertEquals(listOf(1L to "<p>مرحبا</p>"), repo.updates)
    }

    @Test
    fun identicalContentIsNotSavedAgain() = runTest {
        repo.note = Note(id = 1, title = "ت", contentHtml = "", folderId = null,
            isFavorite = false, isDeleted = false, isPinned = false, colorLabel = null, status = "draft")
        vm.loadNote(1)
        advanceTimeBy(100)
        vm.updateContent("<p>نص</p>")
        advanceTimeBy(800)
        vm.updateContent("<p>نص</p>")
        advanceTimeBy(800)
        assertEquals(1, repo.updates.size)
    }

    @Test
    fun saveNowAsyncFlushesImmediately() = runTest {
        repo.note = Note(id = 2, title = "ت", contentHtml = "", folderId = null,
            isFavorite = false, isDeleted = false, isPinned = false, colorLabel = null, status = "draft")
        vm.loadNote(2)
        advanceTimeBy(100)
        vm.updateContent("<p>عاجل</p>")
        vm.saveNowAsync()
        delay(50)
        assertEquals(listOf(2L to "<p>عاجل</p>"), repo.updates)
    }
}
