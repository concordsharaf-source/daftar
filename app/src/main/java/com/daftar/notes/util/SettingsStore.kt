package com.daftar.notes.util

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class SettingsStore(private val context: Context) {

    companion object {
        val FONT_KEY = stringPreferencesKey("font_key")
        val DARK_MODE_KEY = stringPreferencesKey("dark_mode") // "system" | "light" | "dark"
        val PIN_LOCK_ENABLED_KEY = booleanPreferencesKey("pin_lock_enabled")
        val BIOMETRIC_ENABLED_KEY = booleanPreferencesKey("biometric_enabled")
        val RELOCK_DELAY_KEY = intPreferencesKey("relock_delay") // minutes
        val LAST_UNLOCK_TIME_KEY = longPreferencesKey("last_unlock_time")
        val LAST_LOCK_STATE_TIME_KEY = longPreferencesKey("last_lock_state_time")
    }

    val fontKey: Flow<String> = context.dataStore.data.map { it[FONT_KEY] ?: "" }
    val darkMode: Flow<String> = context.dataStore.data.map { it[DARK_MODE_KEY] ?: "system" }
    val pinLockEnabled: Flow<Boolean> = context.dataStore.data.map { it[PIN_LOCK_ENABLED_KEY] ?: false }
    val biometricEnabled: Flow<Boolean> = context.dataStore.data.map { it[BIOMETRIC_ENABLED_KEY] ?: false }
    val relockDelayMinutes: Flow<Int> = context.dataStore.data.map { it[RELOCK_DELAY_KEY] ?: 5 }
    val lastUnlockTime: Flow<Long> = context.dataStore.data.map { it[LAST_UNLOCK_TIME_KEY] ?: 0L }
    val lastLockStateTime: Flow<Long> = context.dataStore.data.map { it[LAST_LOCK_STATE_TIME_KEY] ?: 0L }

    suspend fun setFontKey(key: String) {
        context.dataStore.edit { it[FONT_KEY] = key }
    }

    suspend fun setDarkMode(mode: String) {
        context.dataStore.edit { it[DARK_MODE_KEY] = mode }
    }

    suspend fun setPinLockEnabled(enabled: Boolean) {
        context.dataStore.edit { it[PIN_LOCK_ENABLED_KEY] = enabled }
    }

    suspend fun setBiometricEnabled(enabled: Boolean) {
        context.dataStore.edit { it[BIOMETRIC_ENABLED_KEY] = enabled }
    }

    suspend fun setRelockDelayMinutes(minutes: Int) {
        context.dataStore.edit { it[RELOCK_DELAY_KEY] = minutes }
    }

    suspend fun setLastUnlockTime(millis: Long) {
        context.dataStore.edit { it[LAST_UNLOCK_TIME_KEY] = millis }
    }

    suspend fun setLastLockStateTime(millis: Long) {
        context.dataStore.edit { it[LAST_LOCK_STATE_TIME_KEY] = millis }
    }
}
