package com.daftar.notes

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.daftar.notes.app.AppContainer
import com.daftar.notes.security.AppLockGate
import com.daftar.notes.security.AppLockManager
import com.daftar.notes.security.LockGateMode
import com.daftar.notes.security.LockPhase
import com.daftar.notes.security.PinStore
import com.daftar.notes.ui.screens.EditorScreen
import com.daftar.notes.ui.screens.EditorViewModel
import com.daftar.notes.ui.screens.HomeScreen
import com.daftar.notes.ui.screens.HomeViewModel
import com.daftar.notes.ui.screens.SettingsScreen
import com.daftar.notes.ui.theme.DaftarFontCatalog
import com.daftar.notes.ui.theme.DaftarFonts
import com.daftar.notes.ui.theme.DarkColors
import com.daftar.notes.ui.theme.LightColors
import com.daftar.notes.ui.theme.LocalNoteFont
import com.daftar.notes.util.SettingsStore
import kotlinx.coroutines.launch

private const val ROUTE_HOME = "home"
private const val ROUTE_EDITOR = "editor/{noteId}"
private const val ROUTE_SETTINGS = "settings"

/**
 * النشاط الرئيسي.
 *
 * ترث [FragmentActivity] (بدل ComponentActivity) لأن مكتبة androidx.biometric
 * تطلبها لعرض نافذة البصمة؛ سابقًا كان التحويل `context as? FragmentActivity`
 * يفشل دائمًا فلا تظهر البصمة أبدًا.
 *
 * القفل الآن يُدار بحالة واحدة واضحة من [AppLockManager] بدل الفحوص المتناثرة.
 */
class MainActivity : FragmentActivity() {

    private lateinit var appContainer: AppContainer
    private lateinit var settingsStore: SettingsStore
    private lateinit var appLockManager: AppLockManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appContainer = AppContainer(this)
        settingsStore = SettingsStore(this)
        appLockManager = AppLockManager.get(this)

        enableEdgeToEdge()

        // تتبع المقدمة/الخلفية لقفل المهلة
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                lifecycleScope.launch { appLockManager.onAppForeground() }
            }

            override fun onStop(owner: LifecycleOwner) {
                appLockManager.onAppBackground()
            }
        })

        lifecycleScope.launch { appLockManager.boot() }

        setContent {
            val darkMode by settingsStore.darkMode.collectAsState(initial = "system")
            val fontKey by settingsStore.fontKey.collectAsState(initial = "")

            val isDark = when (darkMode) {
                "dark" -> true
                "light" -> false
                else -> resources.configuration.uiMode and
                    android.content.res.Configuration.UI_MODE_NIGHT_MASK ==
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
                    DaftarRoot(
                        appContainer = appContainer,
                        settingsStore = settingsStore,
                        appLockManager = appLockManager
                    )
                }
            }
        }
    }
}

@Composable
private fun DaftarRoot(
    appContainer: AppContainer,
    settingsStore: SettingsStore,
    appLockManager: AppLockManager
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ready by appLockManager.ready.collectAsState()
    val phase by appLockManager.phase.collectAsState()
    val navController = rememberNavController()
    val repo = appContainer.notesRepository

    when {
        // لا نعرض أي محتوى قبل قراءة الإعدادات: يمنع ظهور الملاحظات لحظة
        // ثم تغطيتها بالقفل عند الإقلاع البارد.
        !ready -> SplashPlaceholder()

        phase == LockPhase.LOCKED -> {
            val mode = if (PinStore.hasPin(context)) LockGateMode.VERIFY else LockGateMode.SETUP
            AppLockGate(
                mode = mode,
                appLockManager = appLockManager,
                onUnlocked = {
                    scope.launch { appLockManager.onUnlocked() }
                },
                onSkipSetup = {
                    scope.launch { appLockManager.setPinLockEnabled(false) }
                },
                modifier = Modifier.systemBarsPadding()
            )
        }

        else -> {
            NavHost(
                navController = navController,
                startDestination = ROUTE_HOME,
                modifier = Modifier.fillMaxSize()
            ) {
                composable(ROUTE_HOME) {
                    HomeScreen(
                        viewModel = viewModel { HomeViewModel(repo) },
                        onOpenNote = { noteId -> navController.navigate("editor/$noteId") },
                        onOpenSettings = { navController.navigate(ROUTE_SETTINGS) },
                        appLockManager = appLockManager
                    )
                }
                composable(ROUTE_EDITOR) { backStackEntry ->
                    val noteId = backStackEntry.arguments?.getString("noteId")?.toLongOrNull() ?: 0L
                    val fontFamily = LocalNoteFont.current
                    // viewModel() مربوط بمُدخل التنقل: يُنظَّف مع onCleared عند الرجوع
                    val editorViewModel: EditorViewModel = viewModel(key = "editor-$noteId") {
                        EditorViewModel(repo).also { if (noteId != 0L) it.loadNote(noteId) }
                    }
                    EditorScreen(
                        noteId = noteId,
                        fontFamily = fontFamily,
                        fontSizeSp = 18,
                        onNavigateBack = { navController.popBackStack() },
                        viewModel = editorViewModel,
                        appLockManager = appLockManager
                    )
                }
                composable(ROUTE_SETTINGS) {
                    SettingsScreen(
                        settings = settingsStore,
                        appLockManager = appLockManager,
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

/** شاشة محايدة تظهر فقط في اللحظة بين إقلاع التطبيق وقراءة الإعدادات. */
@Composable
private fun SplashPlaceholder() {
    val colors = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "دفتر",
            fontFamily = DaftarFonts.Amiri,
            fontSize = 40.sp,
            fontWeight = FontWeight.Bold,
            color = colors.primary
        )
    }
}
