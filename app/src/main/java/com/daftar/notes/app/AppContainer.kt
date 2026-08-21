package com.daftar.notes.app

import android.content.Context
import com.daftar.notes.data.DaftarDatabase
import com.daftar.notes.data.NotesRepository

class AppContainer(private val context: Context) {
    val appContext: Context get() = context.applicationContext
    val database: DaftarDatabase by lazy { DaftarDatabase.get(context) }
    val notesRepository: NotesRepository by lazy { NotesRepository(database.noteDao()) }

    init {
        instance = this
    }

    companion object {
        @Volatile
        private var instance: AppContainer? = null

        fun get(): AppContainer = instance ?: throw IllegalStateException("AppContainer not initialized")
    }
}
