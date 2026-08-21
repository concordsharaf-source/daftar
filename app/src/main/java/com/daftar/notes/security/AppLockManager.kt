package com.daftar.notes.security

import android.content.Context
import android.util.Log
import com.daftar.notes.util.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Coordinates when the lock gate must re-appear:
 *  - Lock is enabled only if settings say so AND a PIN exists.
 *  - The gate is required when the app returns from background after
 *    `relockDelayMinutes` have elapsed since the last unlock (or immediately
 *    when the delay is 0).
 */
class AppLockManager(private val context: Context) {

    private val settings = SettingsStore(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    var lastForegroundExit: Long = 0L
        private set

    suspend fun isLockRequired(): Boolean {
        val enabled = settings.pinLockEnabled.first()
        if (!enabled) return false
        if (!PinStore.hasPin(context)) return false

        val delayMinutes = settings.relockDelayMinutes.first()
        val now = System.currentTimeMillis()
        val lastUnlock = settings.lastUnlockTime.first()

        // No previous unlock in this session -> require lock
        if (lastUnlock == 0L) return true
        val delayMs = delayMinutes * 60_000L
        return (now - lastUnlock) > delayMs.coerceAtLeast(0L)
    }

    fun recordForegroundExit() {
        lastForegroundExit = System.currentTimeMillis()
    }

    fun recordUnlock() {
        scope.launch {
            settings.setLastUnlockTime(System.currentTimeMillis())
            Log.d("AppLock", "Unlock recorded")
        }
    }

    companion object {
        @Volatile
        private var instance: AppLockManager? = null

        fun get(context: Context): AppLockManager =
            instance ?: synchronized(this) {
                instance ?: AppLockManager(context.applicationContext).also { instance = it }
            }
    }
}
