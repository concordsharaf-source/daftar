package com.daftar.notes.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [Note::class, Folder::class, NoteImage::class],
    version = 2,
    exportSchema = false
)
abstract class DaftarDatabase : androidx.room.RoomDatabase() {
    abstract fun noteDao(): NoteDao

    companion object {
        @Volatile
        private var INSTANCE: DaftarDatabase? = null

        fun get(context: Context): DaftarDatabase {
            return INSTANCE ?: synchronized(this) {
                val db = Room.databaseBuilder(
                    context.applicationContext,
                    DaftarDatabase::class.java,
                    "daftar_notes.db"
                )
                    .addMigrations(MIGRATION_1_2)
                    .build()
                INSTANCE = db
                db
            }
        }

        // v1 had: notes(id, title, content, folderId, isFavorite, isDeleted, createdAt)
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                // Preserve legacy plain-text notes by renaming the table
                database.execSQL(
                    """
                    CREATE TABLE notes_backup (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        folderId INTEGER,
                        isFavorite INTEGER NOT NULL,
                        isDeleted INTEGER NOT NULL,
                        createdAt INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
                database.execSQL(
                    "INSERT INTO notes_backup SELECT id, title, content, folderId, isFavorite, isDeleted, createdAt FROM notes"
                )
                database.execSQL("DROP TABLE notes")
                // v2 schema
                database.execSQL(
                    """
                    CREATE TABLE notes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        title TEXT NOT NULL,
                        contentHtml TEXT NOT NULL,
                        folderId INTEGER,
                        isFavorite INTEGER NOT NULL,
                        isDeleted INTEGER NOT NULL,
                        isPinned INTEGER NOT NULL,
                        colorLabel TEXT,
                        status TEXT NOT NULL DEFAULT 'draft',
                        createdAt INTEGER NOT NULL,
                        updatedAt INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
                database.execSQL(
                    "INSERT INTO notes (id, title, contentHtml, folderId, isFavorite, isDeleted, isPinned, status, createdAt, updatedAt) SELECT id, title, '<p>' || REPLACE(REPLACE(content, X'0A', '</p><p>'), '&', '&amp;') || '</p>', folderId, isFavorite, isDeleted, 0, 'draft', createdAt, createdAt FROM notes_backup"
                )
                database.execSQL("DROP TABLE notes_backup")
                database.execSQL(
                    """
                    CREATE TABLE folders (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        name TEXT NOT NULL,
                        createdAt INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
                database.execSQL(
                    """
                    CREATE TABLE note_images (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        noteId INTEGER NOT NULL,
                        filePath TEXT NOT NULL,
                        `order` INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
            }
        }
    }
}
