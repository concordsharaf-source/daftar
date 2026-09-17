package com.daftar.notes.security

import android.content.Context
import android.util.Log
import com.daftar.notes.util.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * مرحلة قفل التطبيق كما تراها الواجهة.
 *
 * - [UNCONFIGURED]: القفل غير مطلوب (إمّا أن الميزة مطفأة أو لا يوجد رمز بعد).
 * - [LOCKED]: يجب إظهار بوابة القفل قبل أي محتوى.
 * - [UNLOCKED]: تم الفتح في هذه الجلسة ولا حاجة لإعادة القفل الآن.
 */
enum class LockPhase { UNCONFIGURED, LOCKED, UNLOCKED }

/**
 * مدير القفل: القرار الوحيد «هل يُطلب الرمز الآن؟».
 *
 * قواعد واضحة (تم إصلاح السلوك القديم الذي كان يربك المستخدم):
 *  1. إذا كان قفل الرمز مطفأً أو لا يوجد رمز مخزّن → [LockPhase.UNCONFIGURED].
 *  2. عند تشغيل التطبيق (جلسة جديدة في هذه العملية) → [LockPhase.LOCKED]
 *     إلّا إذا سبق الفتح داخل نفس الجلسة.
 *  3. عند العودة من الخلفية: يُقفل إذا تجاوز زمن الخلفية مدة «القفل التلقائي»
 *     (صفر = قفل فوري).
 *  4. التفاعلات النظامية (طلب البصمة، منتقي ملفات، مشاركة) تُعلَّم عبر
 *     [beginSystemPrompt]/[endSystemPrompt] حتى لا تُحتسب خروجًا للخلفية.
 */
class AppLockManager(private val context: Context) {

    private val settings = SettingsStore(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** لحظة إنشاء المدير = بداية جلسة التطبيق. */
    private val processStart: Long = System.currentTimeMillis()

    /** لحظة آخر انتقال إلى الخلفية (0 = التطبيق في المقدمة). */
    @Volatile
    private var backgroundedAt: Long = 0L

    /** عمق التفاعلات النظامية (بصمة/منتقي ملفات/مشاركة). */
    @Volatile
    private var systemPromptDepth: Int = 0

    /**
     * تدفق خارجي بدأ (كاميرا، منتقي ملفات، مشاركة، عارض PDF).
     * يُحرَّر تلقائيًا عند عودة التطبيق للمقدمة، فلا تتراكم القيم أبدًا.
     */
    @Volatile
    private var pendingExternalRelease: Boolean = false

    private val _phase = MutableStateFlow(LockPhase.UNCONFIGURED)
    val phase: StateFlow<LockPhase> = _phase.asStateFlow()

    /**
     * false حتى تُقرأ الإعدادات من DataStore. الواجهة تعرض شاشة محايدة
     * قبل الجاهزية حتى لا تظهر الملاحظات لحظة ثم تُغطى بالقفل.
     */
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    // ------------------------------------------------------------ القراءة

    /** يُستدعى مرة عند إنشاء النشاط الرئيسي. */
    suspend fun boot() {
        backgroundedAt = 0L
        systemPromptDepth = 0
        _phase.value = computePhase()
        _ready.value = true
    }

    suspend fun isPinLockEnabled(): Boolean = settings.pinLockEnabled.first()

    suspend fun isBiometricEnabled(): Boolean = settings.biometricEnabled.first()

    suspend fun relockDelayMinutes(): Int = settings.relockDelayMinutes.first()

    /** هل يوجد رمز مخزّن؟ */
    fun hasPin(): Boolean = PinStore.hasPin(context)

    // ------------------------------------------------------------ الانتقالات

    /** عند تحوّل التطبيق إلى الخلفية (ON_STOP). */
    fun onAppBackground() {
        if (systemPromptDepth > 0) return
        backgroundedAt = System.currentTimeMillis()
        scope.launch {
            val delayMs = settings.relockDelayMinutes.first() * 60_000L
            // قفل فوري: لا داعي لانتظار العودة
            if (delayMs == 0L && _phase.value == LockPhase.UNLOCKED) {
                _phase.value = LockPhase.LOCKED
            }
        }
    }

    /** عند عودة التطبيق إلى المقدمة (ON_START). */
    suspend fun onAppForeground() {
        // نهاية تدفق خارجي (كاميرا/منتقي ملفات/مشاركة): لا تُقفل هذه العودة
        if (pendingExternalRelease) {
            pendingExternalRelease = false
            systemPromptDepth = (systemPromptDepth - 1).coerceAtLeast(0)
            return
        }
        if (systemPromptDepth > 0) return
        _phase.value = computePhase()
    }

    /** نجاح التحقق من الرمز أو إتمام إنشائه. */
    suspend fun onUnlocked() {
        settings.setLastUnlockTime(System.currentTimeMillis())
        backgroundedAt = 0L
        _phase.value = if (settings.pinLockEnabled.first() && PinStore.hasPin(context)) {
            LockPhase.UNLOCKED
        } else {
            LockPhase.UNCONFIGURED
        }
    }

    /** تعطيل القفل ومسح الرمز المخزّن. */
    suspend fun disablePinLock() {
        PinStore.clearPin(context)
        settings.setPinLockEnabled(false)
        settings.setBiometricEnabled(false)
        _phase.value = LockPhase.UNCONFIGURED
    }

    /**
     * تفعيل/إطفاء ميزة القفل من الإعدادات.
     * عند التفعيل بدون رمز تبقى المرحلة [LockPhase.UNCONFIGURED] حتى تُنجز شاشة إنشاء الرمز.
     */
    suspend fun setPinLockEnabled(enabled: Boolean) {
        settings.setPinLockEnabled(enabled)
        if (!enabled) {
            PinStore.clearPin(context)
            settings.setBiometricEnabled(false)
            _phase.value = LockPhase.UNCONFIGURED
        } else {
            _phase.value = if (PinStore.hasPin(context)) LockPhase.LOCKED else LockPhase.UNCONFIGURED
        }
    }

    /** أنشئ رمزًا جديدًا (أو غيّره) ثم اعتبر التطبيق مفتوحًا. */
    suspend fun configurePin(pin: String) {
        PinStore.setPin(context, pin)
        settings.setPinLockEnabled(true)
        onUnlocked()
    }

    /** إظهار بوابة القفل فورًا (زر «اقفل الآن» أو بعد تغيير الرمز). */
    fun lockNow() {
        scope.launch {
            if (settings.pinLockEnabled.first() && PinStore.hasPin(context)) {
                _phase.value = LockPhase.LOCKED
            }
        }
    }

    // ------------------------------------------------------------ التفاعلات النظامية

    fun beginSystemPrompt() {
        systemPromptDepth++
    }

    fun endSystemPrompt() {
        systemPromptDepth = (systemPromptDepth - 1).coerceAtLeast(0)
    }

    /**
     * يُستدعى قبل إطلاق أي تفاعل خارجي (كاميرا/منتقي/مشاركة/عارض PDF):
     * يمنع قفل التطبيق أثناء غيابه ويُحرَّر تلقائيًا عند العودة.
     */
    fun beginExternalFlow() {
        systemPromptDepth++
        pendingExternalRelease = true
    }

    // ------------------------------------------------------------ الحساب

    private suspend fun computePhase(): LockPhase {
        val enabled = settings.pinLockEnabled.first()
        if (!enabled || !PinStore.hasPin(context)) return LockPhase.UNCONFIGURED

        // جلسة جديدة في هذه العملية: يجب الفتح ما لم يسبق الفتح فيها
        val lastUnlock = settings.lastUnlockTime.first()
        if (lastUnlock < processStart) return LockPhase.LOCKED

        // عودة من الخلفية بعد انقضاء المهلة
        val sinceBackground = backgroundedAt
        if (sinceBackground > 0L) {
            val delayMs = settings.relockDelayMinutes.first() * 60_000L
            val elapsed = System.currentTimeMillis() - sinceBackground
            if (elapsed > delayMs) return LockPhase.LOCKED
        }

        return LockPhase.UNLOCKED
    }

    companion object {
        @Volatile
        private var instance: AppLockManager? = null

        fun get(context: Context): AppLockManager =
            instance ?: synchronized(this) {
                instance ?: AppLockManager(context.applicationContext).also {
                    instance = it
                    Log.d("AppLock", "manager created")
                }
            }
    }
}
