package com.daftar.notes.data

import android.content.Context
import java.io.File

/**
 * إدارة ملفات صور الملاحظات داخل التخزين الخاص بالتطبيق.
 *
 * فُصلت عن [NotesRepository] لأن المستودع كان يصل إلى `AppContainer` العام
 * (`AppContainer.get()`) للحصول على السياق، ما يجعل اختباره خارج التطبيق
 * مستحيلًا. الآن يُمرَّر المُخزِّن كاعتمادية صريحة.
 */
class NoteFileStore(private val context: Context) {

    private val rootDir: File
        get() = context.getDir("notes", Context.MODE_PRIVATE)

    /** مجلد ملاحظة واحدة: files/notes/<noteId>/images */
    fun imagesDir(noteId: Long): File = File(File(rootDir, noteId.toString()), "images")

    /** ينسخ صورة إلى مجلد الملاحظة ويعيد الملف الجديد (بمسار مطلق). */
    fun copyInto(noteId: Long, source: File): File {
        val dir = imagesDir(noteId).apply { mkdirs() }
        val dest = File(dir, "img_${System.currentTimeMillis()}_${source.nameWithoutExtension}.jpg")
        source.inputStream().use { input ->
            dest.outputStream().use { output -> input.copyTo(output) }
        }
        return dest
    }

    /** يحذف كل ملفات ملاحظة (يُستدعى بعد الحذف النهائي). */
    fun deleteNoteFiles(noteId: Long) {
        runCatching { File(rootDir, noteId.toString()).deleteRecursively() }
    }

    /** مجلدات الصور التي لم تعد تخص أي ملاحظة موجودة. */
    fun orphanNoteDirs(liveIds: Set<Long>): List<File> =
        rootDir.listFiles()
            ?.filter { dir -> dir.isDirectory && dir.name.toLongOrNull()?.let { it !in liveIds } == true }
            ?: emptyList()
}
