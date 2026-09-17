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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.daftar.notes.ui.theme.DaftarFonts
import com.daftar.notes.util.SettingsStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** وضع بوابة القفل. */
enum class LockGateMode {
    /** لا يوجد رمز بعد: أنشئ رمزًا جديدًا (إدخال + تأكيد). */
    SETUP,

    /** يوجد رمز: تحقّق منه. */
    VERIFY
}

/**
 * بوابة القفل: إنشاء رمز أو التحقق منه، مع دعم البصمة عند تفعيلها.
 *
 * استُبدلت النسخة السابقة التي كانت تعتمد على تدفق غير قابل للوصول
 * (تعيين الرمز لم يكن يُستدعى من أي مكان) بمسارين واضحين.
 */
@Composable
fun AppLockGate(
    mode: LockGateMode,
    appLockManager: AppLockManager,
    onUnlocked: () -> Unit,
    onSkipSetup: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme
    val settings = remember { SettingsStore(context.applicationContext) }
    val biometricEnabled by settings.biometricEnabled.collectAsState(initial = false)
    val biometricAvailable = remember { isBiometricAvailable(context) }

    var pinInput by remember { mutableStateOf("") }
    var firstEntry by remember { mutableStateOf("") }
    var stage by remember { mutableStateOf(0) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var lockRemainingMs by remember { mutableLongStateOf(PinStore.lockRemainingMs(context)) }
    var biometricPromptShown by remember { mutableStateOf(false) }

    // عدّاد تنازلي للقفل المؤقت بعد المحاولات الفاشلة
    LaunchedEffect(lockRemainingMs > 0L) {
        while (lockRemainingMs > 0L) {
            delay(250)
            lockRemainingMs = PinStore.lockRemainingMs(context)
        }
    }

    // عرض البصمة تلقائيًا مرة واحدة في وضع التحقق
    LaunchedEffect(mode, biometricEnabled, biometricAvailable) {
        if (mode == LockGateMode.VERIFY && biometricEnabled && biometricAvailable && !biometricPromptShown) {
            biometricPromptShown = true
            val ok = runBiometricPrompt(context, appLockManager, "فتح دفتر")
            if (ok) onUnlocked()
        }
    }

    val title = when (mode) {
        LockGateMode.SETUP -> if (stage == 0) "أنشئ رمز قفل من 4 أرقام" else "أعد إدخال الرمز للتأكيد"
        LockGateMode.VERIFY -> "أدخل رمز القفل"
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(72.dp))
        Text(
            text = "دفتر",
            fontFamily = DaftarFonts.Amiri,
            fontSize = 44.sp,
            fontWeight = FontWeight.Bold,
            color = colors.primary
        )
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = title,
            fontFamily = DaftarFonts.Cairo,
            fontSize = 16.sp,
            textAlign = TextAlign.Center,
            color = colors.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(8.dp))
        errorText?.let { msg ->
            Text(
                text = msg,
                fontFamily = DaftarFonts.Cairo,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                color = colors.error,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
        Spacer(modifier = Modifier.height(24.dp))

        // نقاط الرمز
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            repeat(PinStore.PIN_LENGTH) { i ->
                Box(
                    modifier = Modifier
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(if (i < pinInput.length) colors.primary else colors.surfaceVariant)
                )
            }
        }
        Spacer(modifier = Modifier.height(32.dp))

        val inputEnabled = lockRemainingMs == 0L
        KeypadColumn(
            onDigit = { digit ->
                if (!inputEnabled) return@KeypadColumn
                if (pinInput.length < PinStore.PIN_LENGTH) {
                    pinInput += digit
                    errorText = null
                    if (pinInput.length == PinStore.PIN_LENGTH) {
                        when (mode) {
                            LockGateMode.SETUP -> {
                                if (stage == 0) {
                                    firstEntry = pinInput
                                    pinInput = ""
                                    stage = 1
                                } else if (pinInput == firstEntry) {
                                    scope.launch {
                                        appLockManager.configurePin(pinInput)
                                        onUnlocked()
                                    }
                                } else {
                                    errorText = "الرمزان غير متطابقين، أعد المحاولة"
                                    stage = 0
                                    firstEntry = ""
                                    pinInput = ""
                                }
                            }
                            LockGateMode.VERIFY -> {
                                val candidate = pinInput
                                pinInput = ""
                                if (PinStore.verify(context, candidate)) {
                                    scope.launch { onUnlocked() }
                                } else {
                                    lockRemainingMs = PinStore.lockRemainingMs(context)
                                    errorText = if (lockRemainingMs > 0L) {
                                        "محاولات كثيرة خاطئة، انتظر قليلًا"
                                    } else {
                                        "الرمز غير صحيح — المحاولات المتبقية: ${PinStore.remainingAttempts(context)}"
                                    }
                                }
                            }
                        }
                    }
                }
            },
            onDelete = { if (inputEnabled && pinInput.isNotEmpty()) pinInput = pinInput.dropLast(1) },
            enabled = inputEnabled
        )

        if (lockRemainingMs > 0L) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "الإدخال مقفل مؤقتًا: ${(lockRemainingMs / 1000) + 1} ثانية",
                fontFamily = DaftarFonts.Cairo,
                fontSize = 13.sp,
                color = colors.error
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (mode == LockGateMode.VERIFY && biometricEnabled && biometricAvailable) {
            Spacer(modifier = Modifier.height(6.dp))
            IconButton(onClick = {
                scope.launch {
                    val ok = runBiometricPrompt(context, appLockManager, "فتح دفتر")
                    if (ok) onUnlocked()
                }
            }) {
                Icon(
                    imageVector = Icons.Default.Fingerprint,
                    contentDescription = "الفتح بالبصمة",
                    tint = colors.primary,
                    modifier = Modifier.size(34.dp)
                )
            }
        }

        if (mode == LockGateMode.SETUP) {
            TextButton(onClick = onSkipSetup) {
                Text(
                    text = "لاحقًا — بدون قفل",
                    fontFamily = DaftarFonts.Cairo,
                    color = colors.onSurfaceVariant
                )
            }
        } else {
            Text(
                text = "إذا نسيت الرمز فلن يمكن استرجاع الملاحظات من داخل التطبيق",
                fontFamily = DaftarFonts.Cairo,
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 18.dp, start = 12.dp, end = 12.dp)
            )
        }
    }
}

/** لوحة الأرقام. */
@Composable
private fun KeypadColumn(
    onDigit: (Char) -> Unit,
    onDelete: () -> Unit,
    enabled: Boolean
) {
    val colors = MaterialTheme.colorScheme
    val rows = listOf(listOf('1', '2', '3'), listOf('4', '5', '6'), listOf('7', '8', '9'), listOf(' ', '0', '⌫'))
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        rows.forEach { row ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                row.forEach { ch ->
                    when (ch) {
                        ' ' -> Spacer(modifier = Modifier.size(72.dp))
                        '⌫' -> IconButton(
                            onClick = onDelete,
                            enabled = enabled,
                            modifier = Modifier
                                .size(72.dp)
                                .clip(CircleShape)
                        ) {
                            Icon(Icons.AutoMirrored.Filled.Backspace, contentDescription = "حذف", tint = colors.onSurface)
                        }
                        else -> Box(
                            modifier = Modifier
                                .size(72.dp)
                                .clip(CircleShape)
                                .background(colors.surface)
                                .border(1.dp, colors.outlineVariant, CircleShape)
                                .clickable(enabled = enabled) { onDigit(ch) },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = ch.toString(),
                                fontFamily = DaftarFonts.Cairo,
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Medium,
                                color = if (enabled) colors.onSurface else colors.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

/** هل البصمة/الوجه متاح على هذا الجهاز؟ */
fun isBiometricAvailable(context: Context): Boolean {
    val can = BiometricManager.from(context).canAuthenticate(
        BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.BIOMETRIC_WEAK
    )
    return can == BiometricManager.BIOMETRIC_SUCCESS
}

/**
 * يعرض طلب البصمة ويعلّم المدير بأن تفاعلًا نظاميًا جارٍ
 * (حتى لا يُحتسب ظهور نافذة النظام خروجًا للتطبيق فيُقفل فورًا).
 */
suspend fun runBiometricPrompt(
    context: Context,
    appLockManager: AppLockManager,
    title: String
): Boolean {
    val activity = context as? FragmentActivity ?: return false
    appLockManager.beginSystemPrompt()
    return try {
        suspendCancellableCoroutine { cont ->
            val executor = ContextCompat.getMainExecutor(activity)
            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (cont.isActive) cont.resume(true)
                }

                override fun onAuthenticationFailed() {
                    // فشل محاولة واحدة: نُبقي الطلب مفتوحًا للمحاولة مجددًا
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (cont.isActive) cont.resume(false)
                }
            }
            val prompt = BiometricPrompt(activity, executor, callback)
            cont.invokeOnCancellation { prompt.cancelAuthentication() }
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("استخدم البصمة أو بصمة الوجه")
                .setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG or
                        BiometricManager.Authenticators.BIOMETRIC_WEAK
                )
                .setNegativeButtonText("استخدام الرمز")
                .build()
            prompt.authenticate(info)
        }
    } finally {
        appLockManager.endSystemPrompt()
    }
}
