package feedmebooks.app.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import feedmebooks.app.reader.ReaderSettings
import feedmebooks.app.reader.ReaderTheme

/**
 * The brand's Material theme ([Brand]), following the reader's theme setting (system, light,
 * sepia or dark).
 *
 * With [windowColors] the system bars take the screen's background colour, so the screen runs
 * edge to edge in one colour. The reader turns it off and colours its own window to match the
 * Readium page instead.
 */
@Composable
fun AppTheme(windowColors: Boolean = true, content: @Composable () -> Unit) {
    val context = LocalContext.current
    remember { ReaderSettings.init(context) }
    val prefs by ReaderSettings.prefs.collectAsState()
    val systemDark = isSystemInDarkTheme()
    val dark = prefs.isDark(systemDark)
    val scheme = when {
        dark -> Brand.DarkScheme
        prefs.theme == ReaderTheme.SEPIA -> Brand.SepiaScheme
        else -> Brand.LightScheme
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            (view.context as? Activity)?.window?.let { window ->
                if (windowColors) {
                    @Suppress("DEPRECATION")
                    window.statusBarColor = scheme.background.toArgb()
                    @Suppress("DEPRECATION")
                    window.navigationBarColor = scheme.background.toArgb()
                }
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
        }
    }
    MaterialTheme(colorScheme = scheme, typography = Brand.Typography, shapes = Brand.Shapes, content = content)
}
