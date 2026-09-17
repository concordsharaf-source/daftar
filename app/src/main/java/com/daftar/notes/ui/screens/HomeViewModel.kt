package com.daftar.notes.ui.screens

import android.icu.text.Collator
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.daftar.notes.data.NotesRepository
import com.daftar.notes.data.Note
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class HomeViewModel(private val repo: NotesRepository) : ViewModel() {

    val searchQuery = MutableStateFlow("")

    val sortMode = MutableStateFlow("newest")

    private val arabicCollator = Collator.getInstance(java.util.Locale("ar"))

    val allNotes: StateFlow<List<Note>> = repo.getAllNotes()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val deletedNotes: StateFlow<List<Note>> = repo.getDeletedNotes()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val favoriteNotes: StateFlow<List<Note>> = repo.getFavoriteNotes()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val folders: StateFlow<List<com.daftar.notes.data.Folder>> = repo.getAllFolders()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /**
     * نص الملاحظة المُجهَّز للبحث (HTML مُزال + أحرف صغيرة).
     * يُحسب مرة واحدة لكل تغيير في قاعدة البيانات بدل حسابه عند كل ضغطة مفتاح
     * (كان stripHtml يُنفَّذ على كل الملاحظات في كل حرف يكتبه المستخدم).
     */
    private data class IndexedNote(val note: Note, val searchText: String)

    private val indexedNotes: StateFlow<List<IndexedNote>> = repo.getAllNotes()
        .map { list ->
            list.map { note ->
                IndexedNote(
                    note = note,
                    searchText = com.daftar.notes.util.TextUtils.stripHtml(note.contentHtml).lowercase()
                )
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val notes: StateFlow<List<Note>> =
        combine(indexedNotes, searchQuery, sortMode) { indexed, query, mode ->
            val needle = query.trim()
            val filtered = if (needle.isBlank()) {
                indexed.map { it.note }
            } else {
                val lower = needle.lowercase()
                indexed
                    .filter { it.note.title.contains(needle, ignoreCase = true) || it.searchText.contains(lower) }
                    .map { it.note }
            }
            sortNotes(filtered, mode)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun search(q: String) { searchQuery.value = q }

    fun setSortMode(mode: String) { sortMode.value = mode }

    /** Requirement #10: newest / oldest / alphabetical (latin) / alphabetical (Arabic). */
    private fun sortNotes(notes: List<Note>, mode: String): List<Note> {
        return when (mode) {
            "oldest" -> notes.sortedBy { it.updatedAt }
            "alpha" -> notes.sortedWith(compareBy(arabicCollator) { it.title.ifBlank { "بدون عنوان" } })
            "alphaAr" -> notes.sortedWith(compareBy(naturalArabicCollator()) { it.title.ifBlank { "بدون عنوان" } })
            else -> notes // newest (pinned notes are always grouped on top by the UI)
        }
    }

    /** A collator that normalizes Arabic diacritics and hamza forms for fair A-Z Arabic sorting. */
    private fun naturalArabicCollator(): java.util.Comparator<String> = Comparator { a, b ->
        arabicCollator.compare(normalizeArabic(a), normalizeArabic(b))
    }

    companion object {
        private val HAMZA_MAP = mapOf(
            'أ' to 'ا', 'إ' to 'ا', 'آ' to 'ا', 'ؤ' to 'و', 'ئ' to 'ي'
        )
        private val DIACRITICS = Regex("[\u064B-\u065F\u0670\u0640]")
        fun normalizeArabic(text: String): String =
            text.map { HAMZA_MAP.getOrDefault(it, it) }.joinToString("")
                .replace(DIACRITICS, "")
    }

    suspend fun createNote(): Long {
        return try {
            repo.insertNote(Note(status = "draft"))
        } catch (e: Exception) {
            e.printStackTrace()
            0L
        }
    }

    suspend fun updateTitle(id: Long, title: String) = repo.updateTitle(id, title)
    suspend fun toggleFavorite(id: Long, fav: Boolean) = repo.updateFavorite(id, fav)
    suspend fun togglePinned(id: Long, pinned: Boolean) = repo.updatePinned(id, pinned)
    suspend fun updateColor(id: Long, color: String?) = repo.updateColor(id, color)
    suspend fun updateStatus(id: Long, status: String) = repo.updateStatus(id, status)
    suspend fun moveToFolder(id: Long, folderId: Long?) = repo.moveNoteToFolder(id, folderId)
    suspend fun softDelete(id: Long) = repo.softDelete(id)
    suspend fun restoreNote(id: Long) = repo.restoreNote(id)
    suspend fun permanentDelete(id: Long) = repo.permanentDelete(id)
    suspend fun emptyTrash() = repo.emptyTrash()
    suspend fun restore(id: Long) = repo.restoreNote(id)

    suspend fun addFolder(name: String) = repo.insertFolder(name)
    suspend fun deleteFolder(id: Long) = repo.deleteFolder(id)
}
