package feedmebooks.app.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import feedmebooks.app.reader.ReaderSettings
import feedmebooks.app.reader.ReaderTheme

/** Material theme following the reader's theme setting (system, light, sepia or dark). */
@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    remember { ReaderSettings.init(context) }
    val prefs by ReaderSettings.prefs.collectAsState()
    val systemDark = isSystemInDarkTheme()
    val dark = prefs.isDark(systemDark)
    val scheme = when {
        dark -> darkColorScheme()
        prefs.theme == ReaderTheme.SEPIA -> SepiaColorScheme
        else -> lightColorScheme()
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            (view.context as? Activity)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !dark
            }
        }
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

/** Warm paper tones matching Readium's sepia page. */
private val SepiaColorScheme = lightColorScheme(
    primary = Color(0xFF6D4C2A),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE8D9BF),
    onPrimaryContainer = Color(0xFF2A1A05),
    secondaryContainer = Color(0xFFE3D5BB),
    onSecondaryContainer = Color(0xFF2A1A05),
    background = Color(0xFFFAF4E8),
    onBackground = Color(0xFF121212),
    surface = Color(0xFFFAF4E8),
    onSurface = Color(0xFF121212),
    surfaceVariant = Color(0xFFEDE3D0),
    onSurfaceVariant = Color(0xFF4A4034),
    surfaceContainerLow = Color(0xFFF6EFE0),
    surfaceContainer = Color(0xFFF1E8D8),
    surfaceContainerHigh = Color(0xFFECE1CF),
    outline = Color(0xFF857463),
)
