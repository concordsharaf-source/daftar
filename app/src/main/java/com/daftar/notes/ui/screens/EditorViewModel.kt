package com.daftar.notes.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.daftar.notes.data.NotesRepository
import com.daftar.notes.data.Note
import com.daftar.notes.data.NoteImage
import com.mohamedrejeb.richeditor.model.RichTextState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Editor ViewModel with reliable auto-save:
 *  - In-memory state is the source of truth while editing.
 *  - Edits are debounced (750ms) and flushed to Room.
 *  - saveNow() flushes immediately (back press, lifecycle stop).
 *  - Undo/redo keeps HTML snapshots on a bounded stack.
 */
class EditorViewModel(private val repo: NotesRepository) : ViewModel() {

    var noteId: Long = 0L

    private val _title = MutableStateFlow("")
    val title: StateFlow<String> = _title.asStateFlow()

    private val _contentHtml = MutableStateFlow("")
    val contentHtml: StateFlow<String> = _contentHtml.asStateFlow()

    private val _images = MutableStateFlow<List<NoteImage>>(emptyList())
    val images: StateFlow<List<NoteImage>> = _images.asStateFlow()

    private val _canUndo = MutableStateFlow(false)
    val canUndo: StateFlow<Boolean> = _canUndo.asStateFlow()

    private val _canRedo = MutableStateFlow(false)
    val canRedo: StateFlow<Boolean> = _canRedo.asStateFlow()

    /** tiny save indicator: "idle" | "saving" | "saved" */
    private val _saveStatus = MutableStateFlow("idle")
    val saveStatus: StateFlow<String> = _saveStatus.asStateFlow()

    private var dirty = false
    private var lastSavedHtml: String = ""
    private var lastSavedTitle: String = ""
    private var saveJob: Job? = null

    private val undoStack = ArrayDeque<String>()
    private val redoStack = ArrayDeque<String>()
    private val undoTitles = ArrayDeque<String>()
    private val redoTitles = ArrayDeque<String>()

    fun repo(): NotesRepository = repo

    /** Load a note into memory (plain legacy notes are wrapped into HTML). */
    fun loadNote(id: Long) {
        noteId = id
        viewModelScope.launch {
            val note = repo.getNoteByIdOnce(id) ?: return@launch
            _title.value = note.title
            val html = note.contentHtml.let { if (it.isBlank()) "" else it }
            _contentHtml.value = html
            lastSavedHtml = html
            lastSavedTitle = note.title
            dirty = false
            refreshImages()
        }
    }

    fun updateTitle(newTitle: String) {
        _title.value = newTitle
        markDirty()
    }

    fun updateContent(html: String) {
        if (html == _contentHtml.value) return
        _contentHtml.value = html
        markDirty()
    }

    private fun markDirty() {
        dirty = true
        _saveStatus.value = "saving"
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(750) // debounce DB writes
            flushSave()
        }
    }

    /** Immediate synchronous-enough save before leaving the screen. */
    suspend fun saveNow() {
        saveJob?.cancel()
        flushSave()
    }

    fun saveNowAsync() {
        viewModelScope.launch { saveNow() }
    }

    private suspend fun flushSave() {
        if (!dirty) return
        val id = noteId
        val newTitle = _title.value.trim()
        val newHtml = _contentHtml.value
        try {
            repo.updateTitle(id, newTitle)
            repo.updateContent(id, newHtml)
            lastSavedTitle = newTitle
            lastSavedHtml = newHtml
            dirty = false
            _saveStatus.value = "saved"
        } catch (e: Exception) {
            e.printStackTrace()
            _saveStatus.value = "idle"
        }
    }

    fun refreshImages() {
        viewModelScope.launch {
            _images.value = repo.getImagesOnce(noteId)
        }
    }

    fun addImage(source: java.io.File) {
        viewModelScope.launch {
            repo.addImage(noteId, source)
            refreshImages()
        }
    }

    fun deleteImage(imageId: Long) {
        viewModelScope.launch {
            repo.deleteImage(imageId, noteId)
            refreshImages()
        }
    }

    // ---- Undo / Redo on HTML snapshots ----

    fun snapshotForUndo() {
        if (undoStack.size >= 50) undoStack.removeFirst()
        if (undoTitles.size >= 50) undoTitles.removeFirst()
        undoStack.addLast(_contentHtml.value)
        undoTitles.addLast(_title.value)
        redoStack.clear()
        redoTitles.clear()
        updateUndoRedoFlags()
    }

    fun undo(state: RichTextState) {
        if (undoStack.isEmpty()) return
        redoStack.addLast(_contentHtml.value)
        redoTitles.addLast(_title.value)
        val prev = undoStack.removeLast()
        val prevTitle = undoTitles.removeLast()
        _title.value = prevTitle
        _contentHtml.value = prev
        state.setHtml(prev)
        dirty = true
        markDirty()
        updateUndoRedoFlags()
    }

    fun redo(state: RichTextState) {
        if (redoStack.isEmpty()) return
        undoStack.addLast(_contentHtml.value)
        undoTitles.addLast(_title.value)
        val next = redoStack.removeLast()
        val nextTitle = redoTitles.removeLast()
        _title.value = nextTitle
        _contentHtml.value = next
        state.setHtml(next)
        dirty = true
        markDirty()
        updateUndoRedoFlags()
    }

    private fun updateUndoRedoFlags() {
        _canUndo.value = undoStack.isNotEmpty()
        _canRedo.value = redoStack.isNotEmpty()
    }

    suspend fun toggleFavorite(fav: Boolean) = repo.updateFavorite(noteId, fav)
    suspend fun togglePinned(pinned: Boolean) = repo.updatePinned(noteId, pinned)
    suspend fun updateColor(color: String?) = repo.updateColor(noteId, color)
    suspend fun updateStatus(status: String) = repo.updateStatus(noteId, status)
}
