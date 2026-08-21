package com.daftar.notes.ui.screens

import android.content.Intent
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.FontDownload
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.daftar.notes.security.isBiometricAvailable
import com.daftar.notes.ui.theme.DaftarFonts
import com.daftar.notes.ui.theme.DaftarFontCatalog
import com.daftar.notes.util.SettingsStore
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    settings: SettingsStore,
    onNavigateBack: () -> Unit,
    onRequestBackup: () -> Unit,
    onRequestRestore: () -> Unit,
    onOpenTrash: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme
    val biometricAvailable = isBiometricAvailable(context)

    val darkMode by settings.darkMode.collectAsState(initial = "system")
    val fontKey by settings.fontKey.collectAsState(initial = "")
    val pinEnabled by settings.pinLockEnabled.collectAsState(initial = false)
    val biometricEnabled by settings.biometricEnabled.collectAsState(initial = false)
    val relockMinutes by settings.relockDelayMinutes.collectAsState(initial = 5)

    var showFontPicker by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        TopAppBar(
            title = { Text("الإعدادات", fontFamily = DaftarFonts.Cairo) },
            navigationIcon = {
                IconButton(onClick = onNavigateBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                }
            }
        )

        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // ---- Appearance ----
            SectionTitle("المظهر")
            SettingsCard {
                SettingsRow(
                    icon = Icons.Default.DarkMode,
                    title = "المظهر",
                    subtitle = modeLabel(darkMode),
                    onClick = { },
                    trailing = {
                        ModePickerDialog(
                            current = darkMode,
                            onDismiss = { },
                            onChoose = { mode ->
                                scope.launch { settings.setDarkMode(mode) }
                            }
                        )
                    }
                )
            }
            SettingsCard {
                SettingsRow(
                    icon = Icons.Default.FontDownload,
                    title = "الخط",
                    subtitle = fontLabel(fontKey),
                    onClick = { showFontPicker = true }
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // ---- Privacy ----
            SectionTitle("الخصوصية والأمان")
            SettingsCard {
                SettingsRow(
                    icon = Icons.Default.Lock,
                    title = "قفل التطبيق",
                    subtitle = "قفل الدفتر برمز سري عند فتحه"
                ) {
                    scope.launch { settings.setPinLockEnabled(!pinEnabled) }
                }
                Switch(
                    checked = pinEnabled,
                    onCheckedChange = { scope.launch { settings.setPinLockEnabled(it) } }
                )
            }
            if (biometricAvailable) {
                SettingsCard {
                    SettingsRow(
                        icon = Icons.Default.Fingerprint,
                        title = "البصمة أو الوجه",
                        subtitle = if (biometricEnabled) "تفعيل فتح التطبيق بالبصمة"
                        else "فتح سريع باستخدام البصمة"
                    ) {
                        scope.launch { settings.setBiometricEnabled(!biometricEnabled) }
                    }
                    Switch(
                        checked = biometricEnabled,
                        enabled = pinEnabled,
                        onCheckedChange = { scope.launch { settings.setBiometricEnabled(it) } }
                    )
                }
                if (pinEnabled) {
                    SettingsCard {
                        SettingsRow(
                            icon = Icons.Default.Timer,
                            title = "قفل تلقائي بعد",
                            subtitle = relockLabel(relockMinutes)
                        ) {
                            RelockDelayDialog(
                                current = relockMinutes,
                                onDismiss = { },
                                onChoose = { minutes ->
                                    scope.launch { settings.setRelockDelayMinutes(minutes) }
                                }
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // ---- Data ----
            SectionTitle("البيانات")
            SettingsCard {
                SettingsRow(
                    icon = Icons.Default.Backup,
                    title = "النسخ الاحتياطي",
                    subtitle = "تصدير كل الملاحظات إلى ملف"
                ) {
                    onRequestBackup()
                }
            }
            SettingsCard {
                SettingsRow(
                    icon = Icons.Default.RestoreFromTrash,
                    title = "استعادة من نسخة",
                    subtitle = "إضافة ملاحظات من ملف نسخة احتياطية"
                ) {
                    onRequestRestore()
                }
            }
            SettingsCard {
                SettingsRow(
                    icon = Icons.Default.RestoreFromTrash,
                    title = "سلة المحذوفات",
                    subtitle = "استعادة أو حذف نهائي"
                ) {
                    onOpenTrash()
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // ---- About ----
            SectionTitle("حول التطبيق")
            SettingsCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Info, contentDescription = null, tint = colors.primary)
                    Spacer(modifier = Modifier.size(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "دفتر — دفتر ملاحظات عربي",
                            fontFamily = DaftarFonts.Cairo,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            color = colors.onSurface
                        )
                        Text(
                            text = "الإصدار ${appVersion(context)} • تنسيق غني • تصدير PDF",
                            fontFamily = DaftarFonts.Cairo,
                            fontSize = 12.sp,
                            color = colors.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }

    // Font picker dialog
    if (showFontPicker) {
        FontPickerDialog(
            currentKey = fontKey,
            onDismiss = { showFontPicker = false },
            onChoose = { key ->
                scope.launch { settings.setFontKey(key) }
                showFontPicker = false
            }
        )
    }
}

@Composable
private fun SettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit = {},
    trailing: @Composable (() -> Unit)? = null
) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = colors.primary, modifier = Modifier.size(22.dp))
        Spacer(modifier = Modifier.size(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontFamily = DaftarFonts.Cairo, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = colors.onSurface)
            Text(subtitle, fontFamily = DaftarFonts.Cairo, fontSize = 12.sp, color = colors.onSurfaceVariant)
        }
        trailing?.invoke()
    }
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(colors.surface)
            .border(1.dp, colors.outlineVariant, RoundedCornerShape(14.dp))
    ) {
        content()
    }
}

@Composable
private fun SectionTitle(text: String) {
    val colors = MaterialTheme.colorScheme
    Text(
        text = text,
        fontFamily = DaftarFonts.Cairo,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        color = colors.primary,
        modifier = Modifier.padding(vertical = 6.dp)
    )
}

@Composable
private fun ModePickerDialog(current: String, onDismiss: () -> Unit, onChoose: (String) -> Unit) {
    val options = listOf("system" to "تلقائي (حسب النظام)", "light" to "فاتح", "dark" to "داكن")
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("اختر المظهر", fontFamily = DaftarFonts.Cairo) },
        text = {
            Column {
                options.forEach { (mode, label) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = current == mode, onClick = { onChoose(mode) })
                        Text(label, fontFamily = DaftarFonts.Cairo, modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                Text("إغلاق", fontFamily = DaftarFonts.Cairo)
            }
        }
    )
}

@Composable
private fun RelockDelayDialog(current: Int, onDismiss: () -> Unit, onChoose: (Int) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("إعادة القفل بعد", fontFamily = DaftarFonts.Cairo) },
        text = {
            Column {
                listOf(0 to "فور الخروج", 1 to "دقيقة واحدة", 5 to "5 دقائق", 15 to "15 دقيقة", 30 to "30 دقيقة").forEach { (m, label) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = current == m, onClick = { onChoose(m) })
                        Text(label, fontFamily = DaftarFonts.Cairo, modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                Text("إغلاق", fontFamily = DaftarFonts.Cairo)
            }
        }
    )
}

@Composable
private fun FontPickerDialog(currentKey: String, onDismiss: () -> Unit, onChoose: (String) -> Unit) {
    val colors = MaterialTheme.colorScheme
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("اختر الخط", fontFamily = DaftarFonts.Cairo) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().height(420.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                DaftarFontCatalog.categories.forEach { category ->
                    Text(
                        text = category.displayName,
                        fontFamily = DaftarFonts.Cairo,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = colors.primary
                    )
                    category.fonts.forEach { font ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onChoose(font.key) }
                                .background(
                                    if (font.key == currentKey) colors.primaryContainer else colors.surface
                                )
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "${font.displayName} — بخط ${font.displayName}",
                                fontFamily = font.family,
                                fontSize = 15.sp,
                                color = colors.onSurface,
                                modifier = Modifier.weight(1f)
                            )
                            if (font.key == currentKey) {
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "محدد",
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                Text("إلغاء", fontFamily = DaftarFonts.Cairo)
            }
        }
    )
}

private fun modeLabel(mode: String): String = when (mode) {
    "light" -> "فاتح"
    "dark" -> "داكن"
    else -> "تلقائي (حسب النظام)"
}

private fun fontLabel(key: String): String =
    DaftarFontCatalog.all.firstOrNull { it.key == key }?.displayName
        ?: DaftarFontCatalog.default.displayName

private fun relockLabel(minutes: Int): String = when (minutes) {
    0 -> "فور الخروج من التطبيق"
    1 -> "دقيقة واحدة"
    else -> "$minutes دقائق"
}

private fun appVersion(context: android.content.Context): String = try {
    context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "2.0"
} catch (e: PackageManager.NameNotFoundException) {
    "2.0"
}
