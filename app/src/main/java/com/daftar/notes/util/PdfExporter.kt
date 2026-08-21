package com.daftar.notes.util

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import kotlinx.coroutines.runBlocking
import android.graphics.pdf.PdfDocument
import android.os.Environment
import android.text.StaticLayout
import android.text.TextPaint
import android.text.Layout
import org.jsoup.Jsoup
import java.io.File

/**
 * Renders a rich HTML note to a PDF file with preserved formatting:
 * headings (bold + larger size), bold/italic spans, highlight colors,
 * text colors, unordered/ordered lists, images, and RTL direction.
 */
object PdfExporter {

    private const val PAGE_WIDTH = 595f // A4
    private const val PAGE_HEIGHT = 842f
    private const val MARGIN = 56f
    private val CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN

    data class Block(
        val text: String,
        val size: Float,
        val bold: Boolean,
        val italic: Boolean,
        val highlight: Int?,
        val textColor: Int?,
        val isHeading: Boolean,
        val bullet: String?,
        val image: String?,
        val align: Int // 0 = start (right in RTL)
    )

    /** Parse HTML into renderable blocks. */
    fun htmlToBlocks(html: String): List<Block> {
        val doc = Jsoup.parse(html)
        val blocks = mutableListOf<Block>()
        for (element in doc.body().children()) {
            parseElement(element, blocks)
        }
        if (blocks.isEmpty() && doc.body().text().isNotBlank()) {
            blocks.add(defaultBlock(doc.body().text()))
        }
        return blocks
    }

    private fun parseElement(element: org.jsoup.nodes.Element, blocks: MutableList<Block>) {
        val tag = element.tagName().lowercase()
        when {
            tag == "h1" -> blocks.add(buildBlock(element, size = 26f, heading = true))
            tag == "h2" -> blocks.add(buildBlock(element, size = 22f, heading = true))
            tag == "h3" -> blocks.add(buildBlock(element, size = 19f, heading = true))
            tag == "p" || tag == "div" -> {
                val img = element.selectFirst("img")
                if (img != null && element.select("img").size == 1 && element.text().isBlank()) {
                    img.attr("src")?.let { blocks.add(Block("", 16f, false, false, null, null, false, null, it, 0)) }
                } else {
                    blocks.add(buildBlock(element, size = 16f))
                }
            }
            tag == "ul" -> element.select("li").forEach { li ->
                blocks.add(buildBlock(li, size = 16f, bullet = "•"))
            }
            tag == "ol" -> element.select("li").forEachIndexed { idx, li ->
                blocks.add(buildBlock(li, size = 16f, bullet = "${idx + 1}."))
            }
            element.tagName().startsWith("h") -> {
                val n = tag.removePrefix("h").toIntOrNull() ?: 2
                blocks.add(buildBlock(element, size = (28 - n * 2f).coerceIn(16f, 26f), heading = true))
            }
            else -> {
                // stray text
                if (element.text().isNotBlank()) blocks.add(buildBlock(element, size = 16f))
            }
        }
    }

    private fun buildBlock(element: org.jsoup.nodes.Element, size: Float, heading: Boolean = false, bullet: String? = null): Block {
        val clone = element.clone()
        clone.select("img").remove()
        val text = clone.wholeText().replace(Regex("\\s+"), " ").trim()
        // dominant style
        var bold = heading || element.select("b, strong").isNotEmpty()
        var italic = element.select("i, em").isNotEmpty()
        var highlight: Int? = null
        var textColor: Int? = null
        // pick first span with color/background
        element.select("span").firstOrNull { !it.attr("style").isBlank() }?.let { span ->
            val style = span.attr("style")
            val bgMatch = Regex("""background(?:-color)?\s*:\s*(#\w+|rgba?\([^)]*\))""", RegexOption.IGNORE_CASE).find(style)
            val fgMatch = Regex("""(?:^|;\s*)color\s*:\s*(#\w+|rgba?\([^)]*\))""", RegexOption.IGNORE_CASE).find(style)
            highlight = bgMatch?.groupValues?.get(1)?.let { cssColorToAndroid(it) }
            textColor = fgMatch?.groupValues?.get(1)?.let { cssColorToAndroid(it) }
        }
        return Block(text, size, bold, italic, highlight, textColor, heading, bullet, null, 0)
    }

    private fun defaultBlock(text: String) = Block(text, 16f, false, false, null, null, false, null, null, 0)

    private fun cssColorToAndroid(css: String): Int? {
        return if (css.startsWith("#") && css.length in 4..9) {
            try { android.graphics.Color.parseColor(css) } catch (e: Exception) { null }
        } else if (css.startsWith("rgb")) {
            rgbToAndroid(css)
        } else {
            null
        }
    }

    private fun rgbToAndroid(rgb: String): Int? {
        val nums = Regex("""\d+""").findAll(rgb).map { it.value.toInt() }.toList()
        return if (nums.size >= 3) {
            val a = if (nums.size == 4) (nums[3] * 2.55).toInt().coerceIn(0, 255) else 255
            Color.argb(a, nums[0], nums[1], nums[2])
        } else null
    }

    suspend fun exportRichNoteToPdf(
        context: Context,
        title: String,
        html: String,
        imagePaths: List<String>,
        outputFile: File
    ): Boolean {
        return try {
            val blocks = htmlToBlocks(html)
            val doc = PdfDocument()
            val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)

            var pageIndex = 0
            var page = startPage(doc, pageIndex)
            var canvas = page.second

            // Title
            textPaint.typeface = Typeface.create("Noto Naskh Arabic", Typeface.BOLD)
            textPaint.textSize = 30f
            textPaint.color = Color.BLACK
            writeText(canvas, textPaint, title, underline = true)
            writeVerticalGap(canvas, 10f)
            if (currentPageHeight(page.first) > PAGE_HEIGHT - 120) {
                finishPage(doc, page.first)
                pageIndex++
                page = startPage(doc, pageIndex)
                canvas = page.second
            }

            // Body
            textPaint.textSize = 16f
            for (block in blocks) {
                if (block.image != null) {
                    writeImage(canvas, block.image)
                    continue
                }
                if (block.text.isBlank() && block.bullet == null) continue

                textPaint.typeface = Typeface.create(
                    if (block.italic) Typeface.SERIF else Typeface.SANS_SERIF,
                    if (block.bold) Typeface.BOLD else Typeface.NORMAL
                )
                textPaint.textSize = block.size
                textPaint.color = block.textColor ?: Color.BLACK
                textPaint.bgColor = block.highlight ?: 0

                val prefix = block.bullet?.let { "$it " } ?: ""
                val leading = (block.size.toDouble() * 1.6).coerceAtLeast(20.0)
                writeText(canvas, textPaint, prefix + block.text, leading = leading)
                writeVerticalGap(canvas, 4f)

                if (currentPageHeight(page.first) > PAGE_HEIGHT - 60) {
                    finishPage(doc, page.first)
                    pageIndex++
                    page = startPage(doc, pageIndex)
                    canvas = page.second
                }
            }

            finishPage(doc, page.first)

            outputFile.outputStream().use { doc.writeTo(it) }
            doc.close()
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    private fun startPage(doc: PdfDocument, index: Int): Pair<PdfDocument.Page, Canvas> {
        val pageInfo = PdfDocument.PageInfo.Builder(PAGE_WIDTH.toInt(), PAGE_HEIGHT.toInt(), index).create()
        val page = doc.startPage(pageInfo)
        return page to page.canvas
    }

    private fun finishPage(doc: PdfDocument, page: PdfDocument.Page) {
        doc.finishPage(page)
    }

    private fun currentPageHeight(page: PdfDocument.Page): Float =
        try { page.canvas.getClipBounds().bottom.toFloat() } catch (e: Exception) { 0f }

    private fun writeText(canvas: Canvas, paint: TextPaint, text: String, leading: Double? = null, underline: Boolean = false) {
        val width = CONTENT_WIDTH.coerceAtLeast(100f)
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, width.toInt())
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setLineSpacing((leading ?: paint.textSize.toDouble() * 1.5).toFloat(), 1.0f)
            .setIncludePad(false)
            .build()
        layout.draw(canvas)
        canvas.translate(0f, layout.height.toFloat())
        if (underline) {
            val linePaint = Paint().apply {
                color = Color.BLACK
                strokeWidth = 3f
            }
            canvas.drawLine(MARGIN, -14f, PAGE_WIDTH - MARGIN, -14f, linePaint)
            canvas.translate(0f, 24f)
        }
    }

    private fun writeImage(canvas: Canvas, path: String) {
        try {
            val file = File(path)
            if (!file.exists()) return
            val options = BitmapFactory.Options().apply { inSampleSize = 2 }
            val bmp = BitmapFactory.decodeFile(file.absolutePath, options) ?: return
            val maxW = CONTENT_WIDTH.toInt()
            val scale = (maxW.toFloat() / bmp.width).coerceAtMost(1f)
            val w = (bmp.width * scale).toInt()
            val h = (bmp.height * scale).toInt()
            canvas.drawBitmap(bmp, MARGIN, 0f, null)
            canvas.translate(0f, (h + 16).toFloat())
            bmp.recycle()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun writeVerticalGap(canvas: Canvas, dp: Float) {
        canvas.translate(0f, dp)
    }

    /** Legacy export for plain-text notes (v1 format). */
    fun exportNoteToPdf(context: Context, title: String, plainText: String, outputFile: File): Boolean {
        val html = plainText.lines().joinToString("") { "<p>$it</p>" }
        return runBlocking { exportRichNoteToPdf(context, title, html, emptyList(), outputFile) }
    }
}
