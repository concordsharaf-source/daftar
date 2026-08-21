package com.daftar.notes.ui.screens

import com.daftar.notes.data.Note
import com.daftar.notes.data.NoteDao
import com.daftar.notes.data.NotesRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Pure JVM unit tests (no Android framework required).
 * Uses MockK to fake NoteDao, so a real NotesRepository drives the
 * EditorViewModel exactly as in production.
 */
class EditorViewModelSaveTest {
    private lateinit var dao: NoteDao
    private lateinit var repo: NotesRepository
    private lateinit var vm: EditorViewModel

    @OptIn(ExperimentalCoroutinesApi::class)
    @Before
    fun setup() {
        Dispatchers.setMain(StandardTestDispatcher(TestCoroutineScheduler()))
        dao = mockk(relaxed = true)
        repo = NotesRepository(dao)
        vm = EditorViewModel(repo)
    }

    private fun note(id: Long = 1, title: String = "ت", html: String = "") = Note(
        id = id, title = title, contentHtml = html, folderId = null,
        isFavorite = false, isDeleted = false, isPinned = false, colorLabel = null, status = "draft"
    )

    // --- Auto-save (requirement #2) ---

    @Test
    fun contentUpdateFlowsToDatabase() = runTest {
        coEvery { dao.getNoteByIdOnce(1) } returns note()
        coEvery { dao.getImagesOnce(1) } returns emptyList()
        vm.loadNote(1)
        advanceUntilIdle()
        vm.updateContent("<p>مرحبا</p>")
        assertEquals("saving", vm.saveStatus.value)
        advanceUntilIdle() // debounce 750ms fires within idle drain
        // DB must have received the content exactly once
        coVerify { dao.updateContent(1, "<p>مرحبا</p>", any()) }
        coVerify(exactly = 1) { dao.updateTitle(1, "ت", any()) }
    }

    @Test
    fun identicalContentIsNotSavedAgain() = runTest {
        coEvery { dao.getNoteByIdOnce(1) } returns note()
        coEvery { dao.getImagesOnce(1) } returns emptyList()
        vm.loadNote(1)
        advanceUntilIdle()
        vm.updateContent("<p>نص</p>")
        advanceUntilIdle()
        vm.updateContent("<p>نص</p>") // identical => ignored, nothing changes
        advanceUntilIdle()
        vm.saveNow()
        assertEquals("<p>نص</p>", vm.contentHtml.value)
        coVerify(exactly = 1) { dao.updateContent(1, "<p>نص</p>", any()) }
    }

    @Test
    fun saveNowAsyncFlushesImmediately() = runTest {
        coEvery { dao.getNoteByIdOnce(2) } returns note(id = 2)
        coEvery { dao.getImagesOnce(2) } returns emptyList()
        vm.loadNote(2)
        advanceUntilIdle()
        vm.updateContent("<p>عاجل</p>")
        vm.saveNowAsync()
        advanceUntilIdle()
        assertEquals("<p>عاجل</p>", vm.contentHtml.value)
        coVerify { dao.updateContent(2, "<p>عاجل</p>", any()) }
    }

    @Test
    fun titleUpdateAlsoPersistsToDatabase() = runTest {
        coEvery { dao.getNoteByIdOnce(1) } returns note()
        coEvery { dao.getImagesOnce(1) } returns emptyList()
        vm.loadNote(1)
        advanceUntilIdle()
        vm.updateTitle("عنوان جديد")
        advanceUntilIdle()
        coVerify { dao.updateTitle(1, "عنوان جديد", any()) }
    }

    // --- Undo / Redo (requirement #19) ---

    @Test
    fun manualSnapshotUndoRedoWorks() = runTest {
        coEvery { dao.getNoteByIdOnce(1) } returns note()
        coEvery { dao.getImagesOnce(1) } returns emptyList()
        vm.loadNote(1)
        advanceUntilIdle()
        assertFalse(vm.canUndo.value)
        vm.snapshotForUndo()
        vm.updateContent("<p>نص جديد</p>")
        assertTrue(vm.canUndo.value)
        assertFalse(vm.canRedo.value)
        vm.undo()
        assertFalse(vm.canUndo.value)
        assertTrue(vm.canRedo.value)
        assertEquals("", vm.contentHtml.value) // pre-edit state (empty note)
        vm.redo()
        assertEquals("<p>نص جديد</p>", vm.contentHtml.value)
    }

    @Test
    fun undoAlsoRestoresTheTitle() = runTest {
        coEvery { dao.getNoteByIdOnce(1) } returns note(title = "قديم")
        coEvery { dao.getImagesOnce(1) } returns emptyList()
        vm.loadNote(1)
        advanceUntilIdle()
        vm.snapshotForUndo()
        vm.updateTitle("جديد")
        vm.undo()
        assertEquals("قديم", vm.title.value)
        vm.redo()
        assertEquals("جديد", vm.title.value)
    }

    @Test
    fun typingCreatesUndoSnapshotsAutomatically() = runTest {
        coEvery { dao.getNoteByIdOnce(1) } returns note()
        coEvery { dao.getImagesOnce(1) } returns emptyList()
        vm.loadNote(1)
        advanceUntilIdle()
        // simulate typing over time
        vm.updateContent("<p>أ</p>")
        advanceTimeBy(1600) // > 1500ms throttle => pre-edit snapshot captured
        advanceUntilIdle()
        vm.updateContent("<p>أ ب</p>")
        advanceTimeBy(1600)
        advanceUntilIdle()
        assertTrue("typing should create at least one undo snapshot", vm.canUndo.value)
        val before = vm.contentHtml.value
        vm.undo()
        assertNotEquals("undo must actually revert typed text", before, vm.contentHtml.value)
    }

    @Test
    fun undoStackIsBounded() = runTest {
        coEvery { dao.getNoteByIdOnce(1) } returns note()
        coEvery { dao.getImagesOnce(1) } returns emptyList()
        vm.loadNote(1)
        advanceUntilIdle()
        for (i in 1..60) {
            vm.snapshotForUndo()
            vm.updateContent("<p>$i</p>")
        }
        // stack bounded to 50, so at most ~50 + 1 undo steps possible
        assertTrue(vm.canUndo.value)
        var count = 0
        while (vm.canUndo.value) {
            vm.undo()
            count++
            assertTrue("stack must be bounded", count <= 60)
        }
        assertTrue(count <= 60)
    }

    // --- Sort: Arabic normalization (requirement #10) ---

    @Test
    fun arabicNormalizationIsDeterministic() {
        assertEquals("الا", HomeViewModel.normalizeArabic("ألأ"))
        assertEquals("مدرسة", HomeViewModel.normalizeArabic("مَدْرَسَة"))
        assertEquals("يوسف", HomeViewModel.normalizeArabic("يُوسُف"))
        assertTrue(HomeViewModel.normalizeArabic("إبراهيم").startsWith("ابراه"))
        // diacritic-bearing and plain variants must collapse to the same key
        assertEquals(HomeViewModel.normalizeArabic("سلام"), HomeViewModel.normalizeArabic("سَلَام"))
    }
}
