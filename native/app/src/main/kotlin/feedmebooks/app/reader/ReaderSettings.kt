package feedmebooks.app.reader

import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.preferences.Theme

enum class ReaderTheme(val label: String) { SYSTEM("System"), LIGHT("Light"), SEPIA("Sepia"), DARK("Dark") }

/** How the reader looks and behaves. One set for the whole app, kept in SharedPreferences. */
data class ReaderPrefs(
    val theme: ReaderTheme = ReaderTheme.SYSTEM,
    /** 100 = the publisher's size. */
    val fontSizePercent: Int = 100,
    /** Scroll continuously instead of turning pages. */
    val scroll: Boolean = false,
    /** While the audio plays, highlight the sentence being read and keep it on screen. */
    val followNarrator: Boolean = true,
    /** Auto-scroll speed dial, 1 (slow) to 10 (fast); see [autoScrollPxPerSecond]. */
    val autoScrollSpeed: Int = 3,
) {
    /** The dial maps to CSS pixels per second, roughly 250 words per minute at 3 on a phone. */
    val autoScrollPxPerSecond: Double
        get() = 6.0 * Math.pow(1.4, (autoScrollSpeed.coerceIn(AUTO_SCROLL_MIN, AUTO_SCROLL_MAX) - 1).toDouble())

    fun isDark(systemDark: Boolean): Boolean = when (theme) {
        ReaderTheme.DARK -> true
        ReaderTheme.SYSTEM -> systemDark
        else -> false
    }

    fun readiumTheme(systemDark: Boolean): Theme = when {
        theme == ReaderTheme.SEPIA -> Theme.SEPIA
        isDark(systemDark) -> Theme.DARK
        else -> Theme.LIGHT
    }

    /** What the Readium navigator needs to render these preferences. */
    fun epubPreferences(systemDark: Boolean) = EpubPreferences(
        theme = readiumTheme(systemDark),
        fontSize = fontSizePercent / 100.0,
        scroll = scroll,
    )

    companion object {
        val FONT_SIZES = listOf(80, 90, 100, 110, 120, 135, 150, 175, 200)
        const val AUTO_SCROLL_MIN = 1
        const val AUTO_SCROLL_MAX = 10
    }
}

object ReaderSettings {
    private lateinit var store: SharedPreferences
    private val state = MutableStateFlow(ReaderPrefs())
    val prefs: StateFlow<ReaderPrefs> get() = state

    @Synchronized
    fun init(context: Context) {
        if (::store.isInitialized) return
        store = context.applicationContext.getSharedPreferences("reader", Context.MODE_PRIVATE)
        state.value = ReaderPrefs(
            theme = ReaderTheme.entries.firstOrNull { it.name == store.getString("theme", null) } ?: ReaderTheme.SYSTEM,
            fontSizePercent = store.getInt("fontSize", 100),
            scroll = store.getBoolean("scroll", false),
            followNarrator = store.getBoolean("followNarrator", true),
            autoScrollSpeed = store.getInt("autoScrollSpeed", 3),
        )
    }

    @Synchronized
    fun update(change: (ReaderPrefs) -> ReaderPrefs) {
        val p = change(state.value)
        state.value = p
        store.edit()
            .putString("theme", p.theme.name)
            .putInt("fontSize", p.fontSizePercent)
            .putBoolean("scroll", p.scroll)
            .putBoolean("followNarrator", p.followNarrator)
            .putInt("autoScrollSpeed", p.autoScrollSpeed)
            .apply()
    }
}

fun Context.isSystemDark(): Boolean =
    resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
