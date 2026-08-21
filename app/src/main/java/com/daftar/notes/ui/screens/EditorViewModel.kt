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

    /** Note metadata (synced with the database row) so the editor
     *  UI stays in sync with what the home screen shows. */
    private val _notePinned = MutableStateFlow(false)
    val notePinned: StateFlow<Boolean> = _notePinned.asStateFlow()

    private val _noteFavorite = MutableStateFlow(false)
    val noteFavorite: StateFlow<Boolean> = _noteFavorite.asStateFlow()

    private val _noteColor = MutableStateFlow<String?>(null)
    val noteColor: StateFlow<String?> = _noteColor.asStateFlow()

    private val _noteStatus = MutableStateFlow("draft")
    val noteStatus: StateFlow<String> = _noteStatus.asStateFlow()

    private var dirty = false
    private var lastSavedHtml: String = ""
    private var lastSavedTitle: String = ""
    private var saveJob: Job? = null
    private var statusJob: Job? = null
    private var colorJob: Job? = null
    private var pinJob: Job? = null
    private var favoriteJob: Job? = null

    private val undoStack = ArrayDeque<String>()
    private val redoStack = ArrayDeque<String>()
    private val undoTitles = ArrayDeque<String>()
    private val redoTitles = ArrayDeque<String>()
    private var lastSnapshotHtml: String? = null
    private var lastSnapshotTitle: String? = null
    private var snapshotJob: Job? = null
    private var pendingSnapshotHtml: String? = null
    private var pendingSnapshotTitle: String? = null

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
            _notePinned.value = note.isPinned
            _noteFavorite.value = note.isFavorite
            _noteColor.value = note.colorLabel
            _noteStatus.value = note.status ?: "draft"
            dirty = false
            refreshImages()
        }
    }

    /** Auto-hide the "saved" chip so it stays quiet after a save. */
    private fun scheduleStatusIdle() {
        statusJob?.cancel()
        statusJob = viewModelScope.launch {
            delay(2500)
            _saveStatus.value = "idle"
        }
    }

    fun updateTitle(newTitle: String) {
        scheduleUndoSnapshot() // capture pre-edit state BEFORE the change applies
        _title.value = newTitle
        markDirty()
    }

    fun updateContent(html: String) {
        if (html == _contentHtml.value) return
        scheduleUndoSnapshot() // capture pre-edit state BEFORE the change applies
        _contentHtml.value = html
        markDirty()
    }

    /**
     * Auto-capture an undo snapshot before each edit, throttled so rapid typing
     * produces one reversible checkpoint instead of one per keystroke.
     */
    private fun scheduleUndoSnapshot() {
        val preHtml = _contentHtml.value
        val preTitle = _title.value
        if (preHtml == lastSnapshotHtml && preTitle == lastSnapshotTitle) return
        if (pendingSnapshotHtml == preHtml && pendingSnapshotTitle == preTitle) return
        snapshotJob?.cancel()
        snapshotJob = viewModelScope.launch {
            delay(1500)
            pendingSnapshotHtml = preHtml
            pendingSnapshotTitle = preTitle
            snapshotForUndo(preHtml, preTitle)
            pendingSnapshotHtml = null
            pendingSnapshotTitle = null
        }
    }

    private fun markDirty() {
        dirty = true
        _saveStatus.value = "saving"
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(750) // debounce DB writes
            flushSave()
            scheduleStatusIdle()
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

    /** Fire-and-forget flush for lifecycle-driven saves (screen stop/destroy). */
    fun flushSaveAsync() {
        viewModelScope.launch { saveNow() }
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

    /**
     * Public snapshot hook: captures the current state as a reversible
     * checkpoint and clears the redo history.
     */
    fun snapshotForUndo() {
        if (undoStack.size >= 50) undoStack.removeFirst()
        if (undoTitles.size >= 50) undoTitles.removeFirst()
        undoStack.addLast(_contentHtml.value)
        undoTitles.addLast(_title.value)
        lastSnapshotHtml = _contentHtml.value
        lastSnapshotTitle = _title.value
        redoStack.clear()
        redoTitles.clear()
        updateUndoRedoFlags()
    }

    /** Internal hook that pushes an explicit pre-edit state onto the stack. */
    private fun snapshotForUndo(preHtml: String, preTitle: String) {
        if (undoStack.size >= 50) undoStack.removeFirst()
        if (undoTitles.size >= 50) undoTitles.removeFirst()
        undoStack.addLast(preHtml)
        undoTitles.addLast(preTitle)
        lastSnapshotHtml = preHtml
        lastSnapshotTitle = preTitle
        redoStack.clear()
        redoTitles.clear()
        updateUndoRedoFlags()
    }

    /**
     * Undo the last captured edit. The RichTextState UI stays in sync via the
     * contentHtml state observer in EditorScreen, so the state does not need
     * to be passed in here (this also keeps the method unit-testable).
     */
    fun undo() {
        if (undoStack.isEmpty()) return
        redoStack.addLast(_contentHtml.value)
        redoTitles.addLast(_title.value)
        val prev = undoStack.removeLast()
        val prevTitle = undoTitles.removeLast()
        _title.value = prevTitle
        _contentHtml.value = prev
        lastSnapshotHtml = prev
        lastSnapshotTitle = prevTitle
        dirty = true
        markDirty()
        updateUndoRedoFlags()
    }

    /** Redo the previously undone edit. */
    fun redo() {
        if (redoStack.isEmpty()) return
        undoStack.addLast(_contentHtml.value)
        undoTitles.addLast(_title.value)
        val next = redoStack.removeLast()
        val nextTitle = redoTitles.removeLast()
        _title.value = nextTitle
        _contentHtml.value = next
        lastSnapshotHtml = next
        lastSnapshotTitle = nextTitle
        dirty = true
        markDirty()
        updateUndoRedoFlags()
    }

    private fun updateUndoRedoFlags() {
        _canUndo.value = undoStack.isNotEmpty()
        _canRedo.value = redoStack.isNotEmpty()
    }

    fun toggleFavorite(fav: Boolean) {
        _noteFavorite.value = fav
        favoriteJob?.cancel()
        favoriteJob = viewModelScope.launch {
            try {
                repo.updateFavorite(noteId, fav)
            } catch (e: Exception) {
                e.printStackTrace()
                // fall back to the pre-change value on failure
                _noteFavorite.value = !fav
            }
        }
    }

    fun togglePinned(pinned: Boolean) {
        _notePinned.value = pinned
        pinJob?.cancel()
        pinJob = viewModelScope.launch {
            try {
                repo.updatePinned(noteId, pinned)
            } catch (e: Exception) {
                e.printStackTrace()
                _notePinned.value = !pinned
            }
        }
    }

    fun updateColor(color: String?) {
        _noteColor.value = color
        colorJob?.cancel()
        colorJob = viewModelScope.launch {
            try {
                repo.updateColor(noteId, color)
            } catch (e: Exception) {
                e.printStackTrace()
                _noteColor.value = if (color == null) "#000000" else null
            }
        }
    }

    fun updateStatus(status: String) {
        _noteStatus.value = status
        val id = noteId
        viewModelScope.launch {
            try {
                repo.updateStatus(id, status)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
