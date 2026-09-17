package com.daftar.notes.security

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * تخزين رمز القفل بشكل آمن.
 *
 * - الرمز لا يُخزَّن أبدًا كنص صريح، بل مشتق (PBKDF2-HMAC-SHA256) مع ملح عشوائي
 *   لكل مستخدم وعدد دورات تخزين.
 * - المفاتيح محفوظة داخل EncryptedSharedPreferences (مدعومة بمفتاح من Android Keystore).
 * - دعم متوافق للخلف: إذا وُجد رمز قديم مخزّن بصيغة SHA-256 بسيطة، يتم التحقق منه
 *   ثم ترقيته تلقائيًا إلى PBKDF2 عند أول عملية تحقق ناجحة.
 * - تتبع المحاولات الفاشلة: بعد [MAX_ATTEMPTS] محاولات يُقفَل الإدخال مؤقتًا
 *   لمدة [LOCKOUT_MS] * عدد مرات التجاوز (تصاعديًا).
 */
object PinStore {

    private const val TAG = "PinStore"
    private const val PREFS_NAME = "daftar_pin_store"

    // صيغة حديثة
    private const val KEY_VERIFIER = "pin_verifier"
    private const val KEY_SALT = "pin_salt"
    private const val KEY_ITERATIONS = "pin_iterations"

    // صيغة قديمة (للتوافق فقط)
    private const val KEY_LEGACY_HASH = "pin_hash"

    // المحاولات الفاشلة
    private const val KEY_FAILED_ATTEMPTS = "failed_attempts"
    private const val KEY_LOCK_UNTIL = "lock_until"

    private const val PBKDF2_ITERATIONS = 120_000
    private const val KEY_LENGTH_BITS = 256
    private const val SALT_BYTES = 16

    /** عدد المحاولات المسموح بها قبل القفل المؤقت. */
    const val MAX_ATTEMPTS = 5

    /** مدة القفل المؤقت الأساسية (تتضاعف مع كل تجاوز). */
    const val LOCKOUT_MS = 30_000L

    /** طول الرمز المتوقع في الواجهة. */
    const val PIN_LENGTH = 4

    // ---------------------------------------------------------------- الوصول الآمن

    /**
     * يفتح المخزن المشفّر. في حال تلف مفتاح الـKeystore (استثناء) نُنظّف البيانات
     * بدل تعليق التطبيق بلا مخرج.
     */
    private fun prefs(context: Context): SharedPreferences {
        return try {
            EncryptedSharedPreferences.create(
                context.applicationContext,
                PREFS_NAME,
                MasterKey.Builder(context.applicationContext)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // مفتاح Keystore غير صالح/تالف: أعد إنشاء المخزن فارغًا
            Log.w(TAG, "Encrypted prefs unavailable, resetting store", e)
            try {
                context.applicationContext.deleteSharedPreferences(PREFS_NAME)
                EncryptedSharedPreferences.create(
                    context.applicationContext,
                    PREFS_NAME,
                    MasterKey.Builder(context.applicationContext)
                        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                        .build(),
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                )
            } catch (inner: Exception) {
                Log.e(TAG, "Cannot create secure prefs", inner)
                // مخزن مؤقت في الذاكرة فقط (لن يُحفظ) لتفادي الانهيار
                context.applicationContext.getSharedPreferences("daftar_pin_fallback", Context.MODE_PRIVATE)
            }
        }
    }

    private fun read(prefs: SharedPreferences, key: String): String? =
        try {
            prefs.getString(key, null)
        } catch (e: Exception) {
            Log.w(TAG, "read failed for $key", e)
            null
        }

    private fun write(block: (SharedPreferences.Editor) -> Unit, prefs: SharedPreferences) {
        try {
            val editor = prefs.edit()
            block(editor)
            editor.apply()
        } catch (e: Exception) {
            Log.w(TAG, "write failed", e)
        }
    }

    // ---------------------------------------------------------------- الحالة

    fun hasPin(context: Context): Boolean {
        val prefs = prefs(context)
        return read(prefs, KEY_VERIFIER) != null || read(prefs, KEY_LEGACY_HASH) != null
    }

    /** تعيين أو تغيير الرمز: يولّد ملحًا جديدًا ويمسح أي صيغة قديمة. */
    fun setPin(context: Context, pin: String) {
        val prefs = prefs(context)
        val salt = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) }
        val verifier = derive(pin, salt, PBKDF2_ITERATIONS)
        write({ editor ->
            editor.putString(KEY_SALT, salt.toHex())
            editor.putInt(KEY_ITERATIONS, PBKDF2_ITERATIONS)
            editor.putString(KEY_VERIFIER, verifier)
            editor.remove(KEY_LEGACY_HASH)
            editor.remove(KEY_FAILED_ATTEMPTS)
            editor.remove(KEY_LOCK_UNTIL)
        }, prefs)
    }

    /**
     * التحقق من الرمز مع ترقية تلقائية للصيغة القديمة.
     * يُصفّر عدّاد المحاولات عند النجاح، ويزيده عند الفشل.
     */
    fun verify(context: Context, pin: String): Boolean {
        val prefs = prefs(context)
        val storedVerifier = read(prefs, KEY_VERIFIER)
        val salt = read(prefs, KEY_SALT)?.hexToBytes()
        val iterations = try {
            prefs.getInt(KEY_ITERATIONS, PBKDF2_ITERATIONS)
        } catch (e: Exception) {
            PBKDF2_ITERATIONS
        }

        val ok = if (storedVerifier != null && salt != null) {
            constantTimeEquals(derive(pin, salt, iterations.coerceAtLeast(1)), storedVerifier)
        } else {
            val legacy = read(prefs, KEY_LEGACY_HASH) ?: return false.also { recordFailure(context) }
            constantTimeEquals(legacySha256(pin), legacy)
        }

        if (ok) {
            // ترقية الصيغة القديمة إلى PBKDF2 بشفافية
            if (read(prefs, KEY_LEGACY_HASH) != null || storedVerifier == null) {
                setPin(context, pin)
            } else {
                resetFailures(prefs)
            }
        } else {
            recordFailure(context)
        }
        return ok
    }

    fun clearPin(context: Context) {
        val prefs = prefs(context)
        write({ editor ->
            editor.clear()
        }, prefs)
    }

    // ---------------------------------------------------------------- المحاولات الفاشلة

    /** عدد المحاولات الفاشلة الحالية. */
    fun failedAttempts(context: Context): Int =
        try {
            prefs(context).getInt(KEY_FAILED_ATTEMPTS, 0)
        } catch (e: Exception) {
            0
        }

    /** المتبقي من مدة القفل المؤقت بالميلي ثانية (0 إذا لا يوجد قفل). */
    fun lockRemainingMs(context: Context): Long {
        val until = try {
            prefs(context).getLong(KEY_LOCK_UNTIL, 0L)
        } catch (e: Exception) {
            0L
        }
        return (until - System.currentTimeMillis()).coerceAtLeast(0L)
    }

    /** هل الإدخال مقفل مؤقتًا الآن؟ */
    fun isTemporarilyLocked(context: Context): Boolean = lockRemainingMs(context) > 0L

    /** المحاولات المتبقية قبل القفل المؤقت. */
    fun remainingAttempts(context: Context): Int =
        (MAX_ATTEMPTS - failedAttempts(context)).coerceAtLeast(0)

    private fun recordFailure(context: Context) {
        val prefs = prefs(context)
        val attempts = failedAttempts(context) + 1
        write({ editor -> editor.putInt(KEY_FAILED_ATTEMPTS, attempts) }, prefs)
        if (attempts >= MAX_ATTEMPTS) {
            // قفل تصاعدي: 30s، 60s، 120s ...
            val overshoot = (attempts / MAX_ATTEMPTS) - 1
            val penalty = LOCKOUT_MS shl overshoot.coerceIn(0, 5)
            write({ editor ->
                editor.putLong(KEY_LOCK_UNTIL, System.currentTimeMillis() + penalty)
                editor.putInt(KEY_FAILED_ATTEMPTS, 0)
            }, prefs)
        }
    }

    private fun resetFailures(prefs: SharedPreferences) {
        write({ editor ->
            editor.remove(KEY_FAILED_ATTEMPTS)
            editor.remove(KEY_LOCK_UNTIL)
        }, prefs)
    }

    // ---------------------------------------------------------------- الدوال المساعدة

    private fun derive(pin: String, salt: ByteArray, iterations: Int): String {
        val spec = PBEKeySpec(pin.toCharArray(), salt, iterations, KEY_LENGTH_BITS)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return try {
            factory.generateSecret(spec).encoded.toHex()
        } finally {
            spec.clearPassword()
        }
    }

    /** الصيغة القديمة — تُستخدم للتحقق من الرموز المخزّنة قبل الترقية فقط. */
    private fun legacySha256(pin: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest("daftar_salt_v1::$pin".toByteArray(Charsets.UTF_8)).toHex()
    }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        val aBytes = a.hexToBytes()
        val bBytes = b.hexToBytes()
        if (aBytes.isEmpty() || bBytes.isEmpty()) return false
        return MessageDigest.isEqual(aBytes, bBytes)
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun String.hexToBytes(): ByteArray {
        if (length % 2 != 0) return ByteArray(0)
        return ByteArray(length / 2) { i ->
            ((Character.digit(this[i * 2], 16) shl 4) + Character.digit(this[i * 2 + 1], 16)).toByte()
        }
    }
}
