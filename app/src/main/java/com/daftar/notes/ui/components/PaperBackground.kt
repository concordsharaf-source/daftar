package com.daftar.notes.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Lined-paper background. Ruled lines are drawn ONLY behind the text
 * region (the inner content area), never over the page margins or title,
 * giving a real notebook feel.
 *
 * @param lineHeightPx vertical step between ruled lines (matches text line height)
 * @param contentPadding horizontal padding inside which the lines are drawn
 * @param margin Dp width of the visual page margin (lines stop before it)
 */
@Composable
fun PaperBackground(
    lineHeightPx: Float,
    contentPadding: Dp = 20.dp,
    margin: Dp = 20.dp,
    content: @Composable () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    val lineColor = colors.outline.copy(alpha = 0.35f)

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        // The content column determines page size; draw lines relative to
        // the full background behind it, aligned to the text baseline grid.
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawPaperBackground(
                lineHeightPx = lineHeightPx,
                lineColor = lineColor,
                marginPx = margin.toPx(),
                contentPaddingPx = contentPadding.toPx(),
                totalHeight = size.height
            )
        }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = contentPadding)
        ) {
            content()
        }
    }
}

private fun DrawScope.drawPaperBackground(
    lineHeightPx: Float,
    lineColor: Color,
    marginPx: Float,
    contentPaddingPx: Float,
    totalHeight: Float
) {
    // Red margin line on the right side (RTL notebook margin)
    val red = Color(0xFFD86A6A)
    drawLine(
        color = red,
        start = Offset(size.width - marginPx * 1.5f, 0f),
        end = Offset(size.width - marginPx * 1.5f, totalHeight),
        strokeWidth = 3f
    )

    val startX = contentPaddingPx
    val endX = size.width - contentPaddingPx
    // First ruled line starts one line-height below the top
    var y = lineHeightPx * 2f
    while (y < totalHeight) {
        drawLine(
            color = lineColor,
            start = Offset(startX, y),
            end = Offset(endX, y),
            strokeWidth = 2f
        )
        y += lineHeightPx
    }
}
