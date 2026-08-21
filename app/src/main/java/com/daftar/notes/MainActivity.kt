package com.daftar.notes

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.daftar.notes.app.AppContainer
import com.daftar.notes.security.AppLockGate
import com.daftar.notes.security.AppLockManager
import com.daftar.notes.ui.screens.EditorScreen
import com.daftar.notes.ui.screens.EditorViewModel
import com.daftar.notes.ui.screens.HomeScreen
import com.daftar.notes.ui.screens.HomeViewModel
import com.daftar.notes.ui.screens.SettingsScreen
import com.daftar.notes.ui.theme.DarkColors
import com.daftar.notes.ui.theme.DaftarFonts
import com.daftar.notes.ui.theme.DaftarFontCatalog
import com.daftar.notes.ui.theme.LightColors
import com.daftar.notes.ui.theme.LocalNoteFont
import com.daftar.notes.util.SettingsStore
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

private const val ROUTE_HOME = "home"
private const val ROUTE_EDITOR = "editor/{noteId}"
private const val ROUTE_SETTINGS = "settings"

class MainActivity : ComponentActivity() {

    private lateinit var appContainer: AppContainer
    private lateinit var settingsStore: SettingsStore
    private lateinit var appLockManager: AppLockManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appContainer = AppContainer(this)
        settingsStore = SettingsStore(this)
        appLockManager = AppLockManager.get(this)

        enableEdgeToEdge()

        setContent {
            val darkMode by settingsStore.darkMode.collectAsState(initial = "system")
            val fontKey by settingsStore.fontKey.collectAsState(initial = "")

            val isDark = when (darkMode) {
                "dark" -> true
                "light" -> false
                else -> resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK ==
                    android.content.res.Configuration.UI_MODE_NIGHT_YES
            }

            val noteFont = DaftarFontCatalog.all.firstOrNull { it.key == fontKey }?.family
                ?: DaftarFontCatalog.default.family

            MaterialTheme(
                colorScheme = if (isDark) DarkColors else LightColors,
                typography = MaterialTheme.typography,
                shapes = MaterialTheme.shapes
            ) {
                CompositionLocalProvider(
                    LocalLayoutDirection provides LayoutDirection.Rtl,
                    LocalNoteFont provides noteFont
                ) {
                    LockAwareAppContent(
                        darkMode = darkMode,
                        onUnlocked = { /* state handled internally */ }
                    )
                }
            }
        }

        // Track foreground/background for the relock timer
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Entering STARTED = foreground: check lock
                appLockManager.recordForegroundExit()
                if (appLockManager.isLockRequired()) {
                    // Gate is managed via composable state; nothing extra needed.
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        lockRequired = null // refreshed by the composable
    }

    companion object {
        @Volatile
        var lockRequired: Boolean? = null
    }

    @Composable
    private fun LockAwareAppContent(darkMode: String, onUnlocked: () -> Unit) {
        val navController = rememberNavController()
        val settings = settingsStore
        val repo = appContainer.notesRepository

        var gateLocked by remember { mutableStateOf(false) }
        var initialCheckDone by remember { mutableStateOf(false) }

        if (!initialCheckDone) {
            initialCheckDone = true
            androidx.compose.runtime.LaunchedEffect(Unit) {
                gateLocked = appLockManager.isLockRequired()
            }
        }

        // When returning from background, re-check the lock requirement.
        val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
        androidx.compose.runtime.LaunchedEffect(lifecycleOwner) {
            lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                kotlinx.coroutines.delay(300)
                if (appLockManager.isLockRequired()) {
                    gateLocked = true
                }
            }
        }

        Crossfade(targetState = gateLocked, modifier = Modifier.fillMaxSize()) { locked ->
            if (locked) {
                Box(modifier = Modifier.fillMaxSize()) {
                    AppLockGate(
                        onUnlocked = {
                            appLockManager.recordUnlock()
                            gateLocked = false
                        },
                        modifier = Modifier.systemBarsPadding()
                    )
                }
            } else {
                NavHost(
                    navController = navController,
                    startDestination = ROUTE_HOME,
                    modifier = Modifier.fillMaxSize()
                ) {
                    composable(ROUTE_HOME) {
                        HomeScreen(
                            viewModel = remember { HomeViewModel(repo) },
                            onOpenNote = { noteId ->
                                navController.navigate("editor/$noteId")
                            },
                            onOpenSettings = { navController.navigate(ROUTE_SETTINGS) }
                        )
                    }
                    composable(ROUTE_EDITOR) { backStackEntry ->
                        val noteId = backStackEntry.arguments?.getString("noteId")?.toLongOrNull() ?: 0L
                        val fontFamily = LocalNoteFont.current
                        EditorScreen(
                            noteId = noteId,
                            fontFamily = fontFamily,
                            fontSizeSp = 18,
                            onNavigateBack = { navController.popBackStack() },
                            viewModel = remember(noteId) {
                                EditorViewModel(repo).also { if (noteId != 0L) it.loadNote(noteId) }
                            }
                        )
                    }
                    composable(ROUTE_SETTINGS) {
                        SettingsScreen(
                            settings = settings,
                            onNavigateBack = { navController.popBackStack() },
                            onRequestBackup = { navController.navigate(ROUTE_HOME) },
                            onRequestRestore = { navController.navigate(ROUTE_HOME) },
                            onOpenTrash = { navController.navigate(ROUTE_HOME) }
                        )
                    }
                }
            }
        }
    }
}
