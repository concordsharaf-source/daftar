package com.daftar.notes.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.daftar.notes.data.NotesRepository
import com.daftar.notes.data.Note
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class HomeViewModel(private val repo: NotesRepository) : ViewModel() {

    val searchQuery = MutableStateFlow("")

    val allNotes: StateFlow<List<Note>> = repo.getAllNotes()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val deletedNotes: StateFlow<List<Note>> = repo.getDeletedNotes()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val favoriteNotes: StateFlow<List<Note>> = repo.getFavoriteNotes()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val folders: StateFlow<List<com.daftar.notes.data.Folder>> = repo.getAllFolders()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val notes = combine(allNotes, searchQuery) { notes, query ->
        if (query.isBlank()) notes
        else notes.filter { note ->
            note.title.contains(query, ignoreCase = true) ||
                com.daftar.notes.util.TextUtils.stripHtml(note.contentHtml).contains(query, ignoreCase = true)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun search(q: String) { searchQuery.value = q }

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
    suspend fun moveToFolder(id: Long, folderId: Long?) = repo.moveNoteToFolder(id, folderId)
    suspend fun softDelete(id: Long) = repo.softDelete(id)
    suspend fun restoreNote(id: Long) = repo.restoreNote(id)
    suspend fun permanentDelete(id: Long) = repo.permanentDelete(id)
    suspend fun emptyTrash() = repo.emptyTrash()
    suspend fun restore(id: Long) = repo.restoreNote(id)

    suspend fun addFolder(name: String) = repo.insertFolder(name)
    suspend fun deleteFolder(id: Long) = repo.deleteFolder(id)
}
