package com.daftar.notes.security

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.daftar.notes.ui.theme.DaftarFonts

/**
 * Lock gate shown before the app content. Supports PIN + biometric unlock.
 */
@Composable
fun AppLockGate(
    onUnlocked: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val colors = MaterialTheme.colorScheme

    var pinInput by remember { mutableStateOf("") }
    var error by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (PinStore.hasPin(context)) {
            // Offer biometric first if enabled and hardware present
            val activity = context as? FragmentActivity
            if (activity != null && isBiometricAvailable(context)) {
                showBiometricPrompt(activity, context) { success ->
                    if (success) onUnlocked()
                }
            }
        } else {
            // No PIN configured: first run — treat any 4-digit PIN as setup
        }
    }

    val hasPin = PinStore.hasPin(context)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(80.dp))
        Text(
            text = "دفتر",
            fontFamily = DaftarFonts.Amiri,
            fontSize = 44.sp,
            fontWeight = FontWeight.Bold,
            color = colors.primary
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = if (hasPin) "أدخل رمز القفل" else "أنشئ رمز قفل لتأمين دفترك",
            fontFamily = DaftarFonts.Cairo,
            fontSize = 16.sp,
            color = colors.onSurfaceVariant
        )
        if (error) {
            Text(
                text = "الرمز غير صحيح",
                fontFamily = DaftarFonts.Cairo,
                fontSize = 13.sp,
                color = colors.error,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
        Spacer(modifier = Modifier.height(28.dp))

        // PIN dots
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            repeat(4) { i ->
                Box(
                    modifier = Modifier
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(if (i < pinInput.length) colors.primary else colors.surfaceVariant)
                )
            }
        }
        Spacer(modifier = Modifier.height(36.dp))

        // Numeric keypad
        KeypadColumn(
            onDigit = { d ->
                if (pinInput.length < 4) {
                    val next = pinInput + d
                    pinInput = next
                    error = false
                    if (next.length == 4) {
                        // Evaluate
                        if (!hasPin) {
                            // First-time setup: save this PIN
                            PinStore.setPin(context, next)
                            onUnlocked()
                        } else if (PinStore.verify(context, next)) {
                            // Unlock time is recorded by AppLockManager.recordUnlock()
                            onUnlocked()
                        } else {
                            error = true
                            pinInput = ""
                        }
                    }
                }
            },
            onDelete = {
                if (pinInput.isNotEmpty()) pinInput = pinInput.dropLast(1)
            }
        )

        Spacer(modifier = Modifier.height(10.dp))

        if (isBiometricAvailable(context) && hasPin) {
            IconButton(onClick = {
                val activity = context as? FragmentActivity
                if (activity != null) {
                    showBiometricPrompt(activity, context) { success ->
                        if (success) {
                            // Unlock time is recorded by AppLockManager.recordUnlock()
                            onUnlocked()
                        }
                    }
                }
            }) {
                Icon(
                    Icons.Default.Fingerprint,
                    contentDescription = "فتح بالبصمة",
                    tint = colors.primary,
                    modifier = Modifier.size(34.dp)
                )
            }
        }
    }
}

@Composable
private fun KeypadColumn(onDigit: (Char) -> Unit, onDelete: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val rows = listOf(listOf('1', '2', '3'), listOf('4', '5', '6'), listOf('7', '8', '9'), listOf(' ', '0', '⌫'))
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        rows.forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                row.forEach { ch ->
                    if (ch == ' ') {
                        Spacer(modifier = Modifier.size(72.dp))
                    } else if (ch == '⌫') {
                        IconButton(
                            onClick = onDelete,
                            modifier = Modifier
                                .size(72.dp)
                                .clip(CircleShape)
                        ) {
                            Icon(
                                Icons.Default.Backspace,
                                contentDescription = "حذف",
                                tint = colors.onSurface
                            )
                        }
                    } else {
                        Box(
                            modifier = Modifier
                                .size(72.dp)
                                .clip(CircleShape)
                                .background(colors.surface)
                                .border(1.dp, colors.outlineVariant, CircleShape)
                                .clickable { onDigit(ch) },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = ch.toString(),
                                fontFamily = DaftarFonts.Cairo,
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Medium,
                                color = colors.onSurface
                            )
                        }
                    }
                }
            }
        }
    }
}

fun isBiometricAvailable(context: Context): Boolean {
    val manager = BiometricManager.from(context)
    val can = manager.canAuthenticate(
        BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.BIOMETRIC_WEAK
    )
    return can == BiometricManager.BIOMETRIC_SUCCESS
}

private fun showBiometricPrompt(
    activity: FragmentActivity,
    context: Context,
    onResult: (Boolean) -> Unit
) {
    val executor = ContextCompat.getMainExecutor(context)
    val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            onResult(true)
        }

        override fun onAuthenticationFailed() {
            onResult(false)
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            onResult(false)
        }
    }
    val prompt = BiometricPrompt(activity, executor, callback)
    val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle("فتح دفتر")
        .setSubtitle("استخدم البصمة أو بصمة الوجه للفتح")
        .setNegativeButtonText("استخدام الرمز")
        .build()
    prompt.authenticate(info)
}
