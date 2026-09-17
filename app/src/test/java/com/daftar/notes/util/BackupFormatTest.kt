package com.daftar.notes.util

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * اختبارات توافق صيغة ملف النسخ الاحتياطي (JVM خالص).
 *
 * الملف هو عقد بين الإصدارات: يجب أن تبقى الملفات القديمة قابلة للقراءة،
 * ويجب ألا تفسد الحقول الجديدة قراءة الملفات القديمة.
 */
class BackupFormatTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true; ignoreUnknownKeys = true }

    private fun sampleNote(title: String = "ملاحظة") = BackupManager.BackupNote(
        title = title,
        contentHtml = "<p>محتوى <b>غني</b></p>",
        isFavorite = true,
        isPinned = false,
        colorLabel = "#FF8A65",
        status = "draft",
        createdAt = 1_700_000_000_000L,
        updatedAt = 1_700_000_500_000L,
        images = listOf("images/1/img_1.jpg")
    )

    @Test
    fun v3BackupRoundTrips() {
        val original = BackupManager.BackupFile(
            version = 3,
            exportedAt = 1_700_000_900_000L,
            notes = listOf(sampleNote(), sampleNote(title = "ثانية"))
        )
        val encoded = json.encodeToString(BackupManager.BackupFile.serializer(), original)
        val decoded = json.decodeFromString(BackupManager.BackupFile.serializer(), encoded)

        assertEquals(3, decoded.version)
        assertEquals(2, decoded.notes.size)
        assertEquals("ملاحظة", decoded.notes[0].title)
        assertEquals("<p>محتوى <b>غني</b></p>", decoded.notes[0].contentHtml)
        assertEquals(listOf("images/1/img_1.jpg"), decoded.notes[0].images)
        assertEquals(original.exportedAt, decoded.exportedAt)
    }

    @Test
    fun legacyV2JsonWithoutImagesFieldIsReadable() {
        // نسخة قديمة (v2) بلا حقل images ولا version
        val legacy = """
            {
              "exportedAt": 1600000000000,
              "notes": [
                {
                  "title": "قديمة",
                  "contentHtml": "<p>نص</p>",
                  "isFavorite": false,
                  "isPinned": true,
                  "colorLabel": null,
                  "status": "done",
                  "createdAt": 1599999999000,
                  "updatedAt": 1600000000000
                }
              ]
            }
        """.trimIndent()

        val decoded = json.decodeFromString(BackupManager.BackupFile.serializer(), legacy)
        assertEquals(1, decoded.notes.size)
        assertEquals("قديمة", decoded.notes[0].title)
        assertTrue("غياب images يعني قائمة فارغة", decoded.notes[0].images.isEmpty())
        assertEquals("الإصدار الافتراضي 3 لحقل مفقود", 3, decoded.version)
    }

    @Test
    fun unknownFutureFieldsDoNotBreakParsing() {
        val future = """
            {
              "version": 9,
              "exportedAt": 1700000000000,
              "notes": [],
              "somethingNew": {"a": 1}
            }
        """.trimIndent()
        val decoded = json.decodeFromString(BackupManager.BackupFile.serializer(), future)
        assertEquals(9, decoded.version)
        assertTrue(decoded.notes.isEmpty())
    }

    @Test
    fun brokenJsonFailsInsteadOfReturningGarbage() {
        val invalid = "{ this is not json"
        val result = runCatching { json.decodeFromString(BackupManager.BackupFile.serializer(), invalid) }
        assertTrue("يجب أن يفشل التحليل بوضوح", result.isFailure)
        assertNull(result.getOrNull())
    }
}
